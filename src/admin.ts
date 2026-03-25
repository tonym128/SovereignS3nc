#!/usr/bin/env node
import { SovereignS3nc } from './SovereignS3nc';
import { ModerationModule } from './modules/Moderation';
import { NodeStorage } from './adapters/NodeStorage';
import * as path from 'path';
import * as fs from 'fs-extra';

const initSqlJs = require('sql.js');

// Polyfills for Node
(global as any).initSqlJs = initSqlJs;
(global as any).TextEncoder = require('util').TextEncoder;
(global as any).TextDecoder = require('util').TextDecoder;

const APP_ID = 'sov-social';
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
    moderation: ModerationModule
}> {
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
    
    return { 
        sov, 
        moderation: new ModerationModule(sov)
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

        const { sov, moderation } = await initSovereign(user);

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
                await moderation.banUser(targetUserId);
                console.log(`User ${targetUserId} has been banned.`);
                break;

            case 'backup':
            case 'export-data':
                const outputPath = args[1] || 'export.json';
                const data = await moderation.exportAllData();
                await fs.writeFile(outputPath, data);
                console.log(`All data exported to ${outputPath}`);
                break;

            case 'restore':
            case 'import-data':
                const importPath = args[1];
                if (!importPath) {
                    console.error('Usage: restore <path>');
                    return;
                }
                const importData = await fs.readFile(importPath, 'utf8');
                await moderation.importAllData(importData);
                console.log('Data imported successfully.');
                break;

            case 'reset':
            case 'burn-it-to-the-ground':
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
