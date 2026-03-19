import { SovereignS3nc } from '../src/SovereignS3nc';
import { SocialManager } from '../src/modules/Social';
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

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string}> = new Map();

    async uploadFile(path: string, data: Uint8Array): Promise<void> {
        // We simulate the lib's internal hashing if we were to check it manually,
        // but the lib will provide the correct hash when it uploads.
        const hash = 'mock-hash'; 
        this.files.set(path, { data, hash });
    }

    async uploadFileWithHash(path: string, data: Uint8Array, hash: string) {
        this.files.set(path, { data, hash });
    }

    async downloadFile(path: string): Promise<Uint8Array | null> {
        return this.files.get(path)?.data || null;
    }
    async getFileHash(path: string): Promise<string | null> {
        return this.files.get(path)?.hash || null;
    }
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
                uploadFile: async (p: string, d: Uint8Array) => {
                    // Lib calculates hash with key, we just extract it for the mock
                    // or let the mock set a dummy. In real sync, the lib expects remote hash to match local.
                    const hasher = crypto.createHash('sha256').update(d);
                    // We don't have the key easily here, so we just set remote hash to whatever lib calculates
                    // This is done inside SovereignS3nc.syncDay
                    await mockS3.uploadFile(`${prefix}/${p}`, d);
                },
                downloadFile: (p: string) => mockS3.downloadFile(`${prefix}/${p}`),
                getFileHash: (p: string) => mockS3.getFileHash(`${prefix}/${p}`)
            } as IRemoteAdapter;
        };

        const sov = new SovereignS3nc(config, factory(userId), factory);
        await sov.init();
        const social = new SocialManager(sov, '');
        return { sov, social };
    }

    test('Alice posts, Bob syncs and sees it', async () => {
        const alice = await setupUser('alice', 'alice-pass');
        const bob = await setupUser('bob', 'bob-pass');
        const today = SovereignS3nc.getDateStr(new Date());

        // 1. Alice posts
        console.log('Alice posting...');
        await alice.social.post('Hello from Alice', true);
        
        // 2. Alice syncs to upload data and register in users.json
        await alice.sov.sync();

        // 3. Bob syncs - should discover Alice and pull her data
        console.log('Bob syncing...');
        await bob.sov.sync();

        // 4. Bob reads feed
        const posts = await bob.social.getPosts('alice/' + today, 'followed');
        
        expect(posts.length).toBe(1);
        expect(posts[0].content).toBe('Hello from Alice');
        expect(posts[0].userId).toBe('alice');
    });
});
