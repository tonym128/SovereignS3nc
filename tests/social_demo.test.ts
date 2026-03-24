
import { SovereignS3nc } from '../src/SovereignS3nc';
import { FeedModule, Post } from '../src/modules/Feed';
import { MessagingModule, Message } from '../src/modules/Messaging';
import { ProfileModule } from '../src/modules/Profile';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';

// --- Browser Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string, etag: string}> = new Map();
    isOffline: boolean = false;

    async uploadFile(path: string, data: Uint8Array, hash?: string, metadata?: Record<string, string>): Promise<string | null> {
        if (this.isOffline) throw new Error('Network Error');
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: h, etag });
        return etag;
    }

    async downloadFile(path: string, ifNoneMatch?: string): Promise<any | null> {
        if (this.isOffline) throw new Error('Network Error');
        const entry = this.files.get(path);
        if (!entry) return null;
        if (ifNoneMatch && ifNoneMatch === entry.etag) {
            return { data: null, etag: entry.etag, notModified: true };
        }
        return { data: entry.data, etag: entry.etag };
    }

    async getFileHash(path: string): Promise<string | null> {
        if (this.isOffline) throw new Error('Network Error');
        return this.files.get(path)?.hash || null;
    }

    async getFileEtag(path: string): Promise<string | null> {
        if (this.isOffline) throw new Error('Network Error');
        return this.files.get(path)?.etag || null;
    }

    async getFileMetadata(path: string, key: string): Promise<string | null> { return null; }
    async canWrite(path: string): Promise<boolean> { return !this.isOffline; }
    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path: string): Promise<void> { this.files.delete(path); }
    async purge(): Promise<void> { this.files.clear(); }
}

describe('Social Demo Full Functionality', () => {
    let mockS3: MockRemote;

    beforeEach(() => {
        mockS3 = new MockRemote();
        (global as any).indexedDB = new IDBFactory();
    });

    async function setupUser(userId: string, password: string) {
        const config = {
            paths: { appId: 'social-app', userId: userId, storeId: 'main' },
            password: password
        };

        const factory = (uid: string) => {
            const prefix = uid === 'global' ? 'social-app/global/users' : `social-app/${uid}/main`;
            return {
                uploadFile: (p: string, d: Uint8Array, h?: string) => mockS3.uploadFile(`${prefix}/${p}`, d, h),
                downloadFile: (p: string, etag?: string) => mockS3.downloadFile(`${prefix}/${p}`, etag),
                getFileHash: (p: string) => mockS3.getFileHash(`${prefix}/${p}`),
                getFileEtag: (p: string) => mockS3.getFileEtag(`${prefix}/${p}`)
            } as IRemoteAdapter;
        };

        const sov = new SovereignS3nc(config, factory(userId), factory);
        await sov.init();
        return { 
            sov, 
            feed: new FeedModule(sov),
            messaging: new MessagingModule(sov),
            profile: new ProfileModule(sov)
        };
    }

    test('Friendship, Blobs, and DMs', async () => {
        const alice = await setupUser('alice', 'alice-pass');
        const bob = await setupUser('bob', 'bob-pass');
        const today = SovereignS3nc.getDateStr(new Date());

        // 1. Initial Sync to Register Alice and Bob globally
        await alice.sov.sync();
        await bob.sov.sync();

        // 2. Friendship (Bob follows Alice, Alice follows Bob)
        await bob.sov.follow('alice');
        await alice.sov.follow('bob');
        const following = await bob.sov.getFollowing();
        expect(following.find(u => u.userId === 'alice')).toBeDefined();

        // 3. Blobs (Alice posts an image)
        const dummyImage = new Uint8Array([1, 2, 3, 4, 5]);
        await alice.feed.post('Alice with image', true, dummyImage);
        await alice.sov.sync();

        // Bob syncs and sees the image
        await bob.sov.sync();
        const alicePosts = await bob.feed.getPosts('alice/' + today, 'followed');
        expect(alicePosts.length).toBe(1);
        expect(alicePosts[0].image).toBeDefined();

        const blobData = await bob.sov.getBlob(alicePosts[0].image!, 'alice');
        expect(blobData).toEqual(dummyImage);

        // 4. Direct Messaging (Bob sends a message to Alice)
        await bob.messaging.sendDirectMessage('alice', 'Hi Alice!');
        await bob.sov.sync();
        
        // Alice syncs and sees the message
        await alice.sov.sync();
        const inbox = await alice.messaging.getInboxMessages();
        const msg = inbox.find(m => m.senderId === 'bob' && m.content === 'Hi Alice!');
        expect(msg).toBeDefined();

        // 5. Offline Mode
        mockS3.isOffline = true;
        // Alice should still be able to post while offline
        await alice.feed.post('Offline post', true);
        const offlinePosts = await alice.feed.getPosts(today, 'public');
        expect(offlinePosts.find(p => p.content === 'Offline post')).toBeDefined();

        // Sync should fail but not crash
        await alice.sov.sync(); 
        
        // Go back online
        mockS3.isOffline = false;
        await alice.sov.sync(); // Now it should upload
        
        await bob.sov.sync();
        const alicePostsAfterOffline = await bob.feed.getPosts('alice/' + today, 'followed');
        expect(alicePostsAfterOffline.find(p => p.content === 'Offline post')).toBeDefined();
    });

    test('Profile management', async () => {
        const alice = await setupUser('alice', 'alice-pass');
        const bob = await setupUser('bob', 'bob-pass');

        await alice.profile.updateProfile('Alice A.', 'I love decentralization', 'avatar-data');
        await alice.sov.sync();

        await bob.sov.follow('alice');
        await bob.profile.syncOtherProfiles();
        
        const aliceProfile = await bob.profile.getProfile('alice');
        expect(aliceProfile!.name).toBe('Alice A.');
        expect(aliceProfile!.bio).toBe('I love decentralization');
    });
});
