"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const SovereignS3nc_1 = require("../src/SovereignS3nc");
const crypto_1 = __importDefault(require("crypto"));
const fake_indexeddb_1 = require("fake-indexeddb");
// --- Polyfills ---
global.indexedDB = new fake_indexeddb_1.IDBFactory();
global.crypto = crypto_1.default.webcrypto;
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
class MockRemote {
    constructor(prefix = '') {
        this.files = new Map();
        this.prefix = '';
        this.prefix = prefix;
    }
    async uploadFile(path, data, hash) {
        const h = hash || crypto_1.default.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: h, etag });
        return etag;
    }
    async downloadFile(path, ifNoneMatch) {
        const entry = this.files.get(path);
        if (!entry)
            return null;
        if (ifNoneMatch && ifNoneMatch === entry.etag) {
            return { data: null, etag: entry.etag, notModified: true };
        }
        return { data: entry.data, etag: entry.etag };
    }
    async getFileHash(path) {
        return this.files.get(path)?.hash || null;
    }
    async getFileEtag(path) {
        return this.files.get(path)?.etag || null;
    }
    async canWrite(path) {
        return true;
    }
    async listFiles(prefix) {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path) {
        this.files.delete(path);
    }
    async purge() {
        this.files.clear();
    }
}
describe('SovereignS3nc Change Password Tests', () => {
    let config;
    let remotes;
    let remoteFactory;
    beforeEach(() => {
        global.indexedDB = new fake_indexeddb_1.IDBFactory();
        remotes = new Map();
        remoteFactory = (userId) => {
            if (!remotes.has(userId)) {
                remotes.set(userId, new MockRemote(userId));
            }
            return remotes.get(userId);
        };
        config = {
            paths: { appId: 'test-app', userId: 'alice', storeId: 'main' },
            password: 'oldPassword123',
            debug: false
        };
    });
    test('should change password and migrate remote data', async () => {
        const sov = new SovereignS3nc_1.SovereignS3nc(config, undefined, remoteFactory);
        await sov.init();
        // Check initial state
        const oldPrivateId = crypto_1.default.pbkdf2Sync('oldPassword123', 'alice-private-id', 1000, 32, 'sha256').toString('hex');
        const oldRemote = remotes.get(oldPrivateId);
        expect(oldRemote).toBeDefined();
        expect(oldRemote?.files.has('_keys.json')).toBe(true);
        // Add some dummy private data
        const today = SovereignS3nc_1.SovereignS3nc.getDateStr(new Date());
        const dummyData = new TextEncoder().encode('some private data');
        await sov.getStorage().saveDailyDb(today, 'private', dummyData);
        await sov.sync(); // This should upload the dummy data to the old remote
        expect(oldRemote?.files.has(`private/${today}.db`)).toBe(true);
        // Change password
        const newPassword = 'newPassword456';
        await sov.changePassword('oldPassword123', newPassword);
        // Check new state
        const newPrivateId = crypto_1.default.pbkdf2Sync(newPassword, 'alice-private-id', 1000, 32, 'sha256').toString('hex');
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
        const newSov = new SovereignS3nc_1.SovereignS3nc({
            ...config,
            password: newPassword
        }, undefined, remoteFactory, undefined, sov.getStorage());
        await newSov.init();
        expect(newSov.getConfig().encryptionKey).toBe(sov.getConfig().encryptionKey);
    });
    test('should fail with incorrect old password', async () => {
        const sov = new SovereignS3nc_1.SovereignS3nc(config, undefined, remoteFactory);
        await sov.init();
        await expect(sov.changePassword('wrongPassword', 'newPassword')).rejects.toThrow('Incorrect old password.');
    });
});
//# sourceMappingURL=ChangePassword.unit.test.js.map