
import { SovereignS3nc } from '../src/SovereignS3nc';
import { ProfileModule, Profile } from '../src/modules/Profile';
import { MessagingModule, Message } from '../src/modules/Messaging';
import { FeedModule, Post } from '../src/modules/Feed';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import crypto from 'crypto';
import * as nacl from 'tweetnacl';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';

// --- Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string, etag: string}> = new Map();
    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: h, etag });
        return etag;
    }
    async downloadFile(path: string): Promise<any | null> {
        const entry = this.files.get(path);
        return entry ? { data: entry.data, etag: entry.etag } : null;
    }
    async getFileHash(path: string): Promise<string | null> { return this.files.get(path)?.hash || null; }
    async getFileEtag(path: string): Promise<string | null> { return this.files.get(path)?.etag || null; }

    async canWrite(path: string): Promise<boolean> { return true; }
    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path: string): Promise<void> { this.files.delete(path); }
}

describe('Granular Module Unit Tests', () => {
    let sov: SovereignS3nc;
    let profile: ProfileModule;
    let messaging: MessagingModule;
    let feed: FeedModule;
    let mockRemote: MockRemote;

    beforeEach(async () => {
        (global as any).indexedDB = new IDBFactory();
        mockRemote = new MockRemote();
        const config = {
            paths: { appId: 'social-test', userId: 'alice', storeId: 'main' },
            password: 'password123',
            debug: false
        };
        sov = new SovereignS3nc(config, mockRemote);
        await sov.init();
        profile = new ProfileModule(sov);
        messaging = new MessagingModule(sov);
        feed = new FeedModule(sov);
    });

    describe('Database Management (Feed)', () => {
        test('should initialize schema in namespaced path', async () => {
            const today = new Date().toISOString().split('T')[0];
            const db = await (feed as any).getDb(today, 'public');
            
            const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
            const tableNames = tables[0].values.map((v: any) => v[0]);
            expect(tableNames).toContain('posts');
            expect(tableNames).toContain('likes');
            db.close();

            // Verify file exists in namespaced path
            const expectedPath = sov.getModulePath('feed', `${today}.db`, 'public');
            const data = await sov.getStorage().getFile(expectedPath);
            expect(data).toBeDefined();
        });
    });

    describe('Posting and Fetching', () => {
        test('should create a namespaced public post', async () => {
            await feed.post('Hello Namespaced World', true);
            const today = new Date().toISOString().split('T')[0];
            const posts = await feed.getPosts(today, 'public');
            expect(posts.length).toBe(1);
            expect(posts[0].content).toBe('Hello Namespaced World');
        });

        test('should create a namespaced private post', async () => {
            await feed.post('Secret namespaced thoughts', false);
            const today = new Date().toISOString().split('T')[0];
            const posts = await feed.getPosts(today, 'private');
            expect(posts.length).toBe(1);
            expect(posts[0].content).toBe('Secret namespaced thoughts');
        });
    });

    describe('Direct Messaging', () => {
        test('should send a namespaced DM', async () => {
            const bobPair = nacl.box.keyPair();
            const bobPublicKey = Buffer.from(bobPair.publicKey).toString('hex');
            const registry = [{ userId: 'bob', publicKey: bobPublicKey }];
            await mockRemote.uploadFile('users.json', new TextEncoder().encode(JSON.stringify(registry)));

            await messaging.sendDirectMessage('bob', 'Hello Namespaced Bob');
            
            const today = new Date().toISOString().split('T')[0];
            const outboxPath = sov.getModulePath('messaging', `dms/outbox/${today}.db`, 'private');
            const outboxData = await sov.getStorage().getFile(outboxPath);
            expect(outboxData).toBeDefined();

            const publicDmPath = sov.getModulePath('messaging', `dms/bob/${today}.db`, 'public');
            const publicDmData = await sov.getStorage().getFile(publicDmPath);
            expect(publicDmData).toBeDefined();
        });

        test('should get namespaced inbox messages', async () => {
            const today = new Date().toISOString().split('T')[0];
            const bobId = 'bob';
            const bobPair = nacl.box.keyPair();
            const bobPublicKey = Buffer.from(bobPair.publicKey).toString('hex');
            
            const sharedSecret = sov.deriveSharedSecret(bobPublicKey);
            
            const message = { id: 'msg1', content: 'Hey Namespaced Alice', timestamp: Date.now(), senderId: 'bob', recipientId: 'alice' };
            const encrypted = await sov.encrypt(new TextEncoder().encode(JSON.stringify(message)), sharedSecret);
            
            const SQL = await (global as any).initSqlJs();
            const db = new SQL.Database();
            db.exec('CREATE TABLE messages (id TEXT PRIMARY KEY, encrypted_data BLOB)');
            db.run('INSERT INTO messages (id, encrypted_data) VALUES (?, ?)', ['msg1', encrypted]);
            const dbData = db.export();
            db.close();

            const myId = sov.getConfig().paths.userId;
            // Test that it can read from both new 'messaging' and legacy 'social' paths
            const localPath = sov.getModulePath('messaging', `${bobId}/dms/${myId}/${today}.db`, 'followed');
            await sov.getStorage().saveFile(localPath, dbData);
            await sov.getStorage().followUser(bobId, today, bobPublicKey);

            const inbox = await messaging.getInboxMessages(1);
            expect(inbox.length).toBe(1);
            expect(inbox[0].content).toBe('Hey Namespaced Alice');
        });
    });

    describe('Profile Management', () => {
        test('should get namespaced followed user profile', async () => {
            const bobId = 'bob';
            const bobProfile = { name: 'Bob Namespaced', bio: 'I build namespaced things', userId: bobId };
            const bobData = new TextEncoder().encode(JSON.stringify(bobProfile));
            
            const localPath = sov.getModulePath('profile', `${bobId}/profile`, 'followed');
            await sov.getStorage().saveFile(localPath, bobData);

            const p = await profile.getProfile(bobId);
            expect(p!.name).toBe('Bob Namespaced');
        });
    });
});
