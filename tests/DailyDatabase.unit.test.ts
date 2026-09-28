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
});
