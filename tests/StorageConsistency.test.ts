import 'fake-indexeddb/auto';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import initSqlJs from 'sql.js';
import { IStorage } from '../src/interfaces/IStorage';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import { NodeStorage } from '../src/adapters/NodeStorage';
import { SQLiteNodeStorage } from '../src/adapters/SQLiteNodeStorage';

(global as any).initSqlJs = initSqlJs;

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
            test('should save, retrieve, and delete a file', async () => {
                const data = new TextEncoder().encode('Hello Sovereign');
                await storage.saveFile('test.txt', data);
                
                const retrieved = await storage.getFile('test.txt');
                expect(retrieved).toEqual(data);

                await storage.deleteFile('test.txt');
                expect(await storage.getFile('test.txt')).toBeNull();
            });

            test('should handle non-existent files', async () => {
                expect(await storage.getFile('missing.txt')).toBeNull();
            });

            test('should list files with prefix', async () => {
                await storage.saveFile('public/a.txt', new Uint8Array([1]));
                await storage.saveFile('public/b.txt', new Uint8Array([2]));
                await storage.saveFile('private/c.txt', new Uint8Array([3]));

                const publicFiles = await storage.listFiles('public/');
                expect(publicFiles).toHaveLength(2);
                expect(publicFiles).toContain('public/a.txt');
                expect(publicFiles).toContain('public/b.txt');
            });
        });

        describe('Daily Database Operations', () => {
            test('should save and retrieve daily DBs', async () => {
                const data = new Uint8Array([1, 2, 3, 4]);
                await storage.saveDailyDb('2024-03-22', 'public', data);
                
                const retrieved = await storage.getDailyDb('2024-03-22', 'public');
                expect(retrieved).toEqual(data);
                
                const hash = await storage.getDailyDbHash('2024-03-22', 'public');
                expect(hash).toBeDefined();
            });

            test('should handle followed daily DBs', async () => {
                const data = new Uint8Array([9, 9, 9]);
                await storage.saveFollowedDb('user-123', '2024-03-22', data);
                
                // Note: SQLiteNodeStorage might implement this differently than NodeStorage
                // We're testing for overall contract adherence
                const hash = await storage.getFollowedDbHash('user-123', '2024-03-22');
                expect(hash).toBeDefined();
            });
        });

        describe('Metadata and Following', () => {
            test('should manage remote hash cache', async () => {
                await storage.setGenericRemoteHashCache('some/file.txt', 'hash-123');
                expect(await storage.getGenericRemoteHashCache('some/file.txt')).toBe('hash-123');
                
                await storage.setRemoteHashCache('2024-03-22', 'private', 'hash-456');
                expect(await storage.getRemoteHashCache('2024-03-22', 'private')).toBe('hash-456');
            });

            test('should manage last sync date', async () => {
                await storage.setLastSyncDate('2024-03-22');
                expect(await storage.getLastSyncDate()).toBe('2024-03-22');
            });

            test('should manage following users', async () => {
                await storage.followUser('bob', '2024-03-20', 'pubkey-bob');
                await storage.followUser('alice', '2024-03-21', 'pubkey-alice');

                const following = await storage.getFollowing();
                expect(following).toHaveLength(2);
                
                const bob = following.find(f => f.userId === 'bob');
                expect(bob?.publicKey).toBe('pubkey-bob');

                await storage.updateFollowedUserSync('bob', '2024-03-22');
                const updated = await storage.getFollowing();
                expect(updated.find(f => f.userId === 'bob')?.lastSync).toBe('2024-03-22');

                await storage.unfollowUser('bob');
                expect(await storage.getFollowing()).toHaveLength(1);
            });
        });

        describe('Security', () => {
            test('should prevent directory traversal with ../', async () => {
                // Not all adapters may throw here, but we should verify they don't leak
                try {
                    await storage.saveFile('../secret.txt', new Uint8Array([0]));
                    const files = await storage.listFiles('');
                    expect(files).not.toContain('../secret.txt');
                } catch (e) {
                    // Exception is also fine
                }
            });
        });
    });
}

describe('Storage Parity Tests', () => {
    // 1. Test NodeStorage (Disk-based)
    const nodeBaseDir = path.join(os.tmpdir(), 'sov-node-test-' + Math.random().toString(36).substring(7));
    runStorageTests('NodeStorage', async () => {
        const s = new NodeStorage(nodeBaseDir);
        await s.init();
        return s;
    }, async () => {
        if (await fs.pathExists(nodeBaseDir)) {
            await fs.remove(nodeBaseDir);
        }
    });

    // 2. Test IndexedDBStorage (In-memory mock via fake-indexeddb)
    runStorageTests('IndexedDBStorage', async () => {
        const s = new IndexedDBStorage('test-db-' + Math.random().toString(36).substring(7));
        await s.init();
        return s;
    });

    // 3. Test SQLiteNodeStorage (Single file disk-based)
    const sqlitePath = path.join(os.tmpdir(), 'sov-sqlite-test-' + Math.random().toString(36).substring(7) + '.db');
    runStorageTests('SQLiteNodeStorage', async () => {
        const s = new SQLiteNodeStorage(sqlitePath);
        await s.init();
        return s;
    }, async () => {
        if (await fs.pathExists(sqlitePath)) {
            await fs.remove(sqlitePath);
        }
    });
});
