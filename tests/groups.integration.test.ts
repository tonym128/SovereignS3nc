
import { SovereignS3nc } from '../src/SovereignS3nc';
import { FeedModule } from '../src/modules/Feed';
import { IRemoteAdapter, DownloadResult } from '../src/interfaces/IRemoteAdapter';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import { GroupMember } from '../src/types';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';
import crypto from 'crypto';

// --- Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

describe('Shared Multi-Writer Rooms (Groups)', () => {
    const mockRemotes: Record<string, Record<string, Uint8Array>> = {};

    function factory(userId: string) {
        if (!mockRemotes[userId]) mockRemotes[userId] = {};
        const remote = mockRemotes[userId];

        return {
            uploadFile: async (path: string, data: Uint8Array) => {
                remote[path] = data;
                return 'etag-' + Math.random();
            },
            downloadFile: async (path: string): Promise<DownloadResult | null> => {
                if (remote[path]) return { data: remote[path], etag: 'etag' };
                return null;
            },
            getFileHash: async (path: string) => null,
            getFileEtag: async (path: string) => null
        } as IRemoteAdapter;
    }

    async function setupUser(userId: string, password = 'password') {
        const config = {
            paths: { appId: 'test-app', userId, storeId: 'main' },
            password,
            debug: true
        };

        const sov = new SovereignS3nc(config, factory(userId), factory);
        // Use consistent DB per user
        (sov as any).storage = new IndexedDBStorage(`db_${userId}`);
        await sov.init();
        const feed = new FeedModule(sov);
        return { sov, feed, userId };
    }

    test('Multi-writer group sync', async () => {
        const alice = await setupUser('alice');
        const bob = await setupUser('bob');

        // 1. Alice creates a group and adds Bob
        const members: GroupMember[] = [
            { userId: 'alice', publicKey: alice.sov.getConfig().publicEncryptionKey!, role: 'owner' },
            { userId: 'bob', publicKey: bob.sov.getConfig().publicEncryptionKey!, role: 'member' }
        ];
        const group = await alice.sov.createGroup('Decentralized Devs', members);
        
        // Alice syncs to upload group info and status
        await alice.sov.sync();

        // 2. Bob joins the group
        await bob.sov.joinGroup(group);
        await bob.sov.respondToGroup(group.id, 'joined');

        // 3. Alice posts to the group
        await alice.feed.postToGroup(group.id, group.sharedKey, 'Hello from Alice!');
        
        // Alice syncs to upload her contribution and manifest
        await alice.sov.sync();

        // 4. Bob syncs to discover Alice's contribution
        await bob.sov.sync();

        const today = new Date().toISOString().split('T')[0];
        const bobViewOfPosts = await bob.feed.getGroupPosts(group.id, today);
        
        expect(bobViewOfPosts.length).toBe(1);
        expect(bobViewOfPosts[0].content).toBe('Hello from Alice!');
        expect(bobViewOfPosts[0].userId).toBe('alice');

        // 5. Bob posts to the same group
        await bob.feed.postToGroup(group.id, group.sharedKey, 'Hey Alice, Bob here!');
        await bob.sov.sync();

        // 6. Alice syncs to see Bob's post
        await alice.sov.sync();

        const aliceViewOfPosts = await alice.feed.getGroupPosts(group.id, today);
        expect(aliceViewOfPosts.length).toBe(2);
        expect(aliceViewOfPosts[0].content).toBe('Hey Alice, Bob here!');
        expect(aliceViewOfPosts[1].content).toBe('Hello from Alice!');
    });
});
