
import { SQLiteNodeStorage } from '../src/adapters/SQLiteNodeStorage';
import * as fs from 'fs-extra';
import * as path from 'path';
import initSqlJs from 'sql.js';

(global as any).initSqlJs = initSqlJs;

describe('SQLiteNodeStorage', () => {
    const testDbPath = path.join(__dirname, 'test_storage.db');

    beforeEach(async () => {
        if (await fs.pathExists(testDbPath)) {
            await fs.remove(testDbPath);
        }
    });

    afterAll(async () => {
        if (await fs.pathExists(testDbPath)) {
            await fs.remove(testDbPath);
        }
    });

    test('should initialize and persist metadata', async () => {
        const storage = new SQLiteNodeStorage(testDbPath);
        await storage.init();

        await storage.setLastSyncDate('2024-01-01');
        expect(await storage.getLastSyncDate()).toBe('2024-01-01');

        // Check file exists
        expect(await fs.pathExists(testDbPath)).toBe(true);
    });

    test('should save and retrieve files', async () => {
        const storage = new SQLiteNodeStorage(testDbPath);
        await storage.init();

        const data = new Uint8Array([1, 2, 3]);
        await storage.saveFile('test.bin', data);

        const retrieved = await storage.getFile('test.bin');
        expect(retrieved).toEqual(data);

        expect(await storage.getFile('missing.bin')).toBeNull();
    });

    test('should list files with prefix', async () => {
        const storage = new SQLiteNodeStorage(testDbPath);
        await storage.init();

        await storage.saveFile('a/1.bin', new Uint8Array([1]));
        await storage.saveFile('a/2.bin', new Uint8Array([2]));
        await storage.saveFile('b/1.bin', new Uint8Array([3]));

        const list = await storage.listFiles('a/');
        expect(list).toHaveLength(2);
        expect(list).toContain('a/1.bin');
        expect(list).toContain('a/2.bin');
    });

    test('should handle metadata (following, sync date)', async () => {
        const storage = new SQLiteNodeStorage(testDbPath);
        await storage.init();

        await storage.followUser('alice', '2024-01-01', 'pubkey');
        const following = await storage.getFollowing();
        expect(following).toHaveLength(1);
        expect(following[0].userId).toBe('alice');

        await storage.updateFollowedUserSync('alice', '2024-01-02');
        const updated = await storage.getFollowing();
        expect(updated[0].lastSync).toBe('2024-01-02');

        await storage.unfollowUser('alice');
        expect(await storage.getFollowing()).toHaveLength(0);
    });
});
