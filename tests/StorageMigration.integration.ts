
import { SovereignS3nc } from '../src/SovereignS3nc';
import { FeedModule } from '../src/modules/Feed';
import { MessagingModule } from '../src/modules/Messaging';
import { ProfileModule } from '../src/modules/Profile';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import { SQLiteNodeStorage } from '../src/adapters/SQLiteNodeStorage';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';
import * as fs from 'fs-extra';
import * as path from 'path';

// --- Browser Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

describe('Storage Migration Integration Tests', () => {
    const appId = 'migration-test-' + Math.random().toString(36).substring(7);
    const userId = 'alice';
    const storeId = 'social';
    const password = 'alice-password';

    const sqliteDbPath = path.join(__dirname, '../test-results/migration_test.sqlite');

    beforeAll(async () => {
        await fs.remove(sqliteDbPath);
    });

    afterAll(async () => {
        await fs.remove(sqliteDbPath);
    });

    test('Migrate data from IndexedDB to SQLite via S3 Sync', async () => {
        // 1. Setup Alice with IndexedDB
        const aliceIDB = new SovereignS3nc({
            paths: { appId, userId, storeId },
            password
        });
        (aliceIDB as any).storage = new IndexedDBStorage(`migration_test_idb`);
        await aliceIDB.init();

        const feedIDB = new FeedModule(aliceIDB);
        const profileIDB = new ProfileModule(aliceIDB);

        // 2. Populate data in IndexedDB
        await feedIDB.post("Post 1 from IndexedDB", true);
        await profileIDB.updateProfile({ name: "Alice", bio: "Testing migration" });
        
        // Sync to "remote" (we'll use the default fake remote if none provided, 
        // but for integration we should ideally use a mock or real S3. 
        // Here we'll rely on the library's internal consistency.)
        await aliceIDB.sync();

        // 3. Setup Alice with SQLite
        const aliceSQLite = new SovereignS3nc({
            paths: { appId, userId, storeId },
            password
        });
        const sqliteStorage = new SQLiteNodeStorage(sqliteDbPath);
        (aliceSQLite as any).storage = sqliteStorage;
        await aliceSQLite.init();

        const feedSQLite = new FeedModule(aliceSQLite);
        const profileSQLite = new ProfileModule(aliceSQLite);

        // 4. Sync from remote (S3) to SQLite
        // Since both share the same appId/userId/storeId, they point to the same S3 prefix.
        // But wait, they need to share the SAME remote adapter instance or state if it's mocked.
        // In this test, they'll use the default S3RemoteAdapter which might fail if no config.
        // Let's use a mock remote adapter to ensure they share the same "cloud".
        
        const mockRemote = (aliceIDB as any).globalRemote;
        (aliceSQLite as any).globalRemote = mockRemote;
        (aliceSQLite as any).privateRemote = (aliceIDB as any).privateRemote;

        await aliceSQLite.sync();

        // 5. Verify data in SQLite matches original
        const today = SovereignS3nc.getDateStr(new Date());
        const posts = await feedSQLite.getPosts(today, 'public');
        expect(posts.length).toBe(1);
        expect(posts[0].content).toBe("Post 1 from IndexedDB");

        const profile = await profileSQLite.getProfile(userId);
        expect(profile?.name).toBe("Alice");
        expect(profile?.bio).toBe("Testing migration");
    });

    test('Manual file-level migration (Local copy)', async () => {
        // 1. Setup Bob with IndexedDB
        const bobIDB = new SovereignS3nc({
            paths: { appId: 'bob-app', userId: 'bob', storeId: 'social' },
            password: 'bob-password'
        });
        const idbStorage = new IndexedDBStorage(`bob_idb`);
        (bobIDB as any).storage = idbStorage;
        await bobIDB.init();

        const feedIDB = new FeedModule(bobIDB);
        await feedIDB.post("Bob's local post", true);

        // 2. Manually copy all files from IDB to a new SQLite storage
        const bobSQLiteStorage = new SQLiteNodeStorage(path.join(__dirname, '../test-results/bob_migration.sqlite'));
        await bobSQLiteStorage.init();

        const allFiles = await idbStorage.listFiles('');
        for (const file of allFiles) {
            const data = await idbStorage.getFile(file);
            if (data) {
                await bobSQLiteStorage.saveFile(file, data);
            }
        }
        
        // Copy metadata (following, etc.)
        const following = await idbStorage.getFollowing();
        for (const f of following) {
            await bobSQLiteStorage.followUser(f.userId, f.lastSync, f.publicKey);
        }

        // 3. Initialize Bob with SQLite
        const bobSQLite = new SovereignS3nc({
            paths: { appId: 'bob-app', userId: 'bob', storeId: 'social' },
            password: 'bob-password'
        });
        (bobSQLite as any).storage = bobSQLiteStorage;
        await bobSQLite.init();

        // 4. Verify data consistency
        const feedSQLite = new FeedModule(bobSQLite);
        const today = SovereignS3nc.getDateStr(new Date());
        const posts = await feedSQLite.getPosts(today, 'public');
        expect(posts.length).toBe(1);
        expect(posts[0].content).toBe("Bob's local post");
        
        await fs.remove(path.join(__dirname, '../test-results/bob_migration.sqlite'));
    });
});
