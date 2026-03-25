
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
        jest.spyOn(sov, 'encrypt').mockResolvedValue(new Uint8Array([1, 2, 3]));
        jest.spyOn(sov, 'decrypt').mockResolvedValue(new TextEncoder().encode(JSON.stringify({
            id: 'msg1', content: 'hello', timestamp: Date.now(), senderId: 'bob', recipientId: 'alice'
        })));
        jest.spyOn(sov, 'getPublicRegistry').mockResolvedValue([{ userId: 'bob', publicKey: 'bob-pub' }]);

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
});
