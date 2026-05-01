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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const SovereignS3nc_1 = require("../src/SovereignS3nc");
const Feed_1 = require("../src/modules/Feed");
const Profile_1 = require("../src/modules/Profile");
const IndexedDBStorage_1 = require("../src/adapters/IndexedDBStorage");
const SQLiteNodeStorage_1 = require("../src/adapters/SQLiteNodeStorage");
const crypto_1 = __importDefault(require("crypto"));
const fake_indexeddb_1 = require("fake-indexeddb");
const sql_js_1 = __importDefault(require("sql.js"));
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
// --- Browser Polyfills ---
global.indexedDB = new fake_indexeddb_1.IDBFactory();
global.crypto = crypto_1.default.webcrypto;
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.initSqlJs = sql_js_1.default;
class MockRemote {
    constructor() {
        this.files = new Map();
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
        if (ifNoneMatch && ifNoneMatch === entry.etag)
            return { data: null, etag: entry.etag, notModified: true };
        return { data: entry.data, etag: entry.etag };
    }
    async getFileHash(path) { return this.files.get(path)?.hash || null; }
    async getFileEtag(path) { return this.files.get(path)?.etag || null; }
    async canWrite(path) { return true; }
    async listFiles(prefix) { return Array.from(this.files.keys()).filter(k => k.startsWith(prefix)); }
    async deleteFile(path) { this.files.delete(path); }
    async getFileMetadata(path, key) { return null; }
}
describe('Storage Migration Integration Tests', () => {
    const appId = 'migration-test-' + Math.random().toString(36).substring(7);
    const userId = 'alice';
    const storeId = 'social';
    const password = 'alice-password';
    const sqliteDbPath = path.join(__dirname, '../test-results/migration_test.sqlite');
    beforeAll(async () => {
        await fs.ensureDir(path.dirname(sqliteDbPath));
        await fs.remove(sqliteDbPath);
    });
    afterAll(async () => {
        await fs.remove(sqliteDbPath);
    });
    test('Migrate data from IndexedDB to SQLite via S3 Sync', async () => {
        const sharedRemote = new MockRemote();
        // 1. Setup Alice with IndexedDB
        const aliceIDB = new SovereignS3nc_1.SovereignS3nc({
            paths: { appId, userId, storeId },
            password
        }, sharedRemote);
        aliceIDB.storage = new IndexedDBStorage_1.IndexedDBStorage(`migration_test_idb`);
        await aliceIDB.init();
        const feedIDB = new Feed_1.FeedModule(aliceIDB);
        const profileIDB = new Profile_1.ProfileModule(aliceIDB);
        // 2. Populate data in IndexedDB
        await feedIDB.post("Post 1 from IndexedDB", true);
        await profileIDB.updateProfile("Alice", "Testing migration");
        await aliceIDB.sync();
        // 3. Setup Alice with SQLite
        const aliceSQLite = new SovereignS3nc_1.SovereignS3nc({
            paths: { appId, userId, storeId },
            password
        }, sharedRemote);
        const sqliteStorage = new SQLiteNodeStorage_1.SQLiteNodeStorage(sqliteDbPath);
        aliceSQLite.storage = sqliteStorage;
        await aliceSQLite.init();
        const feedSQLite = new Feed_1.FeedModule(aliceSQLite);
        const profileSQLite = new Profile_1.ProfileModule(aliceSQLite);
        // 4. Sync from remote (Mock S3) to SQLite
        await aliceSQLite.sync();
        // 5. Verify data in SQLite matches original
        const today = SovereignS3nc_1.SovereignS3nc.getDateStr(new Date());
        const posts = await feedSQLite.getPosts(today, 'public');
        expect(posts.length).toBe(1);
        expect(posts[0].content).toBe("Post 1 from IndexedDB");
        const profile = await profileSQLite.getProfile(userId);
        expect(profile?.name).toBe("Alice");
        expect(profile?.bio).toBe("Testing migration");
    });
    test('Manual file-level migration (Local copy)', async () => {
        // 1. Setup Bob with IndexedDB
        const bobIDB = new SovereignS3nc_1.SovereignS3nc({
            paths: { appId: 'bob-app', userId: 'bob', storeId: 'social' },
            password: 'bob-password'
        });
        const idbStorage = new IndexedDBStorage_1.IndexedDBStorage(`bob_idb`);
        bobIDB.storage = idbStorage;
        await bobIDB.init();
        const feedIDB = new Feed_1.FeedModule(bobIDB);
        await feedIDB.post("Bob's local post", true);
        // 2. Manually copy all files from IDB to a new SQLite storage
        const bobSQLiteStoragePath = path.join(__dirname, '../test-results/bob_migration.sqlite');
        await fs.remove(bobSQLiteStoragePath);
        const bobSQLiteStorage = new SQLiteNodeStorage_1.SQLiteNodeStorage(bobSQLiteStoragePath);
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
        const bobSQLite = new SovereignS3nc_1.SovereignS3nc({
            paths: { appId: 'bob-app', userId: 'bob', storeId: 'social' },
            password: 'bob-password'
        });
        bobSQLite.storage = bobSQLiteStorage;
        await bobSQLite.init();
        // 4. Verify data consistency
        const feedSQLite = new Feed_1.FeedModule(bobSQLite);
        const today = SovereignS3nc_1.SovereignS3nc.getDateStr(new Date());
        const posts = await feedSQLite.getPosts(today, 'public');
        expect(posts.length).toBe(1);
        expect(posts[0].content).toBe("Bob's local post");
        await fs.remove(bobSQLiteStoragePath);
    });
});
//# sourceMappingURL=StorageMigration.integration.js.map