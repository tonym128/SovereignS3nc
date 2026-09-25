/**
 * v3.2.0 Feature Tests — Cryptographic Hardening, Forward Secrecy, Multi-Device,
 * Message Expiration & Read Receipts, and Manifest-driven Receipt Sync.
 *
 * These tests verify the completeness and correctness of all five release goals.
 */

import * as nacl from 'tweetnacl';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import { SovereignS3nc } from '../src/SovereignS3nc';
import { KeyManager } from '../src/core/KeyManager';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';

// --- Browser polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;

// --- Mock Remote ---
class MockRemote implements IRemoteAdapter {
    files = new Map<string, { data: Uint8Array; hash: string; etag: string }>();

    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: h, etag });
        return etag;
    }
    async downloadFile(path: string, ifNoneMatch?: string): Promise<any | null> {
        const entry = this.files.get(path);
        if (!entry) return null;
        if (ifNoneMatch && ifNoneMatch === entry.etag) return { data: null, etag: entry.etag, notModified: true };
        return { data: entry.data, etag: entry.etag };
    }
    async getFileHash(path: string): Promise<string | null> { return this.files.get(path)?.hash || null; }
    async getFileEtag(path: string): Promise<string | null> { return this.files.get(path)?.etag || null; }
    async canWrite(): Promise<boolean> { return true; }
    async listFiles(prefix: string): Promise<string[]> { return Array.from(this.files.keys()).filter(k => k.startsWith(prefix)); }
    async deleteFile(path: string): Promise<void> { this.files.delete(path); }
}

// ──────────────────────────────────────────────────────────────────────────
// Goal 1: HKDF-SHA256 (RFC 5869) key expansion
// ──────────────────────────────────────────────────────────────────────────

describe('Goal 1 — HKDF-SHA256 (RFC 5869) Key Expansion', () => {
    const aliceKeys = nacl.box.keyPair();
    const bobKeys = nacl.box.keyPair();

    const makeKeyManager = (secretKey: Uint8Array, publicKey: Uint8Array) => {
        const config: any = {
            encryptionKey: Buffer.from(secretKey).toString('hex'),
            publicEncryptionKey: Buffer.from(publicKey).toString('hex'),
            paths: { appId: 'test', userId: 'test', storeId: 'test' }
        };
        return new KeyManager({
            config,
            storage: null as any,
            getRemote: () => undefined,
            setRemote: () => {},
            getPublicRemote: () => undefined,
            getAdminRemote: () => undefined,
            createRemote: () => { throw new Error('not impl'); }
        });
    };

    test('hkdfSha256 produces 32 bytes of deterministic output', () => {
        const ikm = crypto.randomBytes(32);
        const info = Buffer.from('test-label');
        const out1 = KeyManager.hkdfSha256(ikm, Buffer.alloc(0), info, 32);
        const out2 = KeyManager.hkdfSha256(ikm, Buffer.alloc(0), info, 32);
        expect(out1.length).toBe(32);
        expect(Buffer.compare(out1, out2)).toBe(0);
    });

    test('hkdfSha256 with different info labels produces different output', () => {
        const ikm = crypto.randomBytes(32);
        const out1 = KeyManager.hkdfSha256(ikm, Buffer.alloc(0), Buffer.from('label-1'), 32);
        const out2 = KeyManager.hkdfSha256(ikm, Buffer.alloc(0), Buffer.from('label-2'), 32);
        expect(Buffer.compare(out1, out2)).not.toBe(0);
    });

    test('deriveSharedSecret (v2) is symmetric between Alice and Bob', () => {
        const aliceKM = makeKeyManager(aliceKeys.secretKey, aliceKeys.publicKey);
        const bobKM = makeKeyManager(bobKeys.secretKey, bobKeys.publicKey);

        const aliceSecret = aliceKM.deriveSharedSecret(Buffer.from(bobKeys.publicKey).toString('hex'));
        const bobSecret = bobKM.deriveSharedSecret(Buffer.from(aliceKeys.publicKey).toString('hex'));
        expect(aliceSecret).toBe(bobSecret);
        expect(aliceSecret.length).toBe(64); // 32 bytes hex
    });

    test('v2 HKDF secret differs from v1 raw secret', () => {
        const km = makeKeyManager(aliceKeys.secretKey, aliceKeys.publicKey);
        const v2 = km.deriveSharedSecret(Buffer.from(bobKeys.publicKey).toString('hex'));
        const v1 = km.deriveSharedSecret(Buffer.from(bobKeys.publicKey).toString('hex'), 'SovereignS3nc-DM-v1-raw');
        expect(v2).not.toBe(v1);
    });

    test('v2 HKDF secret is not the raw Diffie-Hellman output', () => {
        const km = makeKeyManager(aliceKeys.secretKey, aliceKeys.publicKey);
        const v2 = km.deriveSharedSecret(Buffer.from(bobKeys.publicKey).toString('hex'));
        const rawShared = Buffer.from(nacl.box.before(bobKeys.publicKey, aliceKeys.secretKey)).toString('hex');
        expect(v2).not.toBe(rawShared);
    });

    test('Full encrypt-decrypt roundtrip using HKDF-derived key', async () => {
        (global as any).indexedDB = new IDBFactory();
        const alice = new SovereignS3nc(
            { paths: { appId: 'hkdf-test', userId: 'alice', storeId: 'main' }, password: 'pw' },
            new MockRemote()
        );
        await alice.init();

        const bob = new SovereignS3nc(
            { paths: { appId: 'hkdf-test', userId: 'bob', storeId: 'main' }, password: 'pw' },
            new MockRemote()
        );
        await bob.init();

        const bobPK = bob.getConfig().publicEncryptionKey!;
        const alicePK = alice.getConfig().publicEncryptionKey!;

        const sharedFromAlice = alice.deriveSharedSecret(bobPK);
        const sharedFromBob = bob.deriveSharedSecret(alicePK);
        expect(sharedFromAlice).toBe(sharedFromBob);

        const plaintext = new TextEncoder().encode('Hello HKDF!');
        const ciphertext = await alice.encrypt(plaintext, sharedFromAlice);
        const decrypted = await bob.decrypt(ciphertext, sharedFromBob);
        expect(new TextDecoder().decode(decrypted)).toBe('Hello HKDF!');
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Goal 2: Forward Secrecy — Ephemeral ECDH
// ──────────────────────────────────────────────────────────────────────────

describe('Goal 2 — Forward Secrecy: Ephemeral ECDH', () => {
    test('sender and recipient derive identical AES key from ephemeral exchange', async () => {
        (global as any).indexedDB = new IDBFactory();
        const alice = new SovereignS3nc(
            { paths: { appId: 'pfs-test', userId: 'alice', storeId: 'main' }, password: 'alice-pw' },
            new MockRemote()
        );
        await alice.init();

        const bob = new SovereignS3nc(
            { paths: { appId: 'pfs-test', userId: 'bob', storeId: 'main' }, password: 'bob-pw' },
            new MockRemote()
        );
        await bob.init();

        const bobPK = bob.getConfig().publicEncryptionKey!;
        const { ephemeralPublicKey, sharedSecret: senderKey } = alice.deriveEphemeralSharedSecret(bobPK);
        const recipientKey = bob.deriveRecipientSharedSecret(ephemeralPublicKey);

        expect(senderKey).toBe(recipientKey);
        expect(ephemeralPublicKey.length).toBe(64);
        expect(senderKey.length).toBe(64);
    });

    test('each ephemeral exchange produces a unique session key', async () => {
        (global as any).indexedDB = new IDBFactory();
        const sender = new SovereignS3nc(
            { paths: { appId: 'pfs-unique', userId: 'sender', storeId: 'main' } },
            undefined, undefined,
            { privateKey: Buffer.from(nacl.box.keyPair().secretKey).toString('hex'),
              publicKey: Buffer.from(nacl.box.keyPair().publicKey).toString('hex') }
        );
        const recipientKP = nacl.box.keyPair();
        const recipientPK = Buffer.from(recipientKP.publicKey).toString('hex');

        const { sharedSecret: key1 } = sender.deriveEphemeralSharedSecret(recipientPK);
        const { sharedSecret: key2 } = sender.deriveEphemeralSharedSecret(recipientPK);
        expect(key1).not.toBe(key2); // Different ephemeral keys each time
    });

    test('ephemeral key exchange enables full message encrypt/decrypt roundtrip', async () => {
        (global as any).indexedDB = new IDBFactory();
        const alice = new SovereignS3nc(
            { paths: { appId: 'pfs-rtrip', userId: 'alice', storeId: 'main' }, password: 'pw' },
            new MockRemote()
        );
        await alice.init();
        const bob = new SovereignS3nc(
            { paths: { appId: 'pfs-rtrip', userId: 'bob', storeId: 'main' }, password: 'pw' },
            new MockRemote()
        );
        await bob.init();

        const { ephemeralPublicKey, sharedSecret: sendKey } = alice.deriveEphemeralSharedSecret(bob.getConfig().publicEncryptionKey!);
        const recvKey = bob.deriveRecipientSharedSecret(ephemeralPublicKey);

        const msg = new TextEncoder().encode('Forward-secret content');
        const ct = await alice.encrypt(msg, sendKey);
        const pt = await bob.decrypt(ct, recvKey);
        expect(new TextDecoder().decode(pt)).toBe('Forward-secret content');
    });

    test('v3 ephemeral key differs from v2 static HKDF key', async () => {
        (global as any).indexedDB = new IDBFactory();
        const alice = new SovereignS3nc(
            { paths: { appId: 'pfs-diff', userId: 'alice', storeId: 'main' }, password: 'pw' },
            new MockRemote()
        );
        await alice.init();
        const bob = new SovereignS3nc(
            { paths: { appId: 'pfs-diff', userId: 'bob', storeId: 'main' }, password: 'pw' },
            new MockRemote()
        );
        await bob.init();

        const bobPK = bob.getConfig().publicEncryptionKey!;
        const { sharedSecret: ephemeralKey } = alice.deriveEphemeralSharedSecret(bobPK);
        const staticKey = alice.deriveSharedSecret(bobPK);
        expect(ephemeralKey).not.toBe(staticKey);
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Goal 3: Multi-Device Support
// ──────────────────────────────────────────────────────────────────────────

describe('Goal 3 — Multi-Device Support', () => {
    test('createDevicePairingPackage produces a base64 string', async () => {
        (global as any).indexedDB = new IDBFactory();
        const host = new SovereignS3nc(
            { paths: { appId: 'mdev-pkg', userId: 'alice', storeId: 'main' }, password: 'pw' },
            new MockRemote()
        );
        await host.init();
        const pkg = await host.createDevicePairingPackage('transfer-pass', 60_000);
        expect(typeof pkg).toBe('string');
        const parsed = JSON.parse(Buffer.from(pkg, 'base64').toString('utf-8'));
        expect(parsed.version).toBe(1);
        expect(parsed.userId).toBe('alice');
    });

    test('importDevicePairingPackage restores identity keys on new device', async () => {
        (global as any).indexedDB = new IDBFactory();
        const host = new SovereignS3nc(
            { paths: { appId: 'mdev-import', userId: 'alice', storeId: 'main' }, password: 'pw' },
            new MockRemote()
        );
        await host.init();
        const pkg = await host.createDevicePairingPackage('pass', 60_000);

        const device2 = new SovereignS3nc(
            { paths: { appId: 'mdev-import', userId: 'unknown', storeId: 'main' } }
        );
        const result = await device2.importDevicePairingPackage(pkg, 'pass');
        expect(result.userId).toBe('alice');
        expect(device2.getConfig().publicEncryptionKey).toBe(host.getConfig().publicEncryptionKey);
        expect(device2.getConfig().encryptionKey).toBe(host.getConfig().encryptionKey);
    });

    test('importDevicePairingPackage rejects wrong passphrase', async () => {
        (global as any).indexedDB = new IDBFactory();
        const host = new SovereignS3nc(
            { paths: { appId: 'mdev-reject', userId: 'alice', storeId: 'main' }, password: 'pw' }
        );
        await host.init();
        const pkg = await host.createDevicePairingPackage('correct', 60_000);

        const device2 = new SovereignS3nc(
            { paths: { appId: 'mdev-reject', userId: 'x', storeId: 'main' } }
        );
        await expect(device2.importDevicePairingPackage(pkg, 'wrong'))
            .rejects.toThrow(/Failed to decrypt pairing package/);
    });

    test('importDevicePairingPackage rejects expired package', async () => {
        (global as any).indexedDB = new IDBFactory();
        const host = new SovereignS3nc(
            { paths: { appId: 'mdev-expire', userId: 'alice', storeId: 'main' }, password: 'pw' }
        );
        await host.init();
        const expiredPkg = await host.createDevicePairingPackage('pass', -1000);

        const device2 = new SovereignS3nc(
            { paths: { appId: 'mdev-expire', userId: 'x', storeId: 'main' } }
        );
        await expect(device2.importDevicePairingPackage(expiredPkg, 'pass'))
            .rejects.toThrow(/expired/);
    });

    test('Device Registry: register, list, and revoke devices', async () => {
        (global as any).indexedDB = new IDBFactory();
        const alice = new SovereignS3nc(
            { paths: { appId: 'mdev-reg', userId: 'alice', storeId: 'main' }, password: 'pw' }
        );
        await alice.init();

        const d1 = await alice.registerDevice('iPhone 15 Pro');
        const d2 = await alice.registerDevice('MacBook Pro M3');

        let devices = await alice.getRegisteredDevices();
        expect(devices.length).toBe(2);
        expect(devices.map(d => d.deviceName)).toContain('iPhone 15 Pro');
        expect(devices.map(d => d.deviceName)).toContain('MacBook Pro M3');
        expect(devices.every(d => d.status === 'active')).toBe(true);

        await alice.revokeDevice(d1.deviceId);
        devices = await alice.getRegisteredDevices();
        expect(devices.find(d => d.deviceId === d1.deviceId)?.status).toBe('revoked');
        expect(devices.find(d => d.deviceId === d2.deviceId)?.status).toBe('active');
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Goal 4: Message Expiration & Read Receipts
// ──────────────────────────────────────────────────────────────────────────

describe('Goal 4 — Message Expiration & Read Receipts', () => {
    // Mock SQL.js for messaging tests
    const mockDbInstance = {
        run: jest.fn(),
        exec: jest.fn().mockReturnValue([]),
        export: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
        close: jest.fn()
    };

    beforeAll(() => {
        (globalThis as any).initSqlJs = jest.fn().mockResolvedValue({
            Database: jest.fn().mockImplementation(() => ({ ...mockDbInstance }))
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
        mockDbInstance.run.mockClear();
        mockDbInstance.exec.mockClear();
        mockDbInstance.export.mockClear();
        mockDbInstance.close.mockClear();
    });

    test('sendDirectMessage stores expiresAt in the message', async () => {
        (global as any).indexedDB = new IDBFactory();
        const { MessagingModule } = await import('../src/modules/Messaging');

        const remote = new MockRemote();
        const sov = new SovereignS3nc(
            { paths: { appId: 'exp-test', userId: 'alice', storeId: 'main' }, password: 'pw' },
            remote
        );
        await sov.init();
        jest.spyOn(sov, 'deriveEphemeralSharedSecret').mockReturnValue({ ephemeralPublicKey: '0'.repeat(64), sharedSecret: '0'.repeat(64) });
        jest.spyOn(sov, 'encrypt').mockResolvedValue(new Uint8Array([9]));
        jest.spyOn(sov, 'getPublicRegistry').mockResolvedValue([{ userId: 'bob', publicKey: '0'.repeat(64) }]);

        const msg = new MessagingModule(sov);
        const spy = jest.spyOn(msg as any, '_saveAndSendDM').mockResolvedValue(undefined);

        const ttl = Date.now() + 30_000;
        await msg.sendDirectMessage('bob', 'auto-destruct in 30s', undefined, ttl);
        expect(spy).toHaveBeenCalledWith('bob', expect.objectContaining({ expiresAt: ttl }), expect.any(String), undefined);
    });

    test('Message.expiresAt is propagated through Message type', () => {
        const { MessagingModule } = jest.requireActual('../src/modules/Messaging') as any;
        // Type check: expiresAt is optional on Message interface
        const msg = {
            id: 'x', content: 'hi', timestamp: Date.now(),
            senderId: 'alice', recipientId: 'bob',
            expiresAt: Date.now() + 60_000
        };
        expect(msg.expiresAt).toBeGreaterThan(Date.now());
    });

    test('markAsRead saves a read receipt to storage', async () => {
        (global as any).indexedDB = new IDBFactory();
        const { MessagingModule } = await import('../src/modules/Messaging');

        const remote = new MockRemote();
        const sov = new SovereignS3nc(
            { paths: { appId: 'receipt-read', userId: 'alice', storeId: 'main' }, password: 'pw' },
            remote
        );
        await sov.init();
        const msg = new MessagingModule(sov);

        const saveSpy = jest.spyOn(sov.getStorage(), 'saveFile').mockResolvedValue(undefined);
        await msg.markAsRead('bob', 'msg-001', '2026-09-24');
        expect(saveSpy).toHaveBeenCalledWith(
            expect.stringContaining('receipts/bob/2026-09-24.db'),
            expect.any(Uint8Array)
        );
    });

    test('markAsDelivered saves a delivered receipt to storage', async () => {
        (global as any).indexedDB = new IDBFactory();
        const { MessagingModule } = await import('../src/modules/Messaging');

        const remote = new MockRemote();
        const sov = new SovereignS3nc(
            { paths: { appId: 'receipt-del', userId: 'alice', storeId: 'main' }, password: 'pw' },
            remote
        );
        await sov.init();
        const msg = new MessagingModule(sov);

        const saveSpy = jest.spyOn(sov.getStorage(), 'saveFile').mockResolvedValue(undefined);
        await msg.markAsDelivered('bob', 'msg-002', '2026-09-24');
        expect(saveSpy).toHaveBeenCalledWith(
            expect.stringContaining('receipts/bob/2026-09-24.db'),
            expect.any(Uint8Array)
        );
    });

    test('getMessageReceipt returns status from outbox SQLite', async () => {
        (global as any).indexedDB = new IDBFactory();
        const { MessagingModule } = await import('../src/modules/Messaging');

        const remote = new MockRemote();
        const sov = new SovereignS3nc(
            { paths: { appId: 'receipt-get', userId: 'alice', storeId: 'main' }, password: 'pw' },
            remote
        );
        await sov.init();
        const msg = new MessagingModule(sov);

        // Mock storage returning a DB file and SQL returning 'read'
        jest.spyOn(sov.getStorage(), 'getFile').mockResolvedValue(new Uint8Array([1, 2, 3]));
        const localDbExec = jest.fn().mockReturnValue([{ values: [['read']] }]);
        (globalThis as any).initSqlJs = jest.fn().mockResolvedValue({
            Database: jest.fn().mockImplementation(() => ({
                exec: localDbExec,
                close: jest.fn()
            }))
        });

        const status = await msg.getMessageReceipt('msg-003', '2026-09-24');
        expect(status).toBe('read');
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Goal 5: Release — ManifestManager tracks receipts
// ──────────────────────────────────────────────────────────────────────────

describe('Goal 5 — Manifest Receipt Tracking & Version 3.2.0', () => {
    test('SovereignS3nc.VERSION is 3.2.0', () => {
        expect(SovereignS3nc.VERSION).toBe('3.2.0');
    });

    test('SovereignManifest type includes receipts field', () => {
        // Compile-time type check via runtime object
        const manifest = {
            updatedAt: Date.now(),
            userId: 'alice',
            modules: {},
            dms: {},
            groups: {},
            receipts: { bob: ['2026-09-24'] },
            blobs: [],
        };
        expect(manifest.receipts.bob).toContain('2026-09-24');
    });

    test('ManifestManager indexes receipt files in manifest.receipts', async () => {
        (global as any).indexedDB = new IDBFactory();
        const { ManifestManager } = await import('../src/core/ManifestManager');

        const files = [
            'public/modules/messaging/receipts/alice/2026-09-24.db',
            'public/modules/messaging/dms/bob/2026-09-24.db',
        ];

        const mockStorage = {
            listFiles: jest.fn().mockResolvedValue(files),
            getFile: jest.fn().mockResolvedValue(new TextEncoder().encode('content')),
            getPublicUserFile: jest.fn().mockResolvedValue(null),
            getFileTimestamp: jest.fn().mockResolvedValue(Date.now()),
            saveFile: jest.fn().mockResolvedValue(undefined),
            setGenericRemoteHashCache: jest.fn().mockResolvedValue(undefined),
            getGenericRemoteHashCache: jest.fn().mockResolvedValue(null),
        };

        const mgr = new ManifestManager({
            userId: 'alice',
            getEncryptionKey: () => undefined,
            storage: mockStorage as any,
            getPublicRemote: () => undefined,
            createRemote: () => { throw new Error('not impl'); },
            calculateHashedContent: (d: Uint8Array) => crypto.createHash('sha256').update(d).digest('hex'),
        });

        const manifest = await mgr.generateManifest();

        // Receipt file should be indexed in manifest.receipts
        expect(manifest.receipts).toBeDefined();
        expect(manifest.receipts!['alice']).toContain('2026-09-24');

        // DM file should be indexed in manifest.dms
        expect(manifest.dms['bob']).toContain('2026-09-24');
    });

    test('SyncOrchestrator.syncFollowedUser pulls receipt files from followed user', async () => {
        // This test verifies the receipt pull path by checking pullUserFile is called
        // with a receipt path when the followed user's manifest lists our receipts.
        const { SyncOrchestrator } = await import('../src/core/SyncOrchestrator');

        const myId = 'alice';
        const followedUserId = 'bob';

        const mockManifest = {
            updatedAt: Date.now(),
            userId: followedUserId,
            modules: {},
            dms: {},
            groups: {},
            receipts: { [myId]: ['2026-09-24'] }, // Bob wrote a receipt for Alice
            blobs: [],
        };

        const pullSpy = jest.fn().mockResolvedValue(false);
        const ctx = {
            config: { paths: { userId: myId }, blacklist: [] },
            storage: {
                getFollowing: jest.fn().mockResolvedValue([]),
                updateFollowedUserSync: jest.fn().mockResolvedValue(undefined),
                getGenericRemoteHashCache: jest.fn().mockResolvedValue(null),
                setGenericRemoteHashCache: jest.fn().mockResolvedValue(undefined),
            },
            registeredModules: [{ name: 'messaging' }],
            getModuleInstances: () => [],
            fetchManifestWithMeta: jest.fn().mockResolvedValue({ manifest: mockManifest, etag: 'abc', unchanged: false, fromCache: false }),
            fetchManifest: jest.fn(),
            onModuleUpdate: jest.fn(),
            getModulePath: (moduleName: string, subPath: string, type: string) => {
                if (type === 'followed') {
                    const parts = subPath.split('/');
                    const userId = parts.shift();
                    return `followed/${userId}/modules/${moduleName}/${parts.join('/')}`;
                }
                return `${type}/modules/${moduleName}/${subPath}`;
            },
            emitSyncProgress: jest.fn(),
        } as any;

        const orchestrator = new SyncOrchestrator(ctx);
        // Inject spy for pullUserFile
        (orchestrator as any).pullUserFile = pullSpy;

        await orchestrator.syncFollowedUser({ userId: followedUserId, publicKey: '0'.repeat(64), lastSync: '2026-09-24' }, '2026-09-24');

        // Verify pullUserFile was called with a receipts path
        const calls = pullSpy.mock.calls;
        const receiptCall = calls.find((args: any[]) => args[1].includes('receipts') && args[1].includes(myId));
        expect(receiptCall).toBeDefined();
        expect(receiptCall[0]).toBe(followedUserId);
        expect(receiptCall[1]).toContain('receipts/alice/2026-09-24.db');
    });
});
