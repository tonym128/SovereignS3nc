
import { SovereignS3nc } from '../src/SovereignS3nc';
import { FeedModule } from '../src/modules/Feed';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';

// --- Browser Polyfills for Node environment ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

class MockRemote {
    files: Map<string, {data: Uint8Array, hash: string, etag: string}> = new Map();

    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        const h = hash || 'mock-hash';
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: h, etag });
        return etag;
    }

    async downloadFile(path: string, ifNoneMatch?: string): Promise<any | null> {
        const entry = this.files.get(path);
        if (!entry) return null;
        if (ifNoneMatch && ifNoneMatch === entry.etag) {
            return { data: null, etag: entry.etag, notModified: true };
        }
        return { data: entry.data, etag: entry.etag };
    }

    async getFileHash(path: string): Promise<string | null> {
        return this.files.get(path)?.hash || null;
    }

    async getFileEtag(path: string): Promise<string | null> {
        return this.files.get(path)?.etag || null;
    }

    async canWrite(path: string): Promise<boolean> { return true; }
    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path: string): Promise<void> { this.files.delete(path); }
}

describe('Browser-based Social Sync', () => {
    let mockS3: MockRemote;

    beforeEach(() => {
        mockS3 = new MockRemote();
        (global as any).indexedDB = new IDBFactory(); // Reset DB for each test
    });

    async function setupUser(userId: string, password: string) {
        const config = {
            paths: { appId: 'test-app', userId: userId, storeId: 'main' },
            password: password
        };

        const factory = (uid: string) => {
            const prefix = uid === 'global' ? 'test-app/global/users' : `test-app/${uid}/main`;
            return {
                uploadFile: async (p: string, d: Uint8Array, h?: string) => {
                    return mockS3.uploadFile(`${prefix}/${p}`, d, h);
                },
                downloadFile: async (p: string, etag?: string) => {
                    return mockS3.downloadFile(`${prefix}/${p}`, etag);
                },
                getFileHash: (p: string) => mockS3.getFileHash(`${prefix}/${p}`),
                getFileEtag: (p: string) => mockS3.getFileEtag(`${prefix}/${p}`),
                canWrite: (p: string) => mockS3.canWrite(`${prefix}/${p}`),
                listFiles: (p: string) => mockS3.listFiles(`${prefix}/${p}`),
                deleteFile: (p: string) => mockS3.deleteFile(`${prefix}/${p}`)
            } as IRemoteAdapter;
        };

        const sov = new SovereignS3nc(config, factory(userId), factory);
        await sov.init();
        const feed = new FeedModule(sov);
        return { sov, feed };
    }

    test('Alice posts, Bob syncs and sees it', async () => {
        const alice = await setupUser('alice', 'alice-pass');
        const bob = await setupUser('bob', 'bob-pass');
        const today = SovereignS3nc.getDateStr(new Date());

        // 1. Alice posts
        console.log('Alice posting...');
        await alice.feed.post('Hello from Alice', true);
        
        // 2. Alice syncs to upload data and register in users.json
        await alice.sov.sync();

        // Bob follows Alice explicitly
        await bob.sov.follow('alice');

        // 3. Bob syncs - should pull her data
        console.log('Bob syncing...');
        await bob.sov.sync();

        // 4. Bob reads feed
        const posts = await bob.feed.getPosts('alice/' + today, 'followed');
        
        expect(posts.length).toBe(1);
        expect(posts[0].content).toBe('Hello from Alice');
        expect(posts[0].userId).toBe('alice');
    });
});
