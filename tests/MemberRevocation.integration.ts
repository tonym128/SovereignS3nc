
import { SovereignS3nc } from '../src/SovereignS3nc';
import { FeedModule } from '../src/modules/Feed';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import { IRemoteAdapter, DownloadResult } from '../src/interfaces/IRemoteAdapter';
import { GroupMember } from '../src/types';
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

describe('Member Revocation Integration Tests', () => {
    let aliceSov: SovereignS3nc;
    let bobSov: SovereignS3nc;
    let charlieSov: SovereignS3nc;

    const appId = 'revocation-test-' + Math.random().toString(36).substring(7);
    const storeId = 'social';

    const remoteFactory = (uid: string) => {
        if (uid === 'global') return new MockRemote(sharedFiles, `${appId}/global/users`);
        return new MockRemote(sharedFiles, `${appId}/${uid}/${storeId}`);
    };

    const setupUser = async (userId: string, password: string) => {
        const sov = new SovereignS3nc({
            paths: { appId, userId, storeId },
            password
        }, remoteFactory(userId), remoteFactory);
        (sov as any).storage = new IndexedDBStorage(`${userId}_db_${appId}`);
        await sov.init();
        return sov;
    };

    beforeAll(async () => {
        aliceSov = await setupUser('alice', 'alice-pass');
        bobSov = await setupUser('bob', 'bob-pass');
        charlieSov = await setupUser('charlie', 'charlie-pass');

        await aliceSov.sync();
        await bobSov.sync();
        await charlieSov.sync();

        // Share public keys via registry
        const registry = [
            { userId: 'alice', publicKey: aliceSov.getConfig().publicEncryptionKey! },
            { userId: 'bob', publicKey: bobSov.getConfig().publicEncryptionKey! },
            { userId: 'charlie', publicKey: charlieSov.getConfig().publicEncryptionKey! }
        ];
        const registryData = new TextEncoder().encode(JSON.stringify(registry));
        await (aliceSov as any).globalRemote.uploadFile('users.json', registryData);
        
        await aliceSov.follow('bob');
        await aliceSov.follow('charlie');
        await bobSov.follow('alice');
        await bobSov.follow('charlie');
        await charlieSov.follow('alice');
        await charlieSov.follow('bob');
    }, 30000);

    test('Revocation propagates and stops sync from revoked member', async () => {
        // 1. Alice creates a group with Bob and Charlie
        const members: GroupMember[] = [
            { userId: 'alice', publicKey: aliceSov.getConfig().publicEncryptionKey!, role: 'owner' },
            { userId: 'bob', publicKey: bobSov.getConfig().publicEncryptionKey!, role: 'member' },
            { userId: 'charlie', publicKey: charlieSov.getConfig().publicEncryptionKey!, role: 'member' }
        ];
        const group = await aliceSov.createGroup('Revocation Group', members);

        // 2. Bob and Charlie join
        await bobSov.joinGroup(group);
        await charlieSov.joinGroup(group);

        await aliceSov.sync();
        await bobSov.sync();
        await charlieSov.sync();

        // 3. Verify all see each other in the group
        let aliceGroup = (await aliceSov.getGroups())[0];
        expect(aliceGroup.members.length).toBe(3);

        // 4. Alice removes Charlie
        aliceGroup.members = aliceGroup.members.filter(m => m.userId !== 'charlie');
        await aliceSov.updateGroup(aliceGroup);
        await aliceSov.sync();

        // 5. Bob syncs and should see Charlie is gone
        await bobSov.sync();
        let bobGroup = (await bobSov.getGroups()).find(g => g.id === group.id);
        expect(bobGroup!.members.find(m => m.userId === 'charlie')).toBeUndefined();
        expect(bobGroup!.members.length).toBe(2);

        // 6. Charlie syncs - he still sees the old group state locally
        
        // 7. Verify Alice doesn't pull Charlie's new posts
        const charlieFeed = new FeedModule(charlieSov);
        await charlieFeed.postToGroup(group.id, group.sharedKey, "Charlie's rogue post");
        await charlieSov.sync();

        await aliceSov.sync();
        const aliceFeed = new FeedModule(aliceSov);
        const today = SovereignS3nc.getDateStr(new Date());
        const alicePosts = await aliceFeed.getGroupPosts(group.id, today);
        expect(alicePosts.find(p => p.content === "Charlie's rogue post")).toBeUndefined();
    });
});
