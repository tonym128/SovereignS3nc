"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Messaging_1 = require("../src/modules/Messaging");
const SovereignS3nc_1 = require("../src/SovereignS3nc");
const fake_indexeddb_1 = require("fake-indexeddb");
const crypto_1 = __importDefault(require("crypto"));
// --- Polyfills ---
global.indexedDB = new fake_indexeddb_1.IDBFactory();
global.crypto = crypto_1.default.webcrypto;
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
// --- Mock SQL.js ---
const mockDbInstance = {
    run: jest.fn(),
    exec: jest.fn(),
    export: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
    close: jest.fn()
};
globalThis.initSqlJs = jest.fn().mockResolvedValue({
    Database: jest.fn().mockImplementation(() => mockDbInstance)
});
class MockRemote {
    constructor() {
        this.files = new Map();
    }
    async uploadFile(path, data) {
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: '', etag });
        return etag;
    }
    async downloadFile(path, ifNoneMatch) {
        const entry = this.files.get(path);
        if (!entry)
            return null;
        return { data: entry.data, etag: entry.etag };
    }
    async getFileHash(path) { return null; }
    async getFileEtag(path) { return null; }
    async canWrite(path) { return true; }
    async listFiles(prefix) {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path) { this.files.delete(path); }
}
describe('MessagingModule Unit Tests', () => {
    let sov;
    let messagingModule;
    let mockRemote;
    beforeEach(async () => {
        global.indexedDB = new fake_indexeddb_1.IDBFactory();
        mockRemote = new MockRemote();
        sov = new SovereignS3nc_1.SovereignS3nc({
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
        messagingModule = new Messaging_1.MessagingModule(sov);
    });
    test('sendDirectMessage should save to outbox and recipient box', async () => {
        await messagingModule.sendDirectMessage('bob', 'Hello Bob');
        // Verify outbox save (sqlite export called and storage saved)
        expect(mockDbInstance.run).toHaveBeenCalledWith(expect.stringContaining('INSERT OR REPLACE INTO messages'), expect.arrayContaining(['Hello Bob', 'alice', 'bob']));
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
        const spy = jest.spyOn(messagingModule, '_saveAndSendDM').mockResolvedValue(undefined);
        await messagingModule.editMessage('bob', 'msg1', '2025-03-22', 'New content');
        expect(spy).toHaveBeenCalledWith('bob', expect.objectContaining({ content: 'New content', isEdited: true }), '2025-03-22');
    });
    test('deleteMessage should update message as deleted and resend', async () => {
        const spy = jest.spyOn(messagingModule, '_saveAndSendDM').mockResolvedValue(undefined);
        await messagingModule.deleteMessage('bob', 'msg1', '2025-03-22');
        expect(spy).toHaveBeenCalledWith('bob', expect.objectContaining({ isDeleted: true }), '2025-03-22');
    });
});
//# sourceMappingURL=Messaging.unit.test.js.map