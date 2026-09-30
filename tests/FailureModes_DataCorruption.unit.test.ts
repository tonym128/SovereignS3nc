import * as nacl from 'tweetnacl';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';
import { SovereignS3nc } from '../src/SovereignS3nc';
import { MessagingModule, Message } from '../src/modules/Messaging';
import { FeedModule, Post } from '../src/modules/Feed';
import { DailyDatabase } from '../src/core/DailyDatabase';
import { IRemoteAdapter, DownloadResult } from '../src/interfaces/IRemoteAdapter';
import { SovereignManifest, SubManifestRef, SubManifest } from '../src/types';
import { Logger } from '../src/utils/Logger';
import { PATHS } from '../src/utils/Constants';
import { AuthError } from '../src/utils/Errors';

// Polyfills
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;

class FaultInjectableRemote implements IRemoteAdapter {
    public files = new Map<string, { data: Uint8Array; hash: string; etag: string }>();
    public corruptions = new Map<string, 'binary_garbage' | 'truncated' | 'tampered' | 'invalid_json'>();

    setFile(path: string, data: Uint8Array): string {
        const hash = crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${hash.substring(0, 16)}"`;
        this.files.set(path, { data, hash, etag });
        return etag;
    }

    setCorruption(path: string, type: 'binary_garbage' | 'truncated' | 'tampered' | 'invalid_json'): void {
        this.corruptions.set(path, type);
    }

    clearCorruption(path: string): void {
        this.corruptions.delete(path);
    }

    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${h.substring(0, 16)}"`;
        this.files.set(path, { data, hash: h, etag });
        return etag;
    }

    async downloadFile(path: string, ifNoneMatch?: string): Promise<DownloadResult | null> {
        const corruption = this.corruptions.get(path);
        if (corruption) {
            if (corruption === 'binary_garbage') {
                const garbage = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff, 0x42, 0x77]);
                return { data: garbage, etag: '"corrupt-etag"', notModified: false };
            }
            if (corruption === 'invalid_json') {
                const badJson = new TextEncoder().encode('{"files": { "truncated": true, ');
                return { data: badJson, etag: '"corrupt-json"', notModified: false };
            }
            if (corruption === 'truncated') {
                const truncated = new Uint8Array([1, 2, 3]);
                return { data: truncated, etag: '"truncated"', notModified: false };
            }
            if (corruption === 'tampered') {
                const entry = this.files.get(path);
                if (entry) {
                    const tampered = new Uint8Array(entry.data);
                    if (tampered.length > 30) {
                        tampered[29] ^= 0xff; // flip bits in ciphertext
                    }
                    return { data: tampered, etag: entry.etag, notModified: false };
                }
            }
        }

        const entry = this.files.get(path);
        if (!entry) return null;
        if (ifNoneMatch && ifNoneMatch === entry.etag) {
            return { data: null, etag: entry.etag, notModified: true };
        }
        return { data: entry.data, etag: entry.etag, notModified: false };
    }

    async getFileHash(path: string): Promise<string | null> { return this.files.get(path)?.hash || null; }
    async getFileEtag(path: string): Promise<string | null> { return this.files.get(path)?.etag || null; }
    async canWrite(): Promise<boolean> { return true; }
    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path: string): Promise<void> { this.files.delete(path); }
}

describe('Failure-Mode Test Suite: Data Corruption & Resilient Degradation (Item 15)', () => {
    let SQL: any;

    beforeAll(async () => {
        SQL = await initSqlJs();
        (globalThis as any).initSqlJs = initSqlJs;
    });

    beforeEach(() => {
        (global as any).indexedDB = new IDBFactory();
        jest.spyOn(Logger, 'warn').mockImplementation(() => {});
        jest.spyOn(Logger, 'error').mockImplementation(() => {});
        jest.spyOn(Logger, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Manifest Corruption Scenarios
    // ─────────────────────────────────────────────────────────────────────────────
    describe('1. Manifest Corruption & Schema Anomalies', () => {
        it('should handle completely non-JSON binary garbage remote manifest gracefully', async () => {
            const remote = new FaultInjectableRemote();
            remote.setCorruption(PATHS.MANIFEST, 'binary_garbage');

            const sov = new SovereignS3nc({
                paths: { appId: 'corrupt-test', userId: 'alice', storeId: 'main' },
                password: 'password-123'
            }, remote);
            await sov.init();

            // fetchManifest should return null and not throw unhandled exception
            const result = await (sov as any).manifestManager.fetchManifest('alice');
            expect(result).toBeNull();

            // fetchManifestWithMeta returns null manifest with unchanged=false
            const meta = await (sov as any).manifestManager.fetchManifestWithMeta('alice');
            expect(meta.manifest).toBeNull();
            expect(meta.unchanged).toBe(false);

            await sov.closeDatabases();
        });

        it('should handle truncated/syntax-error JSON remote manifest gracefully', async () => {
            const remote = new FaultInjectableRemote();
            remote.setCorruption(PATHS.MANIFEST, 'invalid_json');

            const sov = new SovereignS3nc({
                paths: { appId: 'corrupt-test', userId: 'alice', storeId: 'main' },
                password: 'password-123'
            }, remote);
            await sov.init();

            const result = await (sov as any).manifestManager.fetchManifest('alice');
            expect(result).toBeNull();

            await sov.closeDatabases();
        });

        it('should handle corrupted sub-manifest without crashing root manifest resolution', async () => {
            const remote = new FaultInjectableRemote();
            const sov = new SovereignS3nc({
                paths: { appId: 'corrupt-test', userId: 'bob', storeId: 'main' },
                password: 'password-123'
            }, remote);
            await sov.init();

            // Prepare sub-manifests: 'sub1' is valid, 'sub2' is corrupt binary garbage
            const validSub: SubManifest = {
                partitionKey: 'sub1',
                updatedAt: Date.now(),
                userId: 'bob',
                modules: { feed: ['2026-09-01'] },
                files: { 'public/modules/feed/2026-09-01.db': { hash: 'hash1', updatedAt: Date.now() } }
            };
            const validSubBytes = new TextEncoder().encode(JSON.stringify(validSub));
            remote.setFile('manifests/sub1.json', validSubBytes);

            remote.setCorruption('manifests/sub2.json', 'binary_garbage');

            const rootManifest: SovereignManifest = {
                updatedAt: Date.now(),
                userId: 'bob',
                modules: {},
                dms: {},
                groups: {},
                blobs: [],
                files: {},
                subManifests: {
                    sub1: { path: 'manifests/sub1.json', hash: 'hash1', count: 1, updatedAt: Date.now() },
                    sub2: { path: 'manifests/sub2.json', hash: 'hash2', count: 1, updatedAt: Date.now() }
                }
            };

            const resolved = await (sov as any).manifestManager.resolveFullManifest('bob', rootManifest);
            expect(resolved).toBeDefined();
            // Valid sub1 files merged into root manifest
            expect(resolved.files!['public/modules/feed/2026-09-01.db']).toBeDefined();
            // Corrupt sub2 failed to resolve, but entire resolution did not throw
            expect(resolved.subManifests?.sub2).toBeDefined();

            await sov.closeDatabases();
        });

        it('should safely handle null or malformed entries in rootManifest.subManifests', async () => {
            const remote = new FaultInjectableRemote();
            const sov = new SovereignS3nc({
                paths: { appId: 'corrupt-test', userId: 'bob', storeId: 'main' },
                password: 'password-123'
            }, remote);
            await sov.init();

            const malformedRoot: SovereignManifest = {
                updatedAt: Date.now(),
                userId: 'bob',
                modules: {},
                dms: {},
                groups: {},
                blobs: [],
                files: {},
                subManifests: {
                    corrupt1: null as any,
                    corrupt2: { invalid: true } as any
                }
            };

            const resolved = await (sov as any).manifestManager.resolveFullManifest('bob', malformedRoot);
            expect(resolved).toBeDefined();
            expect(resolved.userId).toBe('bob');

            await sov.closeDatabases();
        });

        it('should recover when local manifest cache file is corrupted on storage', async () => {
            const remote = new FaultInjectableRemote();
            const sov = new SovereignS3nc({
                paths: { appId: 'corrupt-test', userId: 'alice', storeId: 'main' },
                password: 'password-123'
            }, remote);
            await sov.init();

            // Corrupt the local manifest cache directly in storage
            await sov.getStorage().saveFile(PATHS.MANIFEST_CACHE, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));

            // generateHierarchicalManifest should catch parse error, rescan storage, and write fresh cache
            const { rootManifest } = await (sov as any).manifestManager.generateHierarchicalManifest();
            expect(rootManifest).toBeDefined();
            expect(rootManifest.userId).toBe('alice');

            // Verify cache file was overwritten with valid JSON
            const cacheBytes = await sov.getStorage().getFile(PATHS.MANIFEST_CACHE);
            expect(cacheBytes).not.toBeNull();
            const parsedCache = JSON.parse(new TextDecoder().decode(cacheBytes!));
            expect(parsedCache.userId).toBe('alice');

            await sov.closeDatabases();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. SQLite Database Corruption & Recovery
    // ─────────────────────────────────────────────────────────────────────────────
    describe('2. SQLite Database Corruption Scenarios', () => {
        it('should detect non-SQLite garbage bytes, purge corrupted file, and recreate clean DB', async () => {
            const remote = new FaultInjectableRemote();
            const sov = new SovereignS3nc({
                paths: { appId: 'corrupt-test', userId: 'alice', storeId: 'main' },
                password: 'password-123'
            }, remote);
            await sov.init();

            const dbPath = 'private/corrupted.db';
            // Write random garbage bytes (not SQLite format header)
            await sov.getStorage().saveFile(dbPath, new Uint8Array([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66]));

            const dailyDb = sov.getDailyDatabase();
            let executed = false;

            // withDatabase must detect corruption, delete file, instantiate clean DB, and execute callback
            const result = await dailyDb.withDatabase(dbPath, (db) => {
                db.run('CREATE TABLE items (id TEXT PRIMARY KEY, val TEXT);');
                db.run('INSERT INTO items VALUES (?, ?);', ['item-1', 'hello']);
                const rows = db.exec('SELECT * FROM items;');
                executed = true;
                return rows[0].values[0][1];
            }, { save: true, immediate: true });

            expect(executed).toBe(true);
            expect(result).toBe('hello');

            // Stored file is now a valid SQLite database
            const storedBytes = await sov.getStorage().getFile(dbPath);
            expect(storedBytes).not.toBeNull();
            const header = new TextDecoder().decode(storedBytes!.slice(0, 16));
            expect(header).toContain('SQLite format 3');

            await sov.closeDatabases();
        });

        it('should recover and recreate module schema when corrupted database violates schema', async () => {
            const remote = new FaultInjectableRemote();
            const sov = new SovereignS3nc({
                paths: { appId: 'corrupt-test', userId: 'alice', storeId: 'main' },
                password: 'password-123'
            }, remote);
            await sov.init();
            const feed = new FeedModule(sov);

            const date = new Date().toISOString().split('T')[0];
            const dbPath = sov.getModulePath('feed', `${date}.db`, 'public');
            // Write corrupted bytes to module path
            await sov.getStorage().saveFile(dbPath, new TextEncoder().encode('THIS_IS_DEFINITELY_NOT_A_SQLITE_DATABASE'));

            // Calling feed.post should recover and insert the post cleanly
            await feed.post('Resilient post after corruption recovery');

            const posts = await feed.getPosts(date, 'public');
            expect(posts.length).toBe(1);
            expect(posts[0].content).toBe('Resilient post after corruption recovery');

            await sov.closeDatabases();
        });

        it('should skip corrupted followed user database without failing multi-user feed query', async () => {
            const aliceRemote = new FaultInjectableRemote();
            const aliceS3 = new SovereignS3nc({
                paths: { appId: 'corrupt-test', userId: 'alice', storeId: 'main' },
                password: 'password-123'
            }, aliceRemote);
            await aliceS3.init();
            const aliceFeed = new FeedModule(aliceS3);

            const bobKey = crypto.randomBytes(32).toString('hex');
            const charlieKey = crypto.randomBytes(32).toString('hex');
            // Follow Bob and Charlie
            await aliceS3.follow('bob', bobKey);
            await aliceS3.follow('charlie', charlieKey);

            const today = new Date().toISOString().split('T')[0];

            // 1. Post by Alice
            await aliceFeed.post('Alice own post');

            // 2. Charlie valid followed post
            const charliePath = aliceS3.getModulePath('feed', `charlie/${today}.db`, 'followed');
            await aliceS3.getDailyDatabase().withDatabase(charliePath, (db) => {
                aliceS3.applyModuleSchema(db, 'feed');
                db.run('INSERT INTO posts (id, content, timestamp, userId, isDeleted) VALUES (?, ?, ?, ?, 0);',
                    ['charlie-post', 'Charlie valid post', Date.now(), 'charlie']);
            }, { save: true, immediate: true });

            // 3. Bob corrupted followed database file (garbage bytes)
            const bobPath = aliceS3.getModulePath('feed', `bob/${today}.db`, 'followed');
            await aliceS3.getStorage().saveFile(bobPath, new Uint8Array([0xfa, 0xce, 0xfe, 0xed, 0x12, 0x34]));

            // Querying feed should NOT throw; it skips Bob and returns Alice and Charlie posts
            const feedPosts = await aliceFeed.getFeedPosts(5, true);
            const contents = feedPosts.map(p => p.content);
            expect(contents).toContain('Alice own post');
            expect(contents).toContain('Charlie valid post');
            expect(feedPosts.length).toBe(2);

            await aliceS3.closeDatabases();
        });

        it('should skip corrupted date partition in messaging inbox without aborting query', async () => {
            const remote = new FaultInjectableRemote();
            const sov = new SovereignS3nc({
                paths: { appId: 'corrupt-test', userId: 'alice', storeId: 'main' },
                password: 'password-123'
            }, remote);
            await sov.init();
            const messaging = new MessagingModule(sov);

            const bobPubKey = crypto.randomBytes(32).toString('hex');
            await sov.follow('bob', bobPubKey);

            // Write valid message in Alice's outbox for today
            const today = new Date().toISOString().split('T')[0];
            const outboxPath = sov.getModulePath('messaging', `dms/outbox/${today}.db`, 'private');
            await sov.getDailyDatabase().withDatabase(outboxPath, (db) => {
                sov.applyModuleSchema(db, 'messaging');
                db.run('INSERT INTO messages (id, content, timestamp, senderId, recipientId, isDeleted) VALUES (?, ?, ?, ?, ?, 0);',
                    ['msg-1', 'Valid outgoing message', Date.now(), 'alice', 'bob']);
            }, { save: true, immediate: true });

            // Corrupt Bob's incoming DM database for today
            const bobDmPath = sov.getModulePath('messaging', `bob/dms/alice/${today}.db`, 'followed');
            await sov.getStorage().saveFile(bobDmPath, new Uint8Array([0xde, 0xad, 0xba, 0xbe]));

            // getInboxMessages should not fail: returns Alice's outbox message and gracefully handles Bob's corrupt DB
            const inbox = await messaging.getInboxMessages(3);
            expect(inbox.length).toBe(1);
            expect(inbox[0].content).toBe('Valid outgoing message');

            await sov.closeDatabases();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. Encrypted Blob & DM Tampering Scenarios
    // ─────────────────────────────────────────────────────────────────────────────
    describe('3. Encrypted Payload Tampering & Corruption', () => {
        it('should detect tampered ciphertext and skip corrupted message while preserving valid ones', async () => {
            const aliceRemote = new FaultInjectableRemote();
            const bobRemote = new FaultInjectableRemote();

            const aliceS3 = new SovereignS3nc({
                paths: { appId: 'e2ee-corrupt', userId: 'alice', storeId: 'main' },
                password: 'alice-password-123'
            }, aliceRemote);
            await aliceS3.init();

            const bobS3 = new SovereignS3nc({
                paths: { appId: 'e2ee-corrupt', userId: 'bob', storeId: 'main' },
                password: 'bob-password-456'
            }, bobRemote);
            await bobS3.init();

            const aliceMessaging = new MessagingModule(aliceS3);
            const bobMessaging = new MessagingModule(bobS3);

            // Alice follows Bob; Bob follows Alice
            await aliceS3.follow('bob', bobS3.getConfig().publicEncryptionKey);
            await bobS3.follow('alice', aliceS3.getConfig().publicEncryptionKey);

            const today = new Date().toISOString().split('T')[0];

            // Bob sends message 1 to Alice
            await bobMessaging.sendDirectMessage('alice', 'Valid Message 1');

            // Bob sends message 2 to Alice
            await bobMessaging.sendDirectMessage('alice', 'Valid Message 2');
            await bobS3.flushDatabases();

            // Export Bob's DM DB to Alice's followed storage
            const bobOutboxDmPath = bobS3.getModulePath('messaging', `dms/outbox/${today}.db`, 'private');
            const bobOutboxBytes = await bobS3.getStorage().getFile(bobOutboxDmPath);
            expect(bobOutboxBytes).not.toBeNull();

            // Bob's message wire format: public/modules/messaging/dms/alice/{today}.db
            // Create a DM database with 2 messages, but tamper with the ciphertext of message 1
            const sharedSecret = bobS3.deriveSharedSecret(aliceS3.getConfig().publicEncryptionKey!);
            const encrypted1 = await bobS3.encrypt(new TextEncoder().encode(JSON.stringify({
                id: 'tampered-1',
                content: 'I will be tampered',
                timestamp: Date.now() - 1000,
                senderId: 'bob',
                recipientId: 'alice'
            })), sharedSecret);

            // Tamper: flip bits in ciphertext
            const tamperedBytes = new Uint8Array(encrypted1);
            tamperedBytes[tamperedBytes.length - 2] ^= 0xff;

            const encrypted2 = await bobS3.encrypt(new TextEncoder().encode(JSON.stringify({
                id: 'valid-2',
                content: 'Valid Message 2 Payload',
                timestamp: Date.now(),
                senderId: 'bob',
                recipientId: 'alice'
            })), sharedSecret);

            const dmDb = new SQL.Database();
            dmDb.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, encrypted_data BLOB);`);
            dmDb.run(`INSERT INTO messages VALUES (?, ?);`, ['tampered-1', tamperedBytes]);
            dmDb.run(`INSERT INTO messages VALUES (?, ?);`, ['valid-2', encrypted2]);
            const dmDbExport = dmDb.export();
            dmDb.close();

            const aliceFollowedPath = aliceS3.getModulePath('messaging', `bob/dms/alice/${today}.db`, 'followed');
            await aliceS3.getStorage().saveFile(aliceFollowedPath, dmDbExport);

            // Alice reads inbox: tampered-1 fails decryption and is skipped; valid-2 is decrypted and returned
            const inbox = await aliceMessaging.getInboxMessages(1);
            const valid = inbox.find(m => m.id === 'valid-2');
            const corrupt = inbox.find(m => m.id === 'tampered-1');

            expect(valid).toBeDefined();
            expect(valid?.content).toBe('Valid Message 2 Payload');
            expect(corrupt).toBeUndefined();

            await aliceS3.closeDatabases();
            await bobS3.closeDatabases();
        });

        it('should catch malformed non-JSON payload after successful decryption and skip message', async () => {
            const aliceRemote = new FaultInjectableRemote();
            const bobRemote = new FaultInjectableRemote();

            const aliceS3 = new SovereignS3nc({
                paths: { appId: 'e2ee-corrupt', userId: 'alice', storeId: 'main' },
                password: 'alice-password-123'
            }, aliceRemote);
            await aliceS3.init();

            const bobS3 = new SovereignS3nc({
                paths: { appId: 'e2ee-corrupt', userId: 'bob', storeId: 'main' },
                password: 'bob-password-456'
            }, bobRemote);
            await bobS3.init();

            const aliceMessaging = new MessagingModule(aliceS3);
            await aliceS3.follow('bob', bobS3.getConfig().publicEncryptionKey);

            const today = new Date().toISOString().split('T')[0];
            const sharedSecret = bobS3.deriveSharedSecret(aliceS3.getConfig().publicEncryptionKey!);

            // Encrypt non-JSON text
            const encryptedNonJson = await bobS3.encrypt(new TextEncoder().encode('NON_JSON_PLAINTEXT_DATA_HERE'), sharedSecret);

            // Encrypt valid message
            const encryptedValid = await bobS3.encrypt(new TextEncoder().encode(JSON.stringify({
                id: 'valid-after-bad-json',
                content: 'Valid After Bad Json',
                timestamp: Date.now(),
                senderId: 'bob',
                recipientId: 'alice'
            })), sharedSecret);

            const dmDb = new SQL.Database();
            dmDb.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, encrypted_data BLOB);`);
            dmDb.run(`INSERT INTO messages VALUES (?, ?);`, ['bad-json-1', encryptedNonJson]);
            dmDb.run(`INSERT INTO messages VALUES (?, ?);`, ['good-json-2', encryptedValid]);
            const dmDbExport = dmDb.export();
            dmDb.close();

            const aliceFollowedPath = aliceS3.getModulePath('messaging', `bob/dms/alice/${today}.db`, 'followed');
            await aliceS3.getStorage().saveFile(aliceFollowedPath, dmDbExport);

            const inbox = await aliceMessaging.getInboxMessages(1);
            expect(inbox.length).toBe(1);
            expect(inbox[0].id).toBe('valid-after-bad-json');
            expect(inbox[0].content).toBe('Valid After Bad Json');

            await aliceS3.closeDatabases();
            await bobS3.closeDatabases();
        });

        it('should handle corrupted DM attachment ciphertext and throw AuthError without breaking state', async () => {
            const aliceRemote = new FaultInjectableRemote();
            const bobRemote = new FaultInjectableRemote();

            const aliceS3 = new SovereignS3nc({
                paths: { appId: 'e2ee-corrupt', userId: 'alice', storeId: 'main' },
                password: 'alice-password-123'
            }, aliceRemote);
            await aliceS3.init();

            const bobS3 = new SovereignS3nc({
                paths: { appId: 'e2ee-corrupt', userId: 'bob', storeId: 'main' },
                password: 'bob-password-456'
            }, bobRemote);
            await bobS3.init();

            const aliceMessaging = new MessagingModule(aliceS3);
            await aliceS3.follow('bob', bobS3.getConfig().publicEncryptionKey);

            // Create corrupted attachment blob in storage
            const blobPath = 'public/blobs/corrupted-attachment.bin';
            await aliceS3.getStorage().saveFile(`${PATHS.FOLLOWED_PREFIX}bob/${blobPath}`, new Uint8Array([1, 2, 3, 4, 5])); // invalid ciphertext

            const fakeMessage: Message = {
                id: 'msg-with-corrupt-attachment',
                content: 'Check attachment',
                timestamp: Date.now(),
                senderId: 'bob',
                recipientId: 'alice',
                image: blobPath,
                imageEncryption: {
                    version: 1,
                    ephemeralPublicKey: bobS3.getConfig().publicEncryptionKey!
                }
            };

            // getMessageImage should reject because ciphertext is corrupted/truncated
            await expect(aliceMessaging.getMessageImage(fakeMessage)).rejects.toThrow(AuthError);

            await aliceS3.closeDatabases();
            await bobS3.closeDatabases();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. Registry & Profile Corruption Scenarios
    // ─────────────────────────────────────────────────────────────────────────────
    describe('4. Registry & Profile Corruption Scenarios', () => {
        it('should gracefully handle corrupted remote user profile without overwriting local profile', async () => {
            const remote = new FaultInjectableRemote();
            const sov = new SovereignS3nc({
                paths: { appId: 'corrupt-test', userId: 'alice', storeId: 'main' },
                password: 'password-123'
            }, remote);
            await sov.init();

            // Set local valid profile
            const validProfile = { userId: 'alice', displayName: 'Alice In Wonderland', updatedAt: Date.now() };
            await sov.getStorage().savePublicUserFile(new TextEncoder().encode(JSON.stringify(validProfile)));

            // Remote profile is corrupted binary garbage
            remote.setCorruption(PATHS.USER_PROFILE, 'binary_garbage');

            // syncUserFile should not throw and should preserve local profile
            await (sov as any).syncOrchestrator.syncUserFile(null);

            const currentProfileBytes = await sov.getStorage().getPublicUserFile();
            expect(currentProfileBytes).not.toBeNull();
            const currentProfile = JSON.parse(new TextDecoder().decode(currentProfileBytes!));
            expect(currentProfile.displayName).toBe('Alice In Wonderland');

            await sov.closeDatabases();
        });

        it('should filter out corrupted/null entries in legacy users.json registry', async () => {
            const remote = new FaultInjectableRemote();
            const sov = new SovereignS3nc({
                paths: { appId: 'corrupt-test', userId: 'alice', storeId: 'main' },
                password: 'password-123'
            }, remote);
            await sov.init();

            // Malformed legacy users.json with nulls, missing fields, and valid items
            const malformedUsers = [
                null,
                { userId: null },
                { userId: 'valid-user-1', publicKey: 'pub-key-1' },
                { missingKey: true },
                'corrupted_string_item',
                { userId: 'valid-user-2', publicKey: 'pub-key-2' }
            ];
            remote.setFile('users.json', new TextEncoder().encode(JSON.stringify(malformedUsers)));

            const discovered = await sov.discoverUsers();
            expect(discovered).not.toBeNull();
            const legacyUsers = discovered!.filter(u => u.userId !== 'alice');
            expect(legacyUsers.length).toBe(2);
            expect(legacyUsers.map(u => u.userId)).toEqual(['valid-user-1', 'valid-user-2']);

            await sov.closeDatabases();
        });

        it('should reject tampered signature on V2 registry entry', async () => {
            const remote = new FaultInjectableRemote();
            const sov = new SovereignS3nc({
                paths: { appId: 'corrupt-test', userId: 'alice', storeId: 'main' },
                password: 'password-123'
            }, remote);
            await sov.init();

            // Generate an entry with an invalid/tampered signature
            const tamperedEntry = {
                userId: 'attacker',
                publicKey: 'attacker-public-key',
                timestamp: Date.now(),
                signingPublicKey: (sov.getConfig() as any).signingPublicKey,
                signature: 'deadbeef00112233445566778899aabbccddeeff' // invalid sig
            };
            remote.setFile('users/attacker.json', new TextEncoder().encode(JSON.stringify(tamperedEntry)));

            const registry = await sov.getPublicRegistry();
            const attacker = registry.find(u => u.userId === 'attacker');
            expect(attacker).toBeUndefined();

            await sov.closeDatabases();
        });
    });
});
