import { SovereignS3nc } from '../src/SovereignS3nc';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import { SovereignConfig } from '../src/types';
import { NodeStorage } from '../src/adapters/NodeStorage';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';

// --- Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string, etag: string}> = new Map();
    isOffline: boolean = false;

    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
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

    async canWrite(path: string): Promise<boolean> {
        if (this.isOffline) throw new Error('Network Error');
        return true;
    }

    async listFiles(prefix: string): Promise<string[]> {
        if (this.isOffline) throw new Error('Network Error');
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }

    async deleteFile(path: string): Promise<void> {
        if (this.isOffline) throw new Error('Network Error');
        this.files.delete(path);
    }
}

describe('SovereignS3nc Unit Tests', () => {
    let mockRemote: MockRemote;
    let config: SovereignConfig;

    beforeEach(() => {
        mockRemote = new MockRemote();
        (global as any).indexedDB = new IDBFactory();
        const testId = Math.random().toString(36).substring(7);
        config = {
            paths: { appId: `test-app-${testId}`, userId: 'alice', storeId: 'main' },
            password: 'password123',
            debug: false,
            localPersistencePath: `./test-data/sov-unit-${testId}/alice`
        };
    });

    describe('Constructor & Initialization', () => {
        test('should fallback to NodeStorage if indexedDB is not available', async () => {
            const originalIDB = (global as any).indexedDB;
            delete (global as any).indexedDB;
            const sov = new SovereignS3nc(config, mockRemote);
            await sov.init();
            expect(sov.getStorage()).toBeInstanceOf(NodeStorage);
            (global as any).indexedDB = originalIDB;
        });

        test('should initialize with provided remote', async () => {
            const sov = new SovereignS3nc(config, mockRemote);
            await sov.init();
            expect(sov).toBeDefined();
        });

        test('should allow startup in local-only mode if no remote or S3 config provided', async () => {
            const noS3Config = { ...config, offline: true };
            delete noS3Config.s3;
            const sov = new SovereignS3nc(noS3Config);
            await sov.init();
            expect(sov).toBeDefined();
        });

        test('should initialize keys if password is provided', async () => {
            const sov = new SovereignS3nc(config, mockRemote);
            await sov.init();
            // Access private config to verify keys were generated
            const internalConfig = (sov as any).config;
            expect(internalConfig.encryptionKey).toBeDefined();
            expect(internalConfig.publicEncryptionKey).toBeDefined();
            
            // Should have uploaded keys to remote
            const keysUploaded = Array.from(mockRemote.files.keys()).some(k => k.endsWith('_keys.json'));
            expect(keysUploaded).toBe(true);
        });
    });

    describe('initKeys scenarios', () => {
        test('should load keys from local storage if available', async () => {
            const sov1 = new SovereignS3nc({ ...config }, mockRemote);
            await sov1.init();
            const keys1 = { 
                privateKey: (sov1 as any).config.encryptionKey, 
                publicKey: (sov1 as any).config.publicEncryptionKey 
            };

            // Re-init with same config and storage (same IDBFactory)
            const sov2 = new SovereignS3nc({ ...config }, mockRemote);
            await sov2.init();
            expect((sov2 as any).config.encryptionKey).toBe(keys1.privateKey);
            expect((sov2 as any).config.publicEncryptionKey).toBe(keys1.publicKey);
            });

            test('should load keys from remote if not local', async () => {
            const sov1 = new SovereignS3nc({ ...config }, mockRemote);
            await sov1.init();
            const keys1 = { 
                privateKey: (sov1 as any).config.encryptionKey, 
                publicKey: (sov1 as any).config.publicEncryptionKey 
            };

            // Clear local storage but keep remote
            (global as any).indexedDB = new IDBFactory();
            const sov2 = new SovereignS3nc({ ...config }, mockRemote);
            await sov2.init();
            expect((sov2 as any).config.encryptionKey).toBe(keys1.privateKey);
            });

            test('should throw error if remote keys fail to decrypt (wrong password)', async () => {
            const sov1 = new SovereignS3nc({ ...config }, mockRemote);
            await sov1.init();

            // Clear local storage
            (global as any).indexedDB = new IDBFactory();

            // Re-init with WRONG password
            const wrongConfig = { ...config, password: 'wrong-password' };
            // MUST ensure encryptionKey/publicEncryptionKey are NOT set in wrongConfig
            delete (wrongConfig as any).encryptionKey;
            delete (wrongConfig as any).publicEncryptionKey;

            const sov2 = new SovereignS3nc(wrongConfig, mockRemote);
            await expect(sov2.init()).rejects.toThrow('Incorrect password. Access denied.');
            });    });

    describe('Syncing', () => {
        test('should not sync if already syncing', async () => {
            const sov = new SovereignS3nc(config, mockRemote);
            await sov.init();
            (sov as any)._isSyncing = true;
            const loggerSpy = jest.spyOn(require('../src/utils/Logger').Logger, 'info');
            await sov.sync();
            expect(loggerSpy).toHaveBeenCalledWith('Sovereign', expect.stringContaining('Sync already in progress, skipping...'));
            loggerSpy.mockRestore();
        });

        test('should sync data to remote', async () => {
            const sov = new SovereignS3nc(config, mockRemote);
            await sov.init();
            
            const today = SovereignS3nc.getDateStr(new Date());
            const dummyData = new Uint8Array([1, 2, 3]);
            await (sov as any).storage.saveDailyDb(today, 'public', dummyData);
            
            await sov.sync();
            
            // Check if uploaded
            const publicPath = `public/${today}.db`;
            const found = Array.from(mockRemote.files.keys()).some(k => k.endsWith(publicPath));
            expect(found).toBe(true);
        });

        test('should download data from remote if missing locally', async () => {
            const sov1 = new SovereignS3nc(config, mockRemote);
            await sov1.init();
            const today = SovereignS3nc.getDateStr(new Date());
            const dummyData = new Uint8Array([1, 2, 3]);
            await (sov1 as any).storage.saveDailyDb(today, 'public', dummyData);
            await sov1.sync();

            // New instance, empty local storage
            (global as any).indexedDB = new IDBFactory();
            const sov2 = new SovereignS3nc(config, mockRemote);
            await sov2.init();
            await sov2.sync();

            const localData = await (sov2 as any).storage.getDailyDb(today, 'public');
            expect(localData).toEqual(dummyData);
        });
    });

    describe('Blobs', () => {
        test('should save and get public blobs', async () => {
            const sov = new SovereignS3nc(config, mockRemote);
            await sov.init();
            const data = new Uint8Array([10, 20, 30]);
            const path = await sov.saveBlob(data, true);
            expect(path).toContain('public/blobs/');
            
            const retrieved = await sov.getBlob(path);
            expect(retrieved).toEqual(data);
        });

        test('should save and get private blobs', async () => {
            const sov = new SovereignS3nc(config, mockRemote);
            await sov.init();
            const data = new Uint8Array([40, 50, 60]);
            const path = await sov.saveBlob(data, false);
            expect(path).toContain('private/blobs/');
            
            const retrieved = await sov.getBlob(path);
            expect(retrieved).toEqual(data);
        });

        test('should fetch public blob from another user', async () => {
            const aliceRemote = new MockRemote();
            const aliceConfig = { ...config, paths: { ...config.paths, userId: 'alice' } };
            const aliceSov = new SovereignS3nc(aliceConfig, aliceRemote);
            await aliceSov.init();
            
            const data = new Uint8Array([70, 80, 90]);
            const path = await aliceSov.saveBlob(data, true);
            await aliceSov.sync();

            // Bob wants Alice's blob
            const bobConfig = { 
                ...config, 
                paths: { ...config.paths, userId: 'bob' },
                localPersistencePath: config.localPersistencePath?.replace('alice', 'bob')
            };
            // Factory to return Alice's remote when requested
            const factory = (uid: string) => uid === 'alice' ? aliceRemote : new MockRemote();
            const bobSov = new SovereignS3nc(bobConfig, new MockRemote(), factory);
            await bobSov.init();

            const retrieved = await bobSov.getBlob(path, 'alice');
            expect(retrieved).toEqual(data);
        });

        test('should throw error when fetching private blob from another user', async () => {
            const sov = new SovereignS3nc(config, mockRemote);
            await sov.init();
            await expect(sov.getBlob('private/blobs/hash', 'bob')).rejects.toThrow('Only public blobs can be fetched from other users');
        });
    });

    describe('Offline & Remote Login Verification', () => {
        test('should create and upload a sentinel file on first initialization', async () => {
            const sov = new SovereignS3nc(config, mockRemote);
            await sov.init();
            
            // Local check
            const sentinel = await (sov as any).storage.getFile('private/sentinel.enc');
            expect(sentinel).toBeDefined();
            expect(sentinel.length).toBeGreaterThan(0);

            // Remote check
            const remoteSentinel = mockRemote.files.get('sentinel.enc');
            expect(remoteSentinel).toBeDefined();
            expect(remoteSentinel?.data).toEqual(sentinel);
        });

        test('should allow offline initialization with correct password', async () => {
            // 1. Initial online setup to create sentinel
            const sov1 = new SovereignS3nc({ ...config }, mockRemote);
            await sov1.init();

            // 2. Offline initialization with SAME password
            mockRemote.isOffline = true;
            // Create a new instance with same storage (simulated by same config/IDB)
            const sov2 = new SovereignS3nc({ ...config }, mockRemote);
            await sov2.init();
            expect(sov2).toBeDefined();
        });

        test('should fail offline initialization with incorrect password', async () => {
            // 1. Initial online setup to create sentinel
            const sov1 = new SovereignS3nc({ ...config }, mockRemote);
            await sov1.init();

            // 2. Offline initialization with WRONG password
            mockRemote.isOffline = true;
            const wrongConfig = { 
                paths: { ...config.paths },
                password: 'wrong-password',
                debug: false,
                localPersistencePath: config.localPersistencePath
            };
            const sov2 = new SovereignS3nc(wrongConfig, mockRemote);
            
            await expect(sov2.init()).rejects.toThrow('Incorrect password. Access denied.');
        });

        test('should allow verification against remote sentinel on a new device', async () => {
            // 1. Setup on device 1
            const sov1 = new SovereignS3nc({ ...config }, mockRemote);
            await sov1.init();

            // 2. New device (empty local storage, but same remote)
            (global as any).indexedDB = new IDBFactory();
            const sov2 = new SovereignS3nc({ ...config }, mockRemote);
            await sov2.init();
            
            // Should have downloaded and saved sentinel locally
            const localSentinel = await (sov2 as any).storage.getFile('private/sentinel.enc');
            expect(localSentinel).toBeDefined();
            expect(localSentinel).toEqual(mockRemote.files.get('sentinel.enc')?.data);
        });

        test('should fail remote verification on new device with incorrect password', async () => {
            // 1. Setup on device 1
            const sov1 = new SovereignS3nc({ ...config }, mockRemote);
            await sov1.init();

            // 2. New device with WRONG password
            (global as any).indexedDB = new IDBFactory();
            const wrongConfig = { ...config, password: 'wrong-password' };
            const sov2 = new SovereignS3nc(wrongConfig, mockRemote);
            
            await expect(sov2.init()).rejects.toThrow('Incorrect password. Access denied.');
        });

        test('should not fail if no sentinel exists (first time offline)', async () => {
            // No sentinel exists yet in this fresh IDBFactory
            mockRemote.isOffline = true;
            const sov = new SovereignS3nc({ ...config }, mockRemote);
            // It should proceed and not throw because we now catch Network Error in initKeys
            await sov.init();
            expect(sov).toBeDefined();
            
            // Should have created a sentinel now
            const sentinel = await (sov as any).storage.getFile('private/sentinel.enc');
            expect(sentinel).toBeDefined();
        });
    });

    describe('Following', () => {
        test('should follow and unfollow users', async () => {
            const sov = new SovereignS3nc(config, mockRemote);
            await sov.init();
            
            // Mock global registry
            const registry = [{ userId: 'bob', publicKey: 'bob-pub-key' }];
            const registryData = new TextEncoder().encode(JSON.stringify(registry));
            await mockRemote.uploadFile('users.json', registryData);

            await sov.follow('bob');
            let following = await sov.getFollowing();
            expect(following.map(u => u.userId)).toContain('bob');

            await sov.unfollow('bob');
            following = await sov.getFollowing();
            expect(following.map(u => u.userId)).not.toContain('bob');
        });

        test('should allow following even if user not in registry (P2P mode support)', async () => {
            const sov = new SovereignS3nc(config, mockRemote);
            await sov.init();
            await sov.follow('non-existent');
            const following = await sov.getFollowing();
            expect(following.map(u => u.userId)).toContain('non-existent');
        });
    });

    describe('Error Scenarios', () => {
        test('sync generic files failure should not crash', async () => {
            const sov = new SovereignS3nc(config, mockRemote);
            await sov.init();
            
            await (sov as any).storage.saveFile('public/blobs/test', new Uint8Array([1]));
            mockRemote.isOffline = true;
            
            // Should just log a warning and not throw
            await sov.sync();
        });

        test('global registration failure should not crash', async () => {
            const sov = new SovereignS3nc(config, mockRemote);
            await sov.init();
            mockRemote.isOffline = true;
            
            await (sov as any).ensureGlobalRegistration();
        });
    });

    describe('sendEncryptedPayload', () => {
        let alice: SovereignS3nc;
        let bob: SovereignS3nc;
        let aliceRemote: MockRemote;
        let bobRemote: MockRemote;

        beforeEach(async () => {
            aliceRemote = new MockRemote();
            bobRemote = new MockRemote();
            const testId = Math.random().toString(36).substring(7);

            const aliceConfig = { 
                paths: { appId: `test-enc-${testId}`, userId: 'alice', storeId: 'main' }, 
                password: 'alice-password',
                localPersistencePath: `./test-data/alice-enc-${testId}`
            };
            const bobConfig = { 
                paths: { appId: `test-enc-${testId}`, userId: 'bob', storeId: 'main' }, 
                password: 'bob-password',
                localPersistencePath: `./test-data/bob-enc-${testId}`
            };

            alice = new SovereignS3nc(aliceConfig as any, aliceRemote, (uid) => uid === 'bob' ? bobRemote : aliceRemote);
            bob = new SovereignS3nc(bobConfig as any, bobRemote, (uid) => uid === 'alice' ? aliceRemote : bobRemote);

            await alice.init();
            await bob.init();

            // Alice follows Bob to get his public key (simulated discovery)
            const registry = [
                { userId: 'alice', publicKey: alice.getConfig().publicEncryptionKey! },
                { userId: 'bob', publicKey: bob.getConfig().publicEncryptionKey! }
            ];
            const registryData = new TextEncoder().encode(JSON.stringify(registry));
            await aliceRemote.uploadFile('users.json', registryData);
            await bobRemote.uploadFile('users.json', registryData);

            await alice.follow('bob');
            await bob.follow('alice');
        });

        test('should encrypt and send payload to recipient inbox', async () => {
            const payload = { message: 'Hello Bob!', type: 'chat' };
            const namespace = 'chat';

            await alice.sendEncryptedPayload('bob', payload, namespace);

            // 1. Check Alice's outbox
            const aliceFiles = await (alice as any).storage.listFiles('private/outbox/bob/chat/');
            expect(aliceFiles.length).toBe(1);
            const outboxData = await (alice as any).storage.getFile(aliceFiles[0]);
            expect(JSON.parse(new TextDecoder().decode(outboxData))).toEqual(payload);

            // 2. Check Alice's public DM inbox (which Bob will pull from)
            const alicePublicFiles = await (alice as any).storage.listFiles('public/dms/bob/chat/');
            expect(alicePublicFiles.length).toBe(1);
            const encryptedData = await (alice as any).storage.getFile(alicePublicFiles[0]);
            
            // 3. Verify Bob can decrypt it
            const sharedSecret = bob.deriveSharedSecret(alice.getConfig().publicEncryptionKey!);
            const decrypted = await bob.decrypt(encryptedData!, sharedSecret);
            expect(JSON.parse(new TextDecoder().decode(decrypted))).toEqual(payload);
        });

        test('should throw error if recipient public key is unknown', async () => {
            await expect(alice.sendEncryptedPayload('charlie', { msg: 'hi' }, 'test'))
                .rejects.toThrow('Recipient public key not found for charlie');
        });
    });
});
