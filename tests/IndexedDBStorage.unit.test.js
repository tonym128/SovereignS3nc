"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("fake-indexeddb/auto");
const IndexedDBStorage_1 = require("../src/adapters/IndexedDBStorage");
describe('IndexedDBStorage', () => {
    let storage;
    beforeEach(async () => {
        const dbName = 'test-db-' + Math.random().toString(36).substring(2);
        storage = new IndexedDBStorage_1.IndexedDBStorage(dbName);
        await storage.init();
    });
    afterEach(async () => {
        // IDB is usually cleaned up by the environment
    });
    it('should initialize and create stores', async () => {
        expect(storage).toBeDefined();
        // init is called in beforeEach
    });
    it('should save and get files', async () => {
        const data = new Uint8Array([1, 2, 3]);
        const path = 'test.txt';
        await storage.saveFile(path, data);
        const retrieved = await storage.getFile(path);
        expect(retrieved).toEqual(data);
    });
    it('should delete files', async () => {
        const data = new Uint8Array([1, 2, 3]);
        const path = 'delete-me.txt';
        await storage.saveFile(path, data);
        await storage.deleteFile(path);
        const retrieved = await storage.getFile(path);
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
        await storage.setRemoteHashCache('2023-05-20', 'public', 'hash456');
        expect(await storage.getRemoteHashCache('2023-05-20', 'public')).toBe('hash456');
    });
    it('should handle daily databases', async () => {
        const data = new Uint8Array([10, 20]);
        const date = '2023-05-20';
        await storage.saveDailyDb(date, 'public', data);
        const retrieved = await storage.getDailyDb(date, 'public');
        expect(retrieved).toEqual(data);
        const hash = await storage.getDailyDbHash(date, 'public');
        expect(hash).toBeDefined();
        expect(hash?.length).toBe(64); // SHA-256 hex length
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
        expect(hash).toBeDefined();
        expect(hash?.length).toBe(64);
    });
    it('should handle non-existent keys gracefully', async () => {
        expect(await storage.getFile('non-existent')).toBeNull();
        expect(await storage.getDailyDb('non-existent', 'public')).toBeNull();
        expect(await storage.getGenericRemoteHashCache('non-existent')).toBeNull();
        expect(await storage.getLastSyncDate()).toBeNull();
    });
});
//# sourceMappingURL=IndexedDBStorage.unit.test.js.map