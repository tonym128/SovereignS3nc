import { SovereignS3nc } from '../src/SovereignS3nc';
import { DailyDatabase } from '../src/core/DailyDatabase';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import { IDBFactory } from 'fake-indexeddb';
import crypto from 'crypto';
import initSqlJs from 'sql.js';

// Polyfills
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

class MockRemote implements IRemoteAdapter {
    async uploadFile(): Promise<string | null> { return '"etag"'; }
    async downloadFile(): Promise<any | null> { return null; }
    async getFileHash(): Promise<string | null> { return null; }
    async getFileEtag(): Promise<string | null> { return null; }
    async canWrite(): Promise<boolean> { return true; }
}

describe('DailyDatabase Lifecycle & Management Utility', () => {
    let sov: SovereignS3nc;
    let dailyDb: DailyDatabase;
    const testDate = '2026-09-28';

    beforeEach(async () => {
        (global as any).indexedDB = new IDBFactory();
        const testId = Math.random().toString(36).substring(7);
        const config = {
            paths: { appId: `dailydb-test-${testId}`, userId: 'alice', storeId: 'main' },
            password: 'password123',
            debug: false
        };

        sov = new SovereignS3nc(config, new MockRemote());
        await sov.init();

        sov.registerModule({
            name: 'custom_notes',
            tables: [
                {
                    name: 'items',
                    schema: 'id TEXT PRIMARY KEY, text TEXT'
                }
            ]
        });

        dailyDb = sov.getDailyDatabase('custom_notes');
    });

    test('should cache the sql.js WebAssembly instance across calls', async () => {
        const instance1 = await DailyDatabase.getSqliteInstance();
        const instance2 = await DailyDatabase.getSqliteInstance();
        expect(instance1).toBe(instance2);
    });

    test('should execute withDatabase, apply registered schema, and persist data', async () => {
        const testPath = 'public/modules/custom_notes/2026-09-28.db';

        // Write
        await dailyDb.withDatabase(testPath, (db) => {
            db.run('INSERT INTO items (id, text) VALUES (?, ?)', ['n1', 'First note']);
        }, { save: true });

        // Read in a separate session
        const readResult = await dailyDb.withDatabase(testPath, (db) => {
            const res = db.exec('SELECT * FROM items WHERE id = ?', ['n1']);
            expect(res.length).toBe(1);
            return res[0].values[0];
        });

        expect(readResult).toEqual(['n1', 'First note']);
    });

    test('should emit update event when emitUpdate is true', async () => {
        const testPath = 'public/modules/custom_notes/2026-09-28.db';
        let eventFired = false;

        sov.on('custom_notes:update', (data) => {
            if (data.path === testPath) {
                eventFired = true;
            }
        });

        await dailyDb.withDatabase(testPath, (db) => {
            db.run('INSERT INTO items (id, text) VALUES (?, ?)', ['n2', 'Event note']);
        }, { save: true, emitUpdate: true });

        expect(eventFired).toBe(true);
    });

    test('should recover gracefully from corrupted database file by resetting it', async () => {
        const testPath = 'public/modules/custom_notes/corrupt.db';
        // Write invalid non-SQLite binary garbage
        const garbage = new TextEncoder().encode('THIS IS NOT A SQLITE DATABASE FILE GARBAGE CONTENT');
        await sov.getStorage().saveFile(testPath, garbage);

        // Opening via DailyDatabase should recover and apply schema
        await dailyDb.withDatabase(testPath, (db) => {
            db.run('INSERT INTO items (id, text) VALUES (?, ?)', ['recovered', 'Working fine']);
        }, { save: true, applySchema: true });

        const verified = await dailyDb.withDatabase(testPath, (db) => {
            const res = db.exec('SELECT text FROM items WHERE id = "recovered"');
            return res[0].values[0][0];
        });

        expect(verified).toBe('Working fine');
    });

    test('should support symmetric encryption and decryption with keys', async () => {
        const encKey = crypto.randomBytes(32).toString('hex');
        const testPath = 'private/encrypted_test.db';

        await dailyDb.withDatabase(testPath, (db) => {
            db.exec('CREATE TABLE secret (id TEXT, value TEXT);');
            db.run('INSERT INTO secret VALUES (?, ?)', ['s1', 'TopSecretData']);
        }, { save: true, encryptKey: encKey, applySchema: false });

        // Raw file in storage should not contain plaintext "TopSecretData"
        const rawBytes = await sov.getStorage().getFile(testPath);
        expect(rawBytes).not.toBeNull();
        const rawString = new TextDecoder().decode(rawBytes!);
        expect(rawString).not.toContain('TopSecretData');

        // Reading with decryptKey should decrypt successfully
        const secretVal = await dailyDb.withDatabase(testPath, (db) => {
            const res = db.exec('SELECT value FROM secret WHERE id = "s1"');
            return res[0].values[0][0];
        }, { decryptKey: encKey, applySchema: false });

        expect(secretVal).toBe('TopSecretData');
    });

    describe('Debounced & Batched Export', () => {
        test('should debounce multiple rapid writes into a single storage write', async () => {
            const debouncedDb = sov.getDailyDatabase('debounced_module', { debounceMs: 150 });
            const testPath = 'public/modules/debounced_module/batch_test.db';
            const saveFileSpy = jest.spyOn(sov.getStorage(), 'saveFile');

            saveFileSpy.mockClear();

            // Perform 5 rapid writes
            for (let i = 0; i < 5; i++) {
                await debouncedDb.withDatabase(testPath, (db) => {
                    db.exec('CREATE TABLE IF NOT EXISTS counts (num INTEGER);');
                    db.run('INSERT INTO counts (num) VALUES (?)', [i]);
                }, { save: true, debounce: true });
            }

            // Immediately after writes: isDirty should be true, but storage saveFile not called yet
            expect(debouncedDb.isDirty(testPath)).toBe(true);
            expect(saveFileSpy).not.toHaveBeenCalled();

            // Read consistency: query immediately sees all 5 inserts in memory!
            const countBeforeFlush = await debouncedDb.withDatabase(testPath, (db) => {
                const res = db.exec('SELECT COUNT(*) FROM counts');
                return res[0].values[0][0];
            });
            expect(countBeforeFlush).toBe(5);

            // Wait for debounce timer to fire (150ms + margin)
            await new Promise(resolve => setTimeout(resolve, 250));

            // Now saveFile should have been called exactly once!
            expect(saveFileSpy).toHaveBeenCalledTimes(1);
            expect(debouncedDb.isDirty(testPath)).toBe(false);

            saveFileSpy.mockRestore();
        });

        test('should immediately commit when flush() or immediate: true is called', async () => {
            const debouncedDb = sov.getDailyDatabase('debounced_module', { debounceMs: 500 });
            const testPath = 'public/modules/debounced_module/flush_test.db';
            const saveFileSpy = jest.spyOn(sov.getStorage(), 'saveFile');

            saveFileSpy.mockClear();

            // Write with debounce
            await debouncedDb.withDatabase(testPath, (db) => {
                db.exec('CREATE TABLE IF NOT EXISTS entries (val TEXT);');
                db.run('INSERT INTO entries VALUES (?)', ['alpha']);
            }, { save: true, debounce: true });

            expect(debouncedDb.isDirty(testPath)).toBe(true);
            expect(saveFileSpy).not.toHaveBeenCalled();

            // Call flush()
            await debouncedDb.flush(testPath);
            expect(debouncedDb.isDirty(testPath)).toBe(false);
            expect(saveFileSpy).toHaveBeenCalledTimes(1);

            // Write with immediate: true
            await debouncedDb.withDatabase(testPath, (db) => {
                db.run('INSERT INTO entries VALUES (?)', ['beta']);
            }, { save: true, immediate: true });

            expect(saveFileSpy).toHaveBeenCalledTimes(2);
            expect(debouncedDb.isDirty(testPath)).toBe(false);

            saveFileSpy.mockRestore();
        });

        test('should flush all dirty databases across modules via flushAll()', async () => {
            const dbA = sov.getDailyDatabase('mod_a', { debounceMs: 500 });
            const dbB = sov.getDailyDatabase('mod_b', { debounceMs: 500 });
            const pathA = 'public/modules/mod_a/a.db';
            const pathB = 'public/modules/mod_b/b.db';

            await dbA.withDatabase(pathA, (db) => {
                db.exec('CREATE TABLE IF NOT EXISTS t (v TEXT);');
                db.run('INSERT INTO t VALUES (?)', ['from_a']);
            }, { save: true, debounce: true });

            await dbB.withDatabase(pathB, (db) => {
                db.exec('CREATE TABLE IF NOT EXISTS t (v TEXT);');
                db.run('INSERT INTO t VALUES (?)', ['from_b']);
            }, { save: true, debounce: true });

            expect(sov.getDailyDatabase().isDirty()).toBe(true);

            // flushAll from root dailyDb flushes all modules sharing the pool
            await sov.getDailyDatabase().flushAll();
            expect(sov.getDailyDatabase().isDirty()).toBe(false);

            const fileA = await sov.getStorage().getFile(pathA);
            const fileB = await sov.getStorage().getFile(pathB);
            expect(fileA).not.toBeNull();
            expect(fileB).not.toBeNull();
        });

        test('should force flush under continuous writes when maxWaitMs is exceeded', async () => {
            // Configure short debounce (100ms) and short maxWait (200ms)
            const debouncedDb = sov.getDailyDatabase('stream_mod', { debounceMs: 100, maxWaitMs: 200 });
            const testPath = 'public/modules/stream_mod/stream.db';
            const saveFileSpy = jest.spyOn(sov.getStorage(), 'saveFile');

            saveFileSpy.mockClear();

            // Simulate continuous writes every 50ms (which would endlessly reset a normal debounce)
            for (let i = 0; i < 6; i++) {
                await debouncedDb.withDatabase(testPath, (db) => {
                    db.exec('CREATE TABLE IF NOT EXISTS stream (i INTEGER);');
                    db.run('INSERT INTO stream VALUES (?)', [i]);
                }, { save: true, debounce: true });
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            // At least one max-wait flush should have fired despite writes arriving every 50ms
            expect(saveFileSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

            // Clean up
            await debouncedDb.flushAll();
            saveFileSpy.mockRestore();
        });
    });
});
