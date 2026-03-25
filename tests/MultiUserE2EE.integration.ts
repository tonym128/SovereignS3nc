
import { SovereignS3nc } from '../src/SovereignS3nc';
import { MessagingModule, Message } from '../src/modules/Messaging';
import { ProfileModule } from '../src/modules/Profile';
import { IRemoteAdapter, DownloadResult } from '../src/interfaces/IRemoteAdapter';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';

// --- Browser/Node Polyfills for Test ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

// Shared Mock Storage to simulate S3 Backend
const sharedFiles = new Map<string, { data: Uint8Array, hash: string, etag: string }>();

class MockRemote implements IRemoteAdapter {
    constructor(private files: Map<string, any>, private prefix: string) {}
    
    private getKey(path: string) {
        // Handle absolute paths if they ever creep in, but mostly relative to prefix
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

    async canWrite(path: string): Promise<boolean> {
        return true;
    }

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

describe('Multi-User E2EE Integration Test', () => {
    let aliceSov: SovereignS3nc;
    let bobSov: SovereignS3nc;
    let aliceMessaging: MessagingModule;
    let bobMessaging: MessagingModule;
    let aliceProfile: ProfileModule;
    let bobProfile: ProfileModule;

    const appId = 'e2ee-test-app-' + Math.random().toString(36).substring(7);

    // Factory to provide remotes scoped to appId and userId
    const remoteFactory = (uid: string) => {
        if (uid === 'global') {
            return new MockRemote(sharedFiles, `${appId}/global/users`);
        }
        // Simplified store path for Mock: appId/userId/main
        return new MockRemote(sharedFiles, `${appId}/${uid}/main`);
    };

    beforeAll(async () => {
        // --- Initialize User A (Alice) ---
        aliceSov = new SovereignS3nc(
            {
                paths: { appId, userId: 'alice', storeId: 'main' },
                password: 'alice-password',
                debug: false,
                autoFollowDiscoveredUsers: true // Enable discovery
            },
            remoteFactory('alice'),
            remoteFactory
        );
        (aliceSov as any).storage = new IndexedDBStorage(`alice_storage_${appId}`);
        await aliceSov.init();
        aliceMessaging = new MessagingModule(aliceSov);
        aliceProfile = new ProfileModule(aliceSov);

        // --- Initialize User B (Bob) ---
        bobSov = new SovereignS3nc(
            {
                paths: { appId, userId: 'bob', storeId: 'main' },
                password: 'bob-password',
                debug: false
            },
            remoteFactory('bob'),
            remoteFactory
        );
        (bobSov as any).storage = new IndexedDBStorage(`bob_storage_${appId}`);
        await bobSov.init();
        bobMessaging = new MessagingModule(bobSov);
        bobProfile = new ProfileModule(bobSov);

        // Bob updates his profile to be "discoverable"
        await bobProfile.updateProfile("Bob Builder", "I can fix it");
        // Alice updates her profile
        await aliceProfile.updateProfile("Alice Wonderland", "Curiouser and curiouser");
    }, 60000);

    test('User B is registered and User A discovers/follows User B', async () => {
        // 1. Bob syncs to ensure his registry entry and public profile are uploaded
        await bobSov.sync();

        // Verify Bob is in shared storage
        const globalRegistryKey = `${appId}/global/users/users.json`;
        expect(sharedFiles.has(globalRegistryKey)).toBe(true);

        // 2. Alice syncs to discover Bob
        await aliceSov.sync();

        // Verify Alice discovered Bob
        const following = await aliceSov.getFollowing();
        expect(following.find(u => u.userId === 'bob')).toBeDefined();
        
        // Verify Alice has Bob's public key
        const bob = following.find(u => u.userId === 'bob');
        expect(bob?.publicKey).toBeDefined();
        expect(bob?.publicKey).toBe(bobSov.getConfig().publicEncryptionKey);
    });

    test('User A sends E2EE message to User B and Bob reads it', async () => {
        const messageContent = "Hello Bob! This is a secret message.";
        
        // 1. Alice sends DM to Bob
        await aliceMessaging.sendDirectMessage('bob', messageContent);

        // 2. Alice syncs to upload the DM
        await aliceSov.sync();

        // Verify DM file exists in Alice's public space (scoped to Bob's ID)
        const today = SovereignS3nc.getDateStr(new Date());
        // Path logic: appId/alice/main/public/modules/messaging/dms/bob/YYYY-MM-DD.db
        const dmFileKey = `${appId}/alice/main/public/modules/messaging/dms/bob/${today}.db`;
        expect(sharedFiles.has(dmFileKey)).toBe(true);

        // 3. Bob syncs to pull the DM from Alice's space
        await bobSov.sync();

        // 4. Verify Bob can read and decrypt the message
        const messages = await bobMessaging.getInboxMessages(1);
        const secretMsg = messages.find(m => m.senderId === 'alice' && m.content === messageContent);
        
        expect(secretMsg).toBeDefined();
        expect(secretMsg?.content).toBe(messageContent);
        expect(secretMsg?.recipientId).toBe('bob');
        expect(secretMsg?.senderId).toBe('alice');
    });

    test('E2EE verification: Shared secret is identical for both', () => {
        const aliceShared = aliceSov.deriveSharedSecret(bobSov.getConfig().publicEncryptionKey!);
        const bobShared = bobSov.deriveSharedSecret(aliceSov.getConfig().publicEncryptionKey!);
        expect(aliceShared).toBe(bobShared);
    });
});
