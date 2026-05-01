"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const NodeStorage_1 = require("../src/adapters/NodeStorage");
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
describe('NodeStorage', () => {
    let storage;
    let baseDir;
    beforeEach(async () => {
        baseDir = path.join(os.tmpdir(), `sovereign-test-${Math.random().toString(36).substring(2)}`);
        storage = new NodeStorage_1.NodeStorage(baseDir);
        await storage.init();
    });
    afterEach(async () => {
        await fs.remove(baseDir);
    });
    it('should initialize with metadata and files directory', async () => {
        expect(await fs.pathExists(baseDir)).toBe(true);
        expect(await fs.pathExists(path.join(baseDir, 'metadata.json'))).toBe(true);
        expect(await fs.pathExists(path.join(baseDir, 'files'))).toBe(true);
    });
    it('should save and get files', async () => {
        const data = new Uint8Array([1, 2, 3]);
        const filePath = 'test.txt';
        await storage.saveFile(filePath, data);
        const retrieved = await storage.getFile(filePath);
        expect(retrieved).toEqual(Buffer.from(data));
    });
    it('should delete files', async () => {
        const data = new Uint8Array([1, 2, 3]);
        const filePath = 'delete-me.txt';
        await storage.saveFile(filePath, data);
        await storage.deleteFile(filePath);
        const retrieved = await storage.getFile(filePath);
        expect(retrieved).toBeNull();
    });
    it('should list files with prefix', async () => {
        await storage.saveFile('prefix/1.txt', new Uint8Array([1]));
        await storage.saveFile('prefix/2.txt', new Uint8Array([2]));
        await storage.saveFile('other/3.txt', new Uint8Array([3]));
        const files = await storage.listFiles('prefix/');
        expect(files.sort()).toEqual(['prefix/1.txt', 'prefix/2.txt'].sort());
    });
    it('should manage metadata (sync date, remote hash cache)', async () => {
        await storage.setLastSyncDate('2023-01-01');
        expect(await storage.getLastSyncDate()).toBe('2023-01-01');
        await storage.setGenericRemoteHashCache('file.txt', 'hash123');
        expect(await storage.getGenericRemoteHashCache('file.txt')).toBe('hash123');
    });
    it('should handle daily databases', async () => {
        const data = new Uint8Array([10, 20]);
        const date = '2023-05-20';
        await storage.saveDailyDb(date, 'public', data);
        const retrieved = await storage.getDailyDb(date, 'public');
        expect(retrieved).toEqual(Buffer.from(data));
        const hash = await storage.getDailyDbHash(date, 'public');
        const expectedHash = crypto.createHash('sha256').update(data).digest('hex');
        expect(hash).toBe(expectedHash);
        await storage.deleteDailyDb(date, 'public');
        expect(await storage.getDailyDb(date, 'public')).toBeNull();
    });
    it('should follow and unfollow users', async () => {
        const userId = 'user123';
        const publicKey = 'pk123';
        await storage.followUser(userId, '2023-01-01', publicKey);
        let following = await storage.getFollowing();
        expect(following).toContainEqual({ userId, lastSync: '2023-01-01', publicKey });
        await storage.updateFollowedUserSync(userId, '2023-02-01');
        following = await storage.getFollowing();
        expect(following).toContainEqual({ userId, lastSync: '2023-02-01', publicKey });
        await storage.unfollowUser(userId);
        following = await storage.getFollowing();
        expect(following.find(f => f.userId === userId)).toBeUndefined();
    });
    it('should handle followed databases', async () => {
        const userId = 'user123';
        const date = '2023-05-20';
        const data = new Uint8Array([1, 2, 3]);
        await storage.saveFollowedDb(userId, date, data);
        const hash = await storage.getFollowedDbHash(userId, date);
        const expectedHash = crypto.createHash('sha256').update(data).digest('hex');
        expect(hash).toBe(expectedHash);
    });
    it('should handle non-existent files gracefully', async () => {
        expect(await storage.getFile('non-existent')).toBeNull();
        expect(await storage.getDailyDb('non-existent', 'public')).toBeNull();
        expect(await storage.getDailyDbHash('non-existent', 'public')).toBeNull();
        expect(await storage.getFollowedDbHash('non-existent', 'non-existent')).toBeNull();
    });
});
//# sourceMappingURL=NodeStorage.unit.test.js.map