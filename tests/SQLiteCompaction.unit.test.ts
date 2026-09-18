import { SovereignS3nc } from '../src/SovereignS3nc';
import { MessagingModule, Message } from '../src/modules/Messaging';
import { FeedModule, Post } from '../src/modules/Feed';
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
    files: Map<string, { data: Uint8Array; hash: string; etag: string }> = new Map();
    async uploadFile(path: string, data: Uint8Array): Promise<string | null> {
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: '', etag });
        return etag;
    }
    async downloadFile(path: string): Promise<any | null> {
        const entry = this.files.get(path);
        if (!entry) return null;
        return { data: entry.data, etag: entry.etag };
    }
    async getFileHash(): Promise<string | null> { return null; }
    async getFileEtag(): Promise<string | null> { return null; }
    async canWrite(): Promise<boolean> { return true; }
}

describe('SQLite File Fragmentation & Compaction Stress Tests', () => {
    let sov: SovereignS3nc;
    let messaging: MessagingModule;
    let feed: FeedModule;
    const testDate = '2026-09-18';

    beforeEach(async () => {
        (global as any).indexedDB = new IDBFactory();
        const testId = Math.random().toString(36).substring(7);
        const config = {
            paths: { appId: `compaction-test-${testId}`, userId: 'alice', storeId: 'main' },
            password: 'password123',
            debug: false
        };
        sov = new SovereignS3nc(config, new MockRemote());
        await sov.init();
        messaging = new MessagingModule(sov);
        feed = new FeedModule(sov);
    });

    test('Messaging outbox stress test: 1,000 messages, 90% tombstones, >= 40% size reduction after VACUUM', async () => {
        const SQL = await initSqlJs();
        const db = new SQL.Database();
        db.exec(`CREATE TABLE messages (
            id TEXT PRIMARY KEY,
            content TEXT,
            timestamp INTEGER,
            senderId TEXT,
            recipientId TEXT,
            image TEXT,
            isEdited INTEGER DEFAULT 0,
            isDeleted INTEGER DEFAULT 0,
            status TEXT DEFAULT 'sent',
            expiresAt INTEGER DEFAULT NULL
        );`);

        // Insert 1,000 messages with substantial content to observe page allocation
        const stmt = db.prepare('INSERT INTO messages (id, content, timestamp, senderId, recipientId, isDeleted) VALUES (?, ?, ?, ?, ?, ?)');
        const dummyPayload = 'A'.repeat(250); // 250 bytes per row

        for (let i = 0; i < 1000; i++) {
            stmt.run([`msg-${i}`, `Message content ${i} ${dummyPayload}`, Date.now() - i * 1000, 'alice', 'bob', 0]);
        }
        stmt.free();

        // 90% of messages are marked as deleted (tombstoned)
        db.run('UPDATE messages SET isDeleted = 1, content = "" WHERE id IN (SELECT id FROM messages LIMIT 900)');

        const uncompactedBinary = db.export();
        const uncompactedSize = uncompactedBinary.byteLength;
        db.close();

        // Save uncompacted DB to outbox storage
        const outboxPath = sov.getModulePath('messaging', `dms/outbox/${testDate}.db`, 'private');
        await sov.getStorage().saveFile(outboxPath, uncompactedBinary);

        // Run compaction
        const result = await messaging.compactDatabase(testDate, false);

        expect(result.compacted).toBe(true);
        expect(result.tombstoneRatio).toBe(0.9);
        expect(result.originalSize).toBe(uncompactedSize);
        expect(result.newSize).toBeLessThan(uncompactedSize);

        // Verify >= 40% size reduction
        const reductionRatio = (result.originalSize - result.newSize) / result.originalSize;
        expect(reductionRatio).toBeGreaterThanOrEqual(0.40);

        // Verify remaining 100 messages are intact and structurally valid
        const compactedData = await sov.getStorage().getFile(outboxPath);
        expect(compactedData).not.toBeNull();

        const compactedDb = new SQL.Database(compactedData!);
        const remainingRows = compactedDb.exec('SELECT COUNT(*) FROM messages');
        expect(remainingRows[0].values[0][0]).toBe(100);

        // Verify remaining messages have content
        const checkRows = compactedDb.exec('SELECT id, content FROM messages LIMIT 5');
        expect(checkRows[0].values.length).toBe(5);
        expect((checkRows[0].values[0][1] as string).length).toBeGreaterThan(200);

        compactedDb.close();
    });

    test('Feed stress test: 1,000 posts, 90% tombstones, >= 40% size reduction after VACUUM', async () => {
        const SQL = await initSqlJs();
        const db = new SQL.Database();
        db.exec(`CREATE TABLE posts (
            id TEXT PRIMARY KEY,
            content TEXT,
            timestamp INTEGER,
            userId TEXT,
            image TEXT,
            parentId TEXT,
            parentUserId TEXT,
            isEdited INTEGER DEFAULT 0,
            isDeleted INTEGER DEFAULT 0,
            expiresAt INTEGER DEFAULT NULL
        );`);

        const stmt = db.prepare('INSERT INTO posts (id, content, timestamp, userId, isDeleted) VALUES (?, ?, ?, ?, ?)');
        const dummyPayload = 'P'.repeat(250);

        for (let i = 0; i < 1000; i++) {
            stmt.run([`post-${i}`, `Post body ${i} ${dummyPayload}`, Date.now() - i * 1000, 'alice', 0]);
        }
        stmt.free();

        // Mark 900 posts as deleted (tombstone)
        db.run('UPDATE posts SET isDeleted = 1, content = "" WHERE id IN (SELECT id FROM posts LIMIT 900)');

        const uncompactedBinary = db.export();
        const uncompactedSize = uncompactedBinary.byteLength;
        db.close();

        // Save to feed storage
        const feedPath = sov.getModulePath('feed', `${testDate}.db`, 'public');
        await sov.getStorage().saveFile(feedPath, uncompactedBinary);

        // Run compaction
        const result = await feed.compactDatabase(testDate, true, false);

        expect(result.compacted).toBe(true);
        expect(result.tombstoneRatio).toBe(0.9);
        expect(result.originalSize).toBe(uncompactedSize);

        const reductionRatio = (result.originalSize - result.newSize) / result.originalSize;
        expect(reductionRatio).toBeGreaterThanOrEqual(0.40);

        // Query remaining posts via FeedModule API
        const activePosts = await feed.getPosts(testDate, 'public');
        expect(activePosts.length).toBe(100);
        expect(activePosts[0].isDeleted).toBeFalsy();
    });

    test('Tombstone ratio threshold: does not compact when tombstones < 50% unless forced', async () => {
        const SQL = await initSqlJs();
        const db = new SQL.Database();
        db.exec(`CREATE TABLE posts (
            id TEXT PRIMARY KEY,
            content TEXT,
            timestamp INTEGER,
            userId TEXT,
            image TEXT,
            parentId TEXT,
            parentUserId TEXT,
            isEdited INTEGER DEFAULT 0,
            isDeleted INTEGER DEFAULT 0,
            expiresAt INTEGER DEFAULT NULL
        );`);

        // Insert 100 posts, only 10 deleted (10% tombstone ratio)
        for (let i = 0; i < 100; i++) {
            db.run('INSERT INTO posts (id, content, timestamp, userId, isDeleted) VALUES (?, ?, ?, ?, ?)',
                [`post-${i}`, `Post ${i}`, Date.now(), 'alice', i < 10 ? 1 : 0]);
        }

        const feedPath = sov.getModulePath('feed', `${testDate}.db`, 'public');
        await sov.getStorage().saveFile(feedPath, db.export());
        db.close();

        // Without force: should skip compaction
        const skipResult = await feed.compactDatabase(testDate, true, false);
        expect(skipResult.compacted).toBe(false);
        expect(skipResult.tombstoneRatio).toBe(0.1);

        // With force: should execute compaction
        const forceResult = await feed.compactDatabase(testDate, true, true);
        expect(forceResult.compacted).toBe(true);
    });

    test('cleanupExpired triggers automatic VACUUM and compacts database', async () => {
        const SQL = await initSqlJs();
        const db = new SQL.Database();
        db.exec(`CREATE TABLE posts (
            id TEXT PRIMARY KEY,
            content TEXT,
            timestamp INTEGER,
            userId TEXT,
            image TEXT,
            parentId TEXT,
            parentUserId TEXT,
            isEdited INTEGER DEFAULT 0,
            isDeleted INTEGER DEFAULT 0,
            expiresAt INTEGER DEFAULT NULL
        );`);

        // 500 expired posts, 50 valid posts
        const expiredTime = Date.now() - 60000;
        const validTime = Date.now() + 600000;
        const payload = 'X'.repeat(300);

        for (let i = 0; i < 500; i++) {
            db.run('INSERT INTO posts (id, content, timestamp, userId, isDeleted, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
                [`exp-${i}`, `Expired content ${i} ${payload}`, Date.now(), 'alice', 0, expiredTime]);
        }
        for (let i = 0; i < 50; i++) {
            db.run('INSERT INTO posts (id, content, timestamp, userId, isDeleted, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
                [`valid-${i}`, `Valid content ${i} ${payload}`, Date.now(), 'alice', 0, validTime]);
        }

        const feedPath = sov.getModulePath('feed', `${testDate}.db`, 'public');
        const beforeBinary = db.export();
        await sov.getStorage().saveFile(feedPath, beforeBinary);
        db.close();

        const beforeSize = beforeBinary.byteLength;

        // Run cleanupExpired
        const deletedCount = await feed.cleanupExpired(testDate, true);
        expect(deletedCount).toBe(500);

        // File should be significantly smaller due to VACUUM
        const afterData = await sov.getStorage().getFile(feedPath);
        const afterSize = afterData!.byteLength;

        expect(afterSize).toBeLessThan(beforeSize);
        const reduction = (beforeSize - afterSize) / beforeSize;
        expect(reduction).toBeGreaterThanOrEqual(0.40);
    });

    test('SovereignS3nc.compactDatabases orchestrates compaction across registered modules', async () => {
        const spyMessaging = jest.spyOn(messaging, 'compactDatabase');
        const spyFeed = jest.spyOn(feed, 'compactDatabase');

        await sov.compactDatabases([testDate], true);

        expect(spyMessaging).toHaveBeenCalledWith(testDate, true);
        expect(spyFeed).toHaveBeenCalledWith(testDate, true, true);
    });
});
