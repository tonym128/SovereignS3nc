import { SovereignS3nc } from '../src/SovereignS3nc';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import { SovereignConfig } from '../src/types';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';

// --- Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string, etag: string}> = new Map();
    public prefix: string = '';

    constructor(prefix: string = '') {
        this.prefix = prefix;
    }

    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
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

    async canWrite(path: string): Promise<boolean> {
        return true;
    }

    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }

    async deleteFile(path: string): Promise<void> {
        this.files.delete(path);
    }

    async purge(): Promise<void> {
        this.files.clear();
    }
}

describe('SovereignS3nc Change Password Tests', () => {
    let config: SovereignConfig;
    let remotes: Map<string, MockRemote>;
    let remoteFactory: (userId: string) => IRemoteAdapter;

    beforeEach(() => {
        (global as any).indexedDB = new IDBFactory();
        remotes = new Map();
        remoteFactory = (userId: string) => {
            if (!remotes.has(userId)) {
                remotes.set(userId, new MockRemote(userId));
            }
            return remotes.get(userId)!;
        };

        config = {
            paths: { appId: 'test-app', userId: 'alice', storeId: 'main' },
            password: 'oldPassword123',
            debug: false
        };
    });

    test('should change password and migrate remote data', async () => {
        const sov = new SovereignS3nc(config, undefined, remoteFactory);
        await sov.init();

        // Check initial state
        const oldPrivateId = crypto.pbkdf2Sync('oldPassword123', 'alice-private-id', 1000, 32, 'sha256').toString('hex');
        const oldRemote = remotes.get(oldPrivateId);
        expect(oldRemote).toBeDefined();
        expect(oldRemote?.files.has('_keys.json')).toBe(true);

        // Add some dummy private data
        const today = SovereignS3nc.getDateStr(new Date());
        const dummyData = new TextEncoder().encode('some private data');
        await sov.getStorage().saveDailyDb(today, 'private', dummyData);
        await sov.sync(); // This should upload the dummy data to the old remote

        expect(oldRemote?.files.has(`private/${today}.db`)).toBe(true);

        // Change password
        const newPassword = 'newPassword456';
        await sov.changePassword('oldPassword123', newPassword);

        // Check new state
        const newPrivateId = crypto.pbkdf2Sync(newPassword, 'alice-private-id', 1000, 32, 'sha256').toString('hex');
        const newRemote = remotes.get(newPrivateId);
        expect(newRemote).toBeDefined();
        expect(newRemote).not.toBe(oldRemote);

        // Verify data migrated to new remote
        expect(newRemote?.files.has('_keys.json')).toBe(true);
        expect(newRemote?.files.has(`private/${today}.db`)).toBe(true);

        // Verify old remote is purged
        expect(oldRemote?.files.size).toBe(0);

        // Verify local sentinel still works with new password
        // We can simulate this by re-initializing a new Sovereign instance with the same storage and new password
        const newSov = new SovereignS3nc({
            ...config,
            password: newPassword
        }, undefined, remoteFactory, undefined, sov.getStorage());
        
        await newSov.init();
        expect(newSov.getConfig().encryptionKey).toBe(sov.getConfig().encryptionKey);
    });

    test('should fail with incorrect old password', async () => {
        const sov = new SovereignS3nc(config, undefined, remoteFactory);
        await sov.init();

        await expect(sov.changePassword('wrongPassword', 'newPassword')).rejects.toThrow('Incorrect old password.');
    });
});
