
import { SovereignS3nc } from '../src/SovereignS3nc';
import { ModerationModule } from '../src/modules/Moderation';
import { FeedModule } from '../src/modules/Feed';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';

// --- Browser Polyfills ---
(globalThis as any).indexedDB = new IDBFactory();
(globalThis as any).crypto = crypto.webcrypto;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).initSqlJs = initSqlJs;

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string, etag: string}> = new Map();
    constructor(private prefix: string = '') {}

    private getPath(path: string): string {
        return this.prefix + path;
    }

    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        const fullPath = this.getPath(path);
        console.log(`[MockRemote] Uploading to: ${fullPath}`);
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(fullPath, { data, hash: h, etag });
        return etag;
    }

    async downloadFile(path: string, ifNoneMatch?: string): Promise<any | null> {
        const fullPath = this.getPath(path);
        const entry = this.files.get(fullPath);
        if (!entry) return null;
        if (ifNoneMatch && ifNoneMatch === entry.etag) {
            return { data: null, etag: entry.etag, notModified: true };
        }
        return { data: entry.data, etag: entry.etag };
    }

    async getFileHash(path: string): Promise<string | null> {
        const fullPath = this.getPath(path);
        return this.files.get(fullPath)?.hash || null;
    }

    async getFileEtag(path: string): Promise<string | null> {
        const fullPath = this.getPath(path);
        return this.files.get(fullPath)?.etag || null;
    }

    async canWrite(path: string): Promise<boolean> {
        return true;
    }

    async listFiles(prefix: string): Promise<string[]> {
        const fullPrefix = this.getPath(prefix);
        return Array.from(this.files.keys())
            .filter(k => k.startsWith(fullPrefix))
            .map(k => k.substring(this.prefix.length));
    }

    async deleteFile(path: string): Promise<void> {
        const fullPath = this.getPath(path);
        this.files.delete(fullPath);
    }
}

describe('Moderation Surgical Deletion Sync Integration Tests', () => {
    let adminSov: SovereignS3nc;
    let userSov: SovereignS3nc;
    let adminMod: ModerationModule;
    let userFeed: FeedModule;
    let globalFiles: Map<string, any>;
    let remoteFactory: (uid: string) => MockRemote;
    const testId = Math.random().toString(36).substring(7);
    const appId = `mod-sync-test-${testId}`;

    beforeAll(async () => {
        globalFiles = new Map();

        remoteFactory = (uid: string) => {
            // Map system UIDs to their literal folders
            let prefix = appId + '/' + uid + '/';
            if (uid === 'root') prefix = appId + '/'; 
            if (uid === 'admin') prefix = appId + '/admin-user/'; 
            if (uid === 'global') prefix = appId + '/global/';
            
            // For regular users, include storeId
            if (uid === 'admin-user' || uid === 'regular-user' || uid === 'observer-user') {
                prefix = appId + '/' + uid + '/social/';
            }
            // For private IDs (long hashes)
            else if (uid.length > 32) {
                prefix = appId + '/' + uid + '/social/';
            }
            
            const r = new MockRemote(prefix);
            (r as any).files = globalFiles;
            return r;
        };
// Setup Admin
adminSov = new SovereignS3nc({
    paths: { appId, userId: 'admin-user', storeId: 'social' },
    password: 'admin-password',
    debug: true
}, undefined, remoteFactory);
(adminSov as any).storage = new IndexedDBStorage(`admin_db_${appId}_${testId}`);
await adminSov.init();
adminMod = new ModerationModule(adminSov);
await adminMod.publishAdminKey();

// Setup User
userSov = new SovereignS3nc({
    paths: { appId, userId: 'regular-user', storeId: 'social' },
    password: 'user-password',
    debug: true
}, undefined, remoteFactory);
(userSov as any).storage = new IndexedDBStorage(`user_db_${appId}_${testId}`);
await userSov.init();userFeed = new FeedModule(userSov);

        // Initial sync to exchange keys
        await adminSov.sync();
        await userSov.sync();
    });

    test('Admin requests surgical deletion, user syncs and deletes it', async () => {
        const today = SovereignS3nc.getDateStr(new Date());
        
        // 1. User creates two posts
        await userFeed.post("Post to keep");
        await userFeed.post("Post to delete");
        
        await userSov.sync();
        
        // Verify posts exist locally
        let posts = await userFeed.getPosts(today, 'public');
        expect(posts.length).toBe(2);
        const postToDelete = posts.find(p => p.content === "Post to delete")!;
        const postToKeep = posts.find(p => p.content === "Post to keep")!;

        // 2. Admin sends deletion request for one post
        await adminMod.requestPostDeletion('regular-user', postToDelete.id, today);
        await adminSov.sync();

        // 3. User syncs.
        await userSov.sync();

        // 4. Verify post is deleted locally
        posts = await userFeed.getPosts(today, 'public');
        expect(posts.length).toBe(1);
        expect(posts[0].id).toBe(postToKeep.id);
        expect(posts.find(p => p.id === postToDelete.id)).toBeUndefined();

        // 5. Verify the DB on Remote is also updated (re-uploaded by user after processing request)
        const observerSov = new SovereignS3nc({
            paths: { appId, userId: 'observer-user', storeId: 'social' },
            password: 'observer-password'
        }, undefined, remoteFactory);
        (observerSov as any).storage = new IndexedDBStorage(`observer_db_${appId}`);
        await observerSov.init();
        
        await observerSov.follow('regular-user');
        await observerSov.sync();
        
        const observerFeed = new FeedModule(observerSov);
        const observerPosts = await observerFeed.getPosts(`regular-user/${today}`, 'followed');
        
        expect(observerPosts.length).toBe(1);
        expect(observerPosts[0].id).toBe(postToKeep.id);
    });
});
