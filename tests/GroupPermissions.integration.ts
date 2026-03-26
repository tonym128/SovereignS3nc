
import { SovereignS3nc } from '../src/SovereignS3nc';
import { FeedModule } from '../src/modules/Feed';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import { IRemoteAdapter, DownloadResult } from '../src/interfaces/IRemoteAdapter';
import { GroupMember, SovereignGroup } from '../src/types';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';

// --- Browser Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

// Shared storage for all mock remotes
const sharedFiles = new Map<string, { data: Uint8Array, hash: string, etag: string }>();

class MockRemote implements IRemoteAdapter {
    constructor(private files: Map<string, any>, private prefix: string) {}
    
    private getKey(path: string) {
        const cleanPath = path.startsWith('/') ? path.substring(1) : path;
        return `${this.prefix}/${cleanPath}`.replace(/\/+/g, '/');
    }

    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        const key = this.getKey(path);
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(key, { data, hash: h, etag });
        return etag;
    }

    async downloadFile(path: string, ifNoneMatch?: string): Promise<DownloadResult | null> {
        const key = this.getKey(path);
        const entry = this.files.get(key);
        if (!entry) return null;
        if (ifNoneMatch && ifNoneMatch === entry.etag) {
            return { data: null, etag: entry.etag, notModified: true };
        }
        return { data: entry.data, etag: entry.etag };
    }

    async getFileHash(path: string): Promise<string | null> {
        return this.files.get(this.getKey(path))?.hash || null;
    }

    async getFileEtag(path: string): Promise<string | null> {
        return this.files.get(this.getKey(path))?.etag || null;
    }

    async canWrite(path: string): Promise<boolean> { return true; }

    async listFiles(prefix: string): Promise<string[]> {
        const fullPrefix = this.getKey(prefix);
        return Array.from(this.files.keys())
            .filter(k => k.startsWith(fullPrefix))
            .map(k => k.substring(this.prefix.length + 1));
    }

    async deleteFile(path: string): Promise<void> {
        this.files.delete(this.getKey(path));
    }
}

describe('Group Permissions Integration Tests', () => {
    let aliceSov: SovereignS3nc;
    let bobSov: SovereignS3nc;
    let charlieSov: SovereignS3nc;
    let daveSov: SovereignS3nc;

    let aliceFeed: FeedModule;
    let bobFeed: FeedModule;
    let charlieFeed: FeedModule;
    let daveFeed: FeedModule;

    const appId = 'group-perm-test-' + Math.random().toString(36).substring(7);
    const storeId = 'social';

    const remoteFactory = (uid: string) => {
        if (uid === 'global') return new MockRemote(sharedFiles, `${appId}/global/users`);
        return new MockRemote(sharedFiles, `${appId}/${uid}/${storeId}`);
    };

    const setupUser = async (userId: string, password: string) => {
        // We simulate how SovereignS3nc handles hashing if we don't provide a remote directly
        // But for Mock, we'll just use the userId as a simple prefix
        const sov = new SovereignS3nc({
            paths: { appId, userId, storeId },
            password
        }, remoteFactory(userId), remoteFactory);
        (sov as any).storage = new IndexedDBStorage(`${userId}_db_${appId}`);
        await sov.init();
        const feed = new FeedModule(sov);
        return { sov, feed };
    };

    beforeAll(async () => {
        const alice = await setupUser('alice', 'alice-pass');
        aliceSov = alice.sov;
        aliceFeed = alice.feed;

        const bob = await setupUser('bob', 'bob-pass');
        bobSov = bob.sov;
        bobFeed = bob.feed;

        const charlie = await setupUser('charlie', 'charlie-pass');
        charlieSov = charlie.sov;
        charlieFeed = charlie.feed;

        const dave = await setupUser('dave', 'dave-pass');
        daveSov = dave.sov;
        daveFeed = dave.feed;

        // Sync once to establish public presence
        await aliceSov.sync();
        await bobSov.sync();
        await charlieSov.sync();
        await daveSov.sync();

        // Share public keys via registry (simulated follow)
        const registry = [
            { userId: 'alice', publicKey: aliceSov.getConfig().publicEncryptionKey! },
            { userId: 'bob', publicKey: bobSov.getConfig().publicEncryptionKey! },
            { userId: 'charlie', publicKey: charlieSov.getConfig().publicEncryptionKey! },
            { userId: 'dave', publicKey: daveSov.getConfig().publicEncryptionKey! }
        ];
        
        // We use alice as a source for the registry
        const registryData = new TextEncoder().encode(JSON.stringify(registry));
        await (aliceSov as any).globalRemote.uploadFile('users.json', registryData);
        
        await aliceSov.follow('bob');
        await aliceSov.follow('charlie');
        await bobSov.follow('alice');
        await bobSov.follow('charlie');
        await charlieSov.follow('alice');
        await charlieSov.follow('bob');
    }, 30000);

    test('Group creation and basic read/write access', async () => {
        const today = SovereignS3nc.getDateStr(new Date());
        // 1. Alice creates a group with Bob and Charlie
        const members: GroupMember[] = [
            { userId: 'alice', publicKey: aliceSov.getConfig().publicEncryptionKey!, role: 'owner' },
            { userId: 'bob', publicKey: bobSov.getConfig().publicEncryptionKey!, role: 'admin' },
            { userId: 'charlie', publicKey: charlieSov.getConfig().publicEncryptionKey!, role: 'member' }
        ];
        const group = await aliceSov.createGroup('Test Group', members);

        // 2. Alice posts to the group
        await aliceFeed.postToGroup(group.id, group.sharedKey, "Hello Group!");
        await aliceSov.sync();

        // 3. Bob and Charlie join and sync
        await bobSov.joinGroup(group);
        await bobSov.respondToGroup(group.id, 'joined');
        await charlieSov.joinGroup(group);
        await charlieSov.respondToGroup(group.id, 'joined');

        await bobSov.sync();
        await charlieSov.sync();

        // 4. Verify Bob and Charlie can see the post
        const bobPosts = await bobFeed.getGroupPosts(group.id, today);
        expect(bobPosts.length).toBe(1);
        expect(bobPosts[0].content).toBe("Hello Group!");

        const charliePosts = await charlieFeed.getGroupPosts(group.id, today);
        expect(charliePosts.length).toBe(1);
        expect(charliePosts[0].content).toBe("Hello Group!");

        // 5. Dave (non-member) cannot see the group or its posts
        const daveGroups = await daveSov.getGroups();
        expect(daveGroups.find(g => g.id === group.id)).toBeUndefined();
    });

    test('Moderation roles: Admin can moderate member posts', async () => {
        const groups = await aliceSov.getGroups();
        const group = groups[0];
        const today = SovereignS3nc.getDateStr(new Date());

        // 1. Charlie (member) posts something
        await charlieFeed.postToGroup(group.id, group.sharedKey, "Charlie's post");
        await charlieSov.sync();
        
        // Alice and Bob sync to see it
        await aliceSov.sync();
        await bobSov.sync();
        
        let posts = await aliceFeed.getGroupPosts(group.id, today);
        const charliePost = posts.find(p => p.content === "Charlie's post");
        expect(charliePost).toBeDefined();

        // 2. Bob (admin) moderates Charlie's post
        await bobFeed.deleteGroupPost(group.id, group.sharedKey, charliePost!.id, today, 'charlie');
        await bobSov.sync();

        // 3. Alice and Charlie sync
        await aliceSov.sync();
        await charlieSov.sync();

        // 4. Verify post is hidden for Alice and Bob
        const alicePostsAfter = await aliceFeed.getGroupPosts(group.id, today);
        expect(alicePostsAfter.find(p => p.id === charliePost!.id)).toBeUndefined();

        const bobPostsAfter = await bobFeed.getGroupPosts(group.id, today);
        expect(bobPostsAfter.find(p => p.id === charliePost!.id)).toBeUndefined();
    });

    test('Moderation roles: Member cannot moderate admin/owner posts', async () => {
        const groups = await aliceSov.getGroups();
        const group = groups[0];
        const today = SovereignS3nc.getDateStr(new Date());

        // 1. Alice (owner) posts something
        await aliceFeed.postToGroup(group.id, group.sharedKey, "Alice's post");
        await aliceSov.sync();
        
        await charlieSov.sync();
        let posts = await charlieFeed.getGroupPosts(group.id, today);
        const alicePost = posts.find(p => p.content === "Alice's post");
        expect(alicePost).toBeDefined();

        // 2. Charlie (member) attempts to moderate Alice's post
        await charlieFeed.deleteGroupPost(group.id, group.sharedKey, alicePost!.id, today, 'alice');
        await charlieSov.sync();

        // 3. Alice and Bob sync
        await aliceSov.sync();
        await bobSov.sync();

        // 4. Verify post is STILL VISIBLE for Alice and Bob
        const alicePostsAfter = await aliceFeed.getGroupPosts(group.id, today);
        expect(alicePostsAfter.find(p => p.id === alicePost!.id)).toBeDefined();

        const bobPostsAfter = await bobFeed.getGroupPosts(group.id, today);
        expect(bobPostsAfter.find(p => p.id === alicePost!.id)).toBeDefined();
    });

    test('Member removal and access revocation', async () => {
        const groups = await aliceSov.getGroups();
        const group = groups[0];
        const today = SovereignS3nc.getDateStr(new Date());

        // 1. Alice removes Charlie from the group
        const updatedMembers = group.members.filter(m => m.userId !== 'charlie');
        group.members = updatedMembers;
        await aliceSov.updateGroup(group);
        await aliceSov.sync();

        // 2. Alice posts new content
        await aliceFeed.postToGroup(group.id, group.sharedKey, "Secret post without Charlie");
        await aliceSov.sync();

        // 3. Charlie tries to sync
        await charlieSov.sync();

        // 4. Charlie should NOT see the new post
        const charliePostsAfter = await charlieFeed.getGroupPosts(group.id, today);
        expect(charliePostsAfter.find(p => p.content === "Secret post without Charlie")).toBeUndefined();
        
        await bobSov.sync();
        const bobGroup = (await bobSov.getGroups()).find(g => g.id === group.id);
        expect(bobGroup!.members.find(m => m.userId === 'charlie')).toBeUndefined();
    });

    test('Nested groups (Simulated via membership)', async () => {
        const groupA = await aliceSov.createGroup('Group A', [
            { userId: 'alice', publicKey: aliceSov.getConfig().publicEncryptionKey!, role: 'owner' },
            { userId: 'bob', publicKey: bobSov.getConfig().publicEncryptionKey!, role: 'member' }
        ]);
        
        const groupB = await aliceSov.createGroup('Group B', [
            { userId: 'alice', publicKey: aliceSov.getConfig().publicEncryptionKey!, role: 'owner' },
            { userId: 'charlie', publicKey: charlieSov.getConfig().publicEncryptionKey!, role: 'member' },
            ...groupA.members.filter(m => m.userId !== 'alice')
        ]);
        
        expect(groupB.members.find(m => m.userId === 'bob')).toBeDefined();
        expect(groupB.members.find(m => m.userId === 'charlie')).toBeDefined();
    });
});
