
import { SovereignS3nc } from '../src/SovereignS3nc';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import { ModerationModule } from '../src/modules/Moderation';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';

// --- Browser Polyfills ---
(globalThis as any).indexedDB = new IDBFactory();
(globalThis as any).crypto = crypto.webcrypto;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;
(globalThis as any).initSqlJs = initSqlJs;

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string, etag: string}> = new Map();
    constructor(private prefix: string = '') {}
    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(this.prefix + path, { data, hash: h, etag });
        return etag;
    }
    async downloadFile(path: string, ifNoneMatch?: string): Promise<{data: Uint8Array, etag: string, notModified?: boolean} | null> {
        const f = this.files.get(this.prefix + path);
        if (!f) return null;
        if (ifNoneMatch === f.etag) return { data: f.data, etag: f.etag, notModified: true };
        return f;
    }
    async getFileHash(path: string): Promise<string | null> {
        return this.files.get(this.prefix + path)?.hash || null;
    }
    async getFileEtag(path: string): Promise<string | null> {
        return this.files.get(this.prefix + path)?.etag || null;
    }
    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys())
            .filter(k => k.startsWith(this.prefix + prefix))
            .map(k => k.substring(this.prefix.length));
    }
    async deleteFile(path: string): Promise<void> {
        this.files.delete(this.prefix + path);
    }
    async canWrite(path: string): Promise<boolean> {
        return true;
    }
}

describe('SovereignS3nc Extra Coverage Tests', () => {
    let sov: SovereignS3nc;
    let remote: MockRemote;
    const appId = 'extra-test';
    const userId = 'user-1';

    beforeEach(async () => {
        remote = new MockRemote(appId + '/' + userId + '/social/');
        sov = new SovereignS3nc({
            paths: { appId, userId, storeId: 'social' },
            password: 'password',
            debug: false
        }, remote);
        (sov as any).storage = new IndexedDBStorage(`db_${Math.random()}`);
        await sov.init();
    });

    test('Conflict Resolution: User chooses remote', async () => {
        const today = SovereignS3nc.getDateStr(new Date());
        const path = `public/${today}.db`;
        
        // 1. Create local data
        await sov.getStorage().saveDailyDb(today, 'public', new Uint8Array([1, 2, 3]));
        
        // 2. Create different remote data and set sync hash to trigger conflict
        const remoteData = new Uint8Array([4, 5, 6]);
        const remoteHash = crypto.createHash('sha256').update(remoteData).digest('hex');
        const oldHash = crypto.createHash('sha256').update(new Uint8Array([0,0,0])).digest('hex');
        
        await remote.uploadFile(path, remoteData, remoteHash);
        await sov.getStorage().setGenericRemoteHashCache(`sync_hash:${path}`, oldHash);

        // 3. Listen for conflict and resolve with 'remote'
        sov.on('conflict', (event) => {
            sov.resolveConflict(event.id, 'remote');
        });

        await sov.sync();

        // 4. Verify local data matches remote
        const localData = await sov.getStorage().getDailyDb(today, 'public');
        expect(localData).toEqual(remoteData);
    });

    test('Moderation: Admin export and burn', async () => {
        const mod = new ModerationModule(sov);
        
        // Mock rootRemote
        const rootRemote = new MockRemote(appId + '/');
        (sov as any).rootRemote = rootRemote;

        // Add some data to root
        await rootRemote.uploadFile('user-1/social/public/test.txt', new TextEncoder().encode('hello'));
        
        // Test Export
        const exportJson = await mod.exportAllData();
        const parsed = JSON.parse(exportJson);
        expect(parsed['user-1/social/public/test.txt']).toBeDefined();

        // Test Burn
        await mod.burnItToTheGround();
        const filesAfter = await rootRemote.listFiles('');
        expect(filesAfter.length).toBe(0);
    });

    test('Encryption/Decryption Edge Cases', async () => {
        const data = new TextEncoder().encode('Secret message');
        const key = crypto.randomBytes(32).toString('hex');
        
        const encrypted = await sov.encrypt(data, key);
        const decrypted = await sov.decrypt(encrypted, key);
        
        expect(new TextDecoder().decode(decrypted)).toBe('Secret message');

        // Wrong key
        const wrongKey = crypto.randomBytes(32).toString('hex');
        await expect(sov.decrypt(encrypted, wrongKey)).rejects.toThrow();
    });

    test('Shared Secret Derivation', async () => {
        const aliceKeys = nacl.box.keyPair();
        const bobKeys = nacl.box.keyPair();
        
        const aliceSov = new SovereignS3nc({
            paths: { appId: 'test', userId: 'alice', storeId: 'test' },
            debug: false
        }, undefined, undefined, { 
            privateKey: Buffer.from(aliceKeys.secretKey).toString('hex'),
            publicKey: Buffer.from(aliceKeys.publicKey).toString('hex')
        });
        
        const bobSov = new SovereignS3nc({
            paths: { appId: 'test', userId: 'bob', storeId: 'test' },
            debug: false
        }, undefined, undefined, { 
            privateKey: Buffer.from(bobKeys.secretKey).toString('hex'),
            publicKey: Buffer.from(bobKeys.publicKey).toString('hex')
        });

        const secret1 = aliceSov.deriveSharedSecret(Buffer.from(bobKeys.publicKey).toString('hex'));
        const secret2 = bobSov.deriveSharedSecret(Buffer.from(aliceKeys.publicKey).toString('hex'));
        
        expect(secret1).toBe(secret2);
    });

    test('Data Retention Policy Pruning', async () => {
        const retentionSov = new SovereignS3nc({
            paths: { appId: 'retention-test', userId: 'alice', storeId: 'social' },
            retentionPolicy: {
                maxDaysOwnData: 7,
                maxDaysFollowedData: 3
            }
        });
        await retentionSov.init();

        const storage = retentionSov.getStorage();
        // Save files: some old, some recent
        await storage.saveFile('private/2020-01-01.db', new Uint8Array([1]));
        await storage.saveFile('followed/bob/modules/feed/2020-01-01.db', new Uint8Array([2]));
        const today = new Date().toISOString().split('T')[0];
        await storage.saveFile(`private/${today}.db`, new Uint8Array([3]));
        await storage.saveFile(`followed/bob/modules/feed/${today}.db`, new Uint8Array([4]));

        const pruned = await retentionSov.applyRetentionPolicy();
        expect(pruned).toBe(2);

        expect(await storage.getFile('private/2020-01-01.db')).toBeNull();
        expect(await storage.getFile('followed/bob/modules/feed/2020-01-01.db')).toBeNull();
        expect(await storage.getFile(`private/${today}.db`)).not.toBeNull();
        expect(await storage.getFile(`followed/bob/modules/feed/${today}.db`)).not.toBeNull();
    });

    test('Multi-Device Pairing and Key Transfer', async () => {
        const aliceHost = new SovereignS3nc({
            paths: { appId: 'multi-device-app', userId: 'alice', storeId: 'social' },
            password: 'alice-password-123'
        });
        await aliceHost.init();

        const pairingPassphrase = 'pair-code-xyz-987';
        const pairingPackage = await aliceHost.createDevicePairingPackage(pairingPassphrase, 60_000);
        expect(typeof pairingPackage).toBe('string');

        // New device (empty instance without keys)
        const aliceDevice2 = new SovereignS3nc({
            paths: { appId: 'multi-device-app', userId: 'unknown', storeId: 'social' }
        });

        // Wrong passphrase should fail
        await expect(aliceDevice2.importDevicePairingPackage(pairingPackage, 'wrong-passphrase'))
            .rejects.toThrow(/Failed to decrypt pairing package/);

        // Correct passphrase imports successfully
        const imported = await aliceDevice2.importDevicePairingPackage(pairingPackage, pairingPassphrase);
        expect(imported.userId).toBe('alice');
        expect(aliceDevice2.getConfig().publicEncryptionKey).toBe(aliceHost.getConfig().publicEncryptionKey);
        expect(aliceDevice2.getConfig().encryptionKey).toBe(aliceHost.getConfig().encryptionKey);

        // Expired package should fail
        const expiredPackage = await aliceHost.createDevicePairingPackage(pairingPassphrase, -1000);
        await expect(aliceDevice2.importDevicePairingPackage(expiredPackage, pairingPassphrase))
            .rejects.toThrow(/expired/);
    });

    test('Device Registry Management', async () => {
        const uniqueAppId = 'device-reg-app-' + Math.random().toString(36).substring(7);
        const alice = new SovereignS3nc({
            paths: { appId: uniqueAppId, userId: 'alice', storeId: 'social' },
            password: 'alice-password-123'
        });
        await alice.init();

        const dev1 = await alice.registerDevice('Alice iPhone 15');
        const dev2 = await alice.registerDevice('Alice MacBook Pro');

        let devices = await alice.getRegisteredDevices();
        expect(devices.length).toBe(2);
        expect(devices[0].deviceName).toBe('Alice iPhone 15');
        expect(devices[1].deviceName).toBe('Alice MacBook Pro');
        expect(devices[0].status).toBe('active');

        // Revoke dev1
        await alice.revokeDevice(dev1.deviceId);
        devices = await alice.getRegisteredDevices();
        expect(devices.find(d => d.deviceId === dev1.deviceId)?.status).toBe('revoked');
        expect(devices.find(d => d.deviceId === dev2.deviceId)?.status).toBe('active');
    });
});

import * as nacl from 'tweetnacl';
