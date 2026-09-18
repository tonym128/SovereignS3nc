#!/usr/bin/env node
import { SovereignS3nc } from './SovereignS3nc';
import { ModerationModule } from './modules/Moderation';
import { NodeStorage } from './adapters/NodeStorage';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';

const initSqlJs = require('sql.js');

// Polyfills for Node
(global as any).initSqlJs = initSqlJs;
(global as any).TextEncoder = require('util').TextEncoder;
(global as any).TextDecoder = require('util').TextDecoder;

/** Magic header that identifies an encrypted SovereignS3nc backup file. */
const BACKUP_MAGIC = 'SOV_BACKUP_V1';
const PBKDF2_ITERATIONS = 600000;
const SALT_SIZE = 32;

/**
 * Encrypts a backup payload (JSON string) using AES-256-GCM with a PBKDF2-derived key.
 * Output format (binary): [magic(13)] [salt(32)] [iv(12)] [tag(16)] [ciphertext]
 */
function encryptBackup(plaintext: string, password: string): Buffer {
    const salt = crypto.randomBytes(SALT_SIZE);
    const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([
        Buffer.from(BACKUP_MAGIC, 'ascii'),
        salt, iv, tag, encrypted
    ]);
}

/**
 * Decrypts an encrypted backup file. Returns the plaintext JSON string.
 * Throws if the file is not in the encrypted format or the password is wrong.
 */
function decryptBackup(data: Buffer, password: string): string {
    const magic = data.slice(0, BACKUP_MAGIC.length).toString('ascii');
    if (magic !== BACKUP_MAGIC) {
        // Not encrypted — assume legacy plain JSON for backward compat
        return data.toString('utf8');
    }
    const offset = BACKUP_MAGIC.length;
    const salt = data.slice(offset, offset + SALT_SIZE);
    const iv   = data.slice(offset + SALT_SIZE, offset + SALT_SIZE + 12);
    const tag  = data.slice(offset + SALT_SIZE + 12, offset + SALT_SIZE + 28);
    const ciphertext = data.slice(offset + SALT_SIZE + 28);
    const key = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final('utf8');
}

const APP_ID = process.env.SOV_APP_ID || 'sov-social';
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '.';
const CLI_DATA_DIR = path.join(HOME_DIR, '.sovereigns3nc-cli');

async function getSavedProfiles(): Promise<Record<string, any>> {
    const profilePath = path.join(CLI_DATA_DIR, 'profiles.json');
    if (await fs.pathExists(profilePath)) {
        return await fs.readJson(profilePath);
    }
    return {};
}

async function getCurrentUser(): Promise<any | null> {
    const currentPath = path.join(CLI_DATA_DIR, 'current_user.json');
    if (await fs.pathExists(currentPath)) {
        const { userId } = await fs.readJson(currentPath);
        const profiles = await getSavedProfiles();
        return profiles[userId] || null;
    }
    return null;
}

async function initSovereign(profile: any): Promise<{ 
    sov: SovereignS3nc, 
    moderation: ModerationModule,
    auditLog: (command: string, target?: string) => void
}> {
    // Audit Logging
    const auditLog = (command: string, target?: string) => {
        const logPath = path.join(CLI_DATA_DIR, 'admin_audit.log');
        const entry = `[${new Date().toISOString()}] ADMIN_ACTION: ${command} ${target || ''}\n`;
        fs.appendFileSync(logPath, entry);
    };

    const storagePath = path.join(CLI_DATA_DIR, 'storage', profile.userId);
    const storage = new NodeStorage(storagePath);
    
    const config = {
        paths: { appId: APP_ID, userId: profile.userId, storeId: 'social' },
        password: profile.password,
        s3: profile.s3Config,
        debug: false
    };

    const sov = new SovereignS3nc(config, undefined, undefined, undefined, storage);
    await sov.init();
    
    const moderation = new ModerationModule(sov);

    return { 
        sov, 
        moderation,
        auditLog
    };
}

export async function run(args: string[]) {
    const command = args[0];

    if (!command || command === 'help') {
        console.log(`
SovereignS3nc Admin CLI - Usage:
  list-users                List all users in the system
  list-files [prefix]       List all files, optionally filtered by prefix
  list-reports              List pending moderation reports
  ban-user <userId>         Ban a user and purge their data
  backup [outputPath]       Export all system data to a JSON file
  restore <path>            Import system data from a JSON file
  reset                     PERMANENTLY delete all data from S3
  export-data [outputPath]  (Legacy) Same as backup
  import-data <path>        (Legacy) Same as restore
  burn-it-to-the-ground     (Legacy) Same as reset
        `);
        return;
    }

    try {
        const user = await getCurrentUser();
        if (!user) {
            console.error('Not logged in. Use the main CLI to login first.');
            return;
        }

        const { sov, moderation, auditLog } = await initSovereign(user);

        // Task: Admin Authentication
        const DESTRUCTIVE_COMMANDS = ['ban-user', 'reset', 'burn-it-to-the-ground', 'restore', 'import-data'];
        if (DESTRUCTIVE_COMMANDS.includes(command)) {
            let password = process.env.SOV_ADMIN_PASSWORD;
            if (!password) {
                const readline = require('readline').createInterface({
                    input: process.stdin,
                    output: process.stdout
                });

                password = await new Promise(resolve => {
                    readline.question('Confirm Admin Password: ', (ans: string) => {
                        readline.close();
                        resolve(ans);
                    });
                });
            }

            if (password !== user.password) {
                console.error('Authentication failed: Incorrect password.');
                return;
            }
            console.log('Authentication successful.');
        }

        switch (command) {
            case 'list-users':
                const users = await moderation.listUsers();
                console.log('\n--- System Users ---');
                users.forEach(u => console.log(`- ${u}`));
                console.log(`Total: ${users.length} users.`);
                break;

            case 'list-files':
                const prefix = args[1] || '';
                const files = await moderation.listFiles(prefix);
                console.log(`\n--- Files (Prefix: "${prefix}") ---`);
                files.forEach(f => console.log(f));
                console.log(`Total: ${files.length} files.`);
                break;

            case 'list-reports':
                const reports = await moderation.getReports();
                console.log(`\n--- Pending Reports (${reports.length}) ---`);
                reports.forEach(r => {
                    console.log(`[${r.id}] From: ${r.reporterId} | Target: ${r.targetUserId}`);
                    console.log(`Type: ${r.contentType} | Reason: ${r.reason}`);
                    if (r.evidence) console.log(`Evidence: ${JSON.stringify(r.evidence)}`);
                    console.log('----------------------------');
                });
                break;

            case 'ban-user':
                const targetUserId = args[1];
                if (!targetUserId) {
                    console.error('Usage: ban-user <userId>');
                    return;
                }
                auditLog('ban-user', targetUserId);
                await moderation.banUser(targetUserId);
                console.log(`User ${targetUserId} has been banned.`);
                break;

            case 'backup':
            case 'export-data':
                const outputPath = args[1] || 'export.bin';
                const rawData = await moderation.exportAllData();
                const encryptedBackup = encryptBackup(rawData, user.password);
                await fs.writeFile(outputPath, encryptedBackup);
                console.log(`All data exported and encrypted to ${outputPath}`);
                console.log('  (This file is AES-256-GCM encrypted with your admin password)');
                break;

            case 'restore':
            case 'import-data':
                const importPath = args[1];
                if (!importPath) {
                    console.error('Usage: restore <path>');
                    return;
                }
                auditLog('restore', importPath);
                const encryptedImport = await fs.readFile(importPath);
                const importData = decryptBackup(encryptedImport, user.password);
                await moderation.importAllData(importData);
                console.log('Data imported successfully.');
                break;

            case 'reset':
            case 'burn-it-to-the-ground':
                auditLog('reset');
                await moderation.burnItToTheGround();
                console.log('Operation complete. Everything is gone.');
                break;

            default:
                console.log('Unknown command. Type "help" for usage.');
        }
    } catch (e: any) {
        console.error('Error:', e.message);
    }
}

if (require.main === module) {
    run(process.argv.slice(2));
}
