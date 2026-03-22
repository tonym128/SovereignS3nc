
import { SQLiteNodeStorage } from '../src/adapters/SQLiteNodeStorage';
import * as fs from 'fs-extra';
import * as path from 'path';

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

        expect(await fs.pathExists(testDbPath)).toBe(true);
        expect(await storage.getFollowing()).toEqual([]);
        expect(await storage.getLastSyncDate()).toBeNull();
    });

    test('should save and retrieve files', async () => {
        const storage = new SQLiteNodeStorage(testDbPath);
        await storage.init();

        const data = new TextEncoder().encode('hello world');
        await storage.saveFile('test.txt', data);

        const retrieved = await storage.getFile('test.txt');
        expect(new TextDecoder().decode(retrieved!)).toBe('hello world');

        const hash = crypto.createHash('sha256').update(data).digest('hex');
        const dbHash = await (storage as any).db.exec("SELECT hash FROM files WHERE path = 'test.txt'")[0].values[0][0];
        expect(dbHash).toBe(hash);
    });

    test('should list files with prefix', async () => {
        const storage = new SQLiteNodeStorage(testDbPath);
        await storage.init();

        await storage.saveFile('public/a.txt', new Uint8Array([1]));
        await storage.saveFile('public/b.txt', new Uint8Array([2]));
        await storage.saveFile('private/c.txt', new Uint8Array([3]));

        const publicFiles = await storage.listFiles('public/');
        expect(publicFiles).toContain('public/a.txt');
        expect(publicFiles).toContain('public/b.txt');
        expect(publicFiles).not.toContain('private/c.txt');
    });

    test('should handle metadata (following, sync date)', async () => {
        const storage = new SQLiteNodeStorage(testDbPath);
        await storage.init();

        await storage.followUser('alice', '2023-01-01', 'key123');
        await storage.setLastSyncDate('2023-01-02');

        expect(await storage.getFollowing()).toContainEqual({ userId: 'alice', lastSync: '2023-01-01', publicKey: 'key123' });
        expect(await storage.getLastSyncDate()).toBe('2023-01-02');

        // Re-init to test persistence
        const storage2 = new SQLiteNodeStorage(testDbPath);
        await storage2.init();
        expect(await storage2.getFollowing()).toContainEqual({ userId: 'alice', lastSync: '2023-01-01', publicKey: 'key123' });
        expect(await storage2.getLastSyncDate()).toBe('2023-01-02');
    });
});

import * as crypto from 'crypto';
