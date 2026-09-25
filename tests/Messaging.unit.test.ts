
import { MessagingModule, Message } from '../src/modules/Messaging';
import { SovereignS3nc } from '../src/SovereignS3nc';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import { IDBFactory } from 'fake-indexeddb';
import crypto from 'crypto';

// --- Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;

// --- Mock SQL.js ---
const mockDbInstance = {
    run: jest.fn(),
    exec: jest.fn(),
    export: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
    close: jest.fn()
};

(globalThis as any).initSqlJs = jest.fn().mockResolvedValue({
    Database: jest.fn().mockImplementation(() => mockDbInstance)
});

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string, etag: string}> = new Map();
    async uploadFile(path: string, data: Uint8Array): Promise<string | null> {
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: '', etag });
        return etag;
    }
    async downloadFile(path: string, ifNoneMatch?: string): Promise<any | null> {
        const entry = this.files.get(path);
        if (!entry) return null;
        return { data: entry.data, etag: entry.etag };
    }
    async getFileHash(path: string): Promise<string | null> { return null; }
    async getFileEtag(path: string): Promise<string | null> { return null; }
    async canWrite(path: string): Promise<boolean> { return true; }
    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path: string): Promise<void> { this.files.delete(path); }
}

describe('MessagingModule Unit Tests', () => {
    let sov: SovereignS3nc;
    let messagingModule: MessagingModule;
    let mockRemote: MockRemote;

    beforeEach(async () => {
        (global as any).indexedDB = new IDBFactory();
        mockRemote = new MockRemote();
        sov = new SovereignS3nc({
            paths: { appId: 'test-app', userId: 'alice', storeId: 'main' },
            password: 'password123'
        }, mockRemote);
        await sov.init();
        
        // Mock core primitives
        jest.spyOn(sov, 'deriveSharedSecret').mockReturnValue('0'.repeat(64));
        jest.spyOn(sov, 'deriveEphemeralSharedSecret').mockReturnValue({
            ephemeralPublicKey: '1'.repeat(64),
            sharedSecret: '0'.repeat(64)
        });
        jest.spyOn(sov, 'deriveRecipientSharedSecret').mockReturnValue('0'.repeat(64));
        jest.spyOn(sov, 'encrypt').mockResolvedValue(new Uint8Array([1, 2, 3]));
        jest.spyOn(sov, 'decrypt').mockResolvedValue(new TextEncoder().encode(JSON.stringify({
            id: 'msg1', content: 'hello', timestamp: Date.now(), senderId: 'bob', recipientId: 'alice'
        })));
        jest.spyOn(sov, 'getPublicRegistry').mockResolvedValue([{ userId: 'bob', publicKey: '0'.repeat(64) }]);

        messagingModule = new MessagingModule(sov);
    });

    test('sendDirectMessage should save to outbox and recipient box', async () => {
        await messagingModule.sendDirectMessage('bob', 'Hello Bob');

        // Verify outbox save (sqlite export called and storage saved)
        expect(mockDbInstance.run).toHaveBeenCalledWith(
            expect.stringContaining('INSERT OR REPLACE INTO messages'),
            expect.arrayContaining(['Hello Bob', 'alice', 'bob'])
        );

        // Verify E2EE and public box save
        expect(sov.encrypt).toHaveBeenCalled();
        const publicDmPath = sov.getModulePath('messaging', 'bob', 'public'); // Simplified check
        // The path in Messaging.ts is: this.db.getModulePath(this.MODULE_NAME, `dms/${recipientId}/${date}.db`, 'public');
    });

    test('getInboxMessages should fetch and decrypt messages', async () => {
        jest.spyOn(sov, 'getFollowing').mockResolvedValue([{ userId: 'bob', lastSync: '', publicKey: 'bob-pub' }]);
        
        // Mock a file existing in Bob's public box for me
        const bobPath = sov.getModulePath('messaging', 'bob/dms/alice', 'followed'); // Simplified check
        // The path in Messaging.ts is: this.db.getModulePath(this.MODULE_NAME, `${user.userId}/dms/${myId}/${date}.db`, 'followed');
        
        // Mock storage to return "data"
        jest.spyOn(sov.getStorage(), 'getFile').mockResolvedValue(new Uint8Array([9, 9, 9]));
        
        // Mock SQL result
        mockDbInstance.exec.mockReturnValue([{ values: [[new Uint8Array([1, 2, 3])]] }]);

        const messages = await messagingModule.getInboxMessages(1);
        expect(messages.length).toBeGreaterThan(0);
        expect(messages[0].content).toBe('hello');
        expect(sov.decrypt).toHaveBeenCalled();
    });

    test('editMessage should update message and resend', async () => {
        const spy = jest.spyOn(messagingModule as any, '_saveAndSendDM').mockResolvedValue(undefined);
        await messagingModule.editMessage('bob', 'msg1', '2025-03-22', 'New content');
        expect(spy).toHaveBeenCalledWith('bob', expect.objectContaining({ content: 'New content', isEdited: true }), '2025-03-22');
    });

    test('deleteMessage should update message as deleted and resend', async () => {
        const spy = jest.spyOn(messagingModule as any, '_saveAndSendDM').mockResolvedValue(undefined);
        await messagingModule.deleteMessage('bob', 'msg1', '2025-03-22');
        expect(spy).toHaveBeenCalledWith('bob', expect.objectContaining({ isDeleted: true }), '2025-03-22');
    });

    test('sendDirectMessage should support expiresAt TTL', async () => {
        const spy = jest.spyOn(messagingModule as any, '_saveAndSendDM').mockResolvedValue(undefined);
        const expiresAt = Date.now() + 60000;
        await messagingModule.sendDirectMessage('bob', 'self-destruct message', undefined, expiresAt);
        expect(spy).toHaveBeenCalledWith('bob', expect.objectContaining({ content: 'self-destruct message', expiresAt }), expect.any(String), undefined);
    });

    test('getInboxMessages should filter out expired messages', async () => {
        jest.spyOn(sov, 'getFollowing').mockResolvedValue([{ userId: 'bob', lastSync: '', publicKey: 'bob-pub' }]);
        jest.spyOn(sov.getStorage(), 'getFile').mockResolvedValue(new Uint8Array([9, 9, 9]));
        
        // Return an expired message
        const expiredMsg: Message = {
            id: 'expired1',
            content: 'old secret',
            timestamp: Date.now() - 10000,
            senderId: 'bob',
            recipientId: 'alice',
            expiresAt: Date.now() - 1000 // Expired 1 second ago
        };
        (sov.decrypt as jest.Mock).mockResolvedValue(new TextEncoder().encode(JSON.stringify(expiredMsg)));
        mockDbInstance.exec.mockReturnValue([{ values: [[new Uint8Array([1, 2, 3])]] }]);

        const messages = await messagingModule.getInboxMessages(1);
        expect(messages.find(m => m.id === 'expired1')).toBeUndefined();
    });

    test('markAsDelivered and markAsRead should record receipts and save them to storage', async () => {
        const saveSpy = jest.spyOn(sov.getStorage(), 'saveFile').mockResolvedValue(undefined);
        
        await messagingModule.markAsDelivered('bob', 'msg-123', '2026-09-17');
        expect(saveSpy).toHaveBeenCalledWith(
            expect.stringContaining('receipts/bob/2026-09-17.db'),
            expect.any(Uint8Array)
        );

        await messagingModule.markAsRead('bob', 'msg-123', '2026-09-17');
        expect(saveSpy).toHaveBeenCalledWith(
            expect.stringContaining('receipts/bob/2026-09-17.db'),
            expect.any(Uint8Array)
        );
    });

    test('getMessageReceipt should return status from outbox', async () => {
        jest.spyOn(sov.getStorage(), 'getFile').mockResolvedValue(new Uint8Array([1, 2, 3]));
        mockDbInstance.exec.mockReturnValue([{ values: [['delivered']] }]);

        const status = await messagingModule.getMessageReceipt('msg-456', '2026-09-17');
        expect(status).toBe('delivered');
    });

    test('sendDirectMessage should use ephemeral forward secrecy and save ephemeral_pk', async () => {
        await messagingModule.sendDirectMessage('bob', 'Secret with PFS');

        expect(sov.deriveEphemeralSharedSecret).toHaveBeenCalledWith('0'.repeat(64));
        expect(mockDbInstance.run).toHaveBeenCalledWith(
            expect.stringContaining('INSERT OR REPLACE INTO messages (id, encrypted_data, ephemeral_pk) VALUES (?, ?, ?)'),
            expect.arrayContaining(['1'.repeat(64)])
        );
    });

    test('getInboxMessages should decrypt using deriveRecipientSharedSecret when ephemeral_pk is present', async () => {
        jest.spyOn(sov, 'getFollowing').mockResolvedValue([{ userId: 'bob', lastSync: '', publicKey: '0'.repeat(64) }]);
        jest.spyOn(sov.getStorage(), 'getFile').mockResolvedValue(new Uint8Array([9, 9, 9]));

        // Mock PRAGMA table_info to return ephemeral_pk column, and SELECT result with ephemeral_pk
        mockDbInstance.exec.mockImplementation((sql: string) => {
            if (sql.includes('table_info')) {
                return [{ values: [[0, 'id'], [1, 'encrypted_data'], [2, 'ephemeral_pk']] }];
            }
            if (sql.includes('SELECT encrypted_data, ephemeral_pk')) {
                return [{ values: [[new Uint8Array([1, 2, 3]), 'eph_pub_key_hex']] }];
            }
            return [];
        });

        const messages = await messagingModule.getInboxMessages(1);
        expect(messages.length).toBeGreaterThan(0);
        expect(sov.deriveRecipientSharedSecret).toHaveBeenCalledWith('eph_pub_key_hex');
    });

    test('KeyManager cryptographic forward secrecy: sender and recipient derive identical AES key', async () => {
        const alice = new SovereignS3nc({
            paths: { appId: 'pfs-test-alice', userId: 'alice', storeId: 'main' },
            password: 'alice-password-123'
        }, new MockRemote());
        await alice.init();

        const bob = new SovereignS3nc({
            paths: { appId: 'pfs-test-bob', userId: 'bob', storeId: 'main' },
            password: 'bob-password-456'
        }, new MockRemote());
        await bob.init();

        const bobPublicKey = bob.getConfig().publicEncryptionKey!;
        expect(bobPublicKey).toBeDefined();

        // 1. Alice derives ephemeral secret for Bob
        const { ephemeralPublicKey, sharedSecret: aliceDerivedSecret } = alice.deriveEphemeralSharedSecret(bobPublicKey);
        expect(ephemeralPublicKey).toBeDefined();
        expect(aliceDerivedSecret).toBeDefined();
        expect(ephemeralPublicKey.length).toBe(64);
        expect(aliceDerivedSecret.length).toBe(64);

        // 2. Bob derives recipient secret using Alice's ephemeral public key
        const bobDerivedSecret = bob.deriveRecipientSharedSecret(ephemeralPublicKey);
        expect(bobDerivedSecret).toBe(aliceDerivedSecret);

        // 3. Encrypt with Alice's derived key, decrypt with Bob's derived key
        const plaintext = new TextEncoder().encode('Forward secret message content');
        const encrypted = await alice.encrypt(plaintext, aliceDerivedSecret);
        const decrypted = await bob.decrypt(encrypted, bobDerivedSecret);
        expect(new TextDecoder().decode(decrypted)).toBe('Forward secret message content');
    });
});
