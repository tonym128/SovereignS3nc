import 'fake-indexeddb/auto';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { IStorage } from '../src/interfaces/IStorage';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import { NodeStorage } from '../src/adapters/NodeStorage';
import { SQLiteNodeStorage } from '../src/adapters/SQLiteNodeStorage';

function runStorageTests(name: string, storageFactory: () => Promise<IStorage>, cleanup?: () => Promise<void>) {
    describe(`Storage Consistency: ${name}`, () => {
        let storage: IStorage;

        beforeEach(async () => {
            storage = await storageFactory();
        });

        afterEach(async () => {
            if (cleanup) {
                await cleanup();
            }
        });

        describe('File Operations', () => {
            it('should save, retrieve, and delete a file', async () => {
                const data = new Uint8Array([1, 2, 3, 4, 5]);
                const filePath = 'test/file.dat';

                await storage.saveFile(filePath, data);
                const retrieved = await storage.getFile(filePath);
                expect(retrieved).toEqual(data);

                await storage.deleteFile(filePath);
                const afterDelete = await storage.getFile(filePath);
                expect(afterDelete).toBeNull();
            });

            it('should handle non-existent files', async () => {
                const retrieved = await storage.getFile('non-existent.txt');
                expect(retrieved).toBeNull();
            });

            it('should list files with prefix', async () => {
                const data = new Uint8Array([0]);
                await storage.saveFile('a/1.txt', data);
                await storage.saveFile('a/2.txt', data);
                await storage.saveFile('b/3.txt', data);
                await storage.saveFile('a/sub/4.txt', data);

                const aFiles = await storage.listFiles('a/');
                expect(aFiles.length).toBe(3);
                expect(aFiles).toContain('a/1.txt');
                expect(aFiles).toContain('a/2.txt');
                expect(aFiles).toContain('a/sub/4.txt');

                const bFiles = await storage.listFiles('b/');
                expect(bFiles).toEqual(['b/3.txt']);

                const allFiles = await storage.listFiles('');
                expect(allFiles.length).toBe(4);
            });
        });

        describe('Daily Database Operations', () => {
            it('should save and retrieve daily DBs', async () => {
                const data = new Uint8Array([10, 20, 30]);
                const date = '2023-10-27';
                
                await storage.saveDailyDb(date, 'public', data);
                const retrieved = await storage.getDailyDb(date, 'public');
                expect(retrieved).toEqual(data);

                const hash = await storage.getDailyDbHash(date, 'public');
                expect(hash).toBeDefined();
                expect(hash?.length).toBe(64); // SHA-256 hex
            });

            it('should handle followed daily DBs', async () => {
                const data = new Uint8Array([5, 10, 15]);
                const userId = 'user-1';
                const date = '2023-10-27';

                await storage.saveFollowedDb(userId, date, data);
                const hash = await storage.getFollowedDbHash(userId, date);
                expect(hash).toBeDefined();
                expect(hash?.length).toBe(64);
            });
        });

        describe('Metadata and Following', () => {
            it('should manage remote hash cache', async () => {
                const path = 'some/file.txt';
                const hash = 'abc123hash';

                await storage.setGenericRemoteHashCache(path, hash);
                expect(await storage.getGenericRemoteHashCache(path)).toBe(hash);

                await storage.setRemoteHashCache('2023-10-27', 'private', 'private-hash');
                expect(await storage.getRemoteHashCache('2023-10-27', 'private')).toBe('private-hash');
            });

            it('should manage last sync date', async () => {
                const date = '2023-10-27T10:00:00Z';
                await storage.setLastSyncDate(date);
                expect(await storage.getLastSyncDate()).toBe(date);
            });

            it('should manage following users', async () => {
                const user = {
                    userId: 'alice',
                    lastSync: '2023-10-01',
                    publicKey: 'pubkey-alice'
                };

                await storage.followUser(user.userId, user.lastSync, user.publicKey);
                let following = await storage.getFollowing();
                expect(following).toContainEqual(user);

                await storage.updateFollowedUserSync(user.userId, '2023-10-27');
                following = await storage.getFollowing();
                expect(following.find(f => f.userId === 'alice')?.lastSync).toBe('2023-10-27');

                await storage.unfollowUser(user.userId);
                following = await storage.getFollowing();
                expect(following.find(f => f.userId === 'alice')).toBeUndefined();
            });
        });

        describe('Security', () => {
            it('should prevent directory traversal with ../', async () => {
                const data = new Uint8Array([9, 9, 9]);
                const maliciousPath = '../traversal.txt';
                
                await storage.saveFile(maliciousPath, data);
                
                // All storages should now sanitize the path by removing '../'
                const files = await storage.listFiles('');
                expect(files).toContain('traversal.txt');
                expect(files).not.toContain('../traversal.txt');

                const retrieved = await storage.getFile('traversal.txt');
                expect(retrieved).toEqual(data);
                
                const retrievedMalicious = await storage.getFile(maliciousPath);
                expect(retrievedMalicious).toEqual(data); // Because maliciousPath is also sanitized when getting
            });
        });
    });
}

describe('Storage Parity Tests', () => {
    // 1. IndexedDBStorage
    runStorageTests('IndexedDBStorage', async () => {
        const dbName = 'test-db-' + Math.random().toString(36).substring(2);
        const storage = new IndexedDBStorage(dbName);
        await storage.init();
        return storage;
    });

    // 2. NodeStorage
    const nodeBaseDir = path.join(os.tmpdir(), 'sovereign-test-node-' + Math.random().toString(36).substring(2));
    runStorageTests('NodeStorage', async () => {
        await fs.ensureDir(nodeBaseDir);
        const storage = new NodeStorage(nodeBaseDir);
        await storage.init();
        return storage;
    }, async () => {
        await fs.remove(nodeBaseDir);
    });

    // 3. SQLiteNodeStorage
    const sqliteDbPath = path.join(os.tmpdir(), 'sovereign-test-sqlite-' + Math.random().toString(36).substring(2), 'storage.db');
    runStorageTests('SQLiteNodeStorage', async () => {
        await fs.ensureDir(path.dirname(sqliteDbPath));
        const storage = new SQLiteNodeStorage(sqliteDbPath);
        await storage.init();
        return storage;
    }, async () => {
        await fs.remove(path.dirname(sqliteDbPath));
    });
});
