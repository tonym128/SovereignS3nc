
import { SovereignS3nc } from '../src/SovereignS3nc';
import { SQLiteNodeStorage } from '../src/adapters/SQLiteNodeStorage';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import { FeedModule } from '../src/modules/Feed';
import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';

// --- Polyfills ---
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;

/**
 * A simple in-memory remote for shared sync between instances.
 */
class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string, etag: string}> = new Map();

    async uploadFile(filePath: string, data: Uint8Array, hash?: string): Promise<string | null> {
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(filePath, { data, hash: h, etag });
        return etag;
    }

    async downloadFile(filePath: string, ifNoneMatch?: string): Promise<any | null> {
        const entry = this.files.get(filePath);
        if (!entry) return null;
        if (ifNoneMatch && ifNoneMatch === entry.etag) {
            return { data: null, etag: entry.etag, notModified: true };
        }
        return { data: entry.data, etag: entry.etag };
    }

    async getFileHash(filePath: string): Promise<string | null> {
        return this.files.get(filePath)?.hash || null;
    }

    async getFileEtag(filePath: string): Promise<string | null> {
        return this.files.get(filePath)?.etag || null;
    }

    async canWrite(filePath: string): Promise<boolean> {
        return true;
    }

    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }

    async deleteFile(filePath: string): Promise<void> {
        this.files.delete(filePath);
    }
}

async function runAudit() {
    const TEMP_DIR = path.join(__dirname, '../temp_perf_audit');
    if (await fs.pathExists(TEMP_DIR)) {
        await fs.remove(TEMP_DIR);
    }
    await fs.ensureDir(TEMP_DIR);

    const remote = new MockRemote();
    const remoteFactory = (userId: string) => remote;

    const appId = 'perf-audit-app';
    const password = 'secure-password';

    // Ensure sql.js is available for modules
    // @ts-ignore
    globalThis.initSqlJs = require('sql.js');

    let peakMemory = 0;
    const updatePeakMemory = () => {
        const mem = process.memoryUsage().rss;
        if (mem > peakMemory) peakMemory = mem;
    };

    const interval = setInterval(updatePeakMemory, 100);

    console.log('--- Starting Performance Audit ---');

    // 1. Initialize Alice (Producer)
    const aliceDir = path.join(TEMP_DIR, 'alice');
    const aliceStorage = new SQLiteNodeStorage(path.join(aliceDir, 'db.sqlite'));
    const alice = new SovereignS3nc({
        paths: { appId, userId: 'alice', storeId: 'main' },
        password,
        debug: false
    }, remote, remoteFactory, undefined, aliceStorage);
    await alice.init();
    const aliceFeed = new FeedModule(alice);

    // 2. Add 1000 items
    console.log('Adding 1000 items to Alice...');
    const startTime = Date.now();
    
    // Instead of calling aliceFeed.post 1000 times (which is very slow), 
    // we'll manually insert into the DB to simulate large data.
    const date = new Date().toISOString().split('T')[0];
    const type = 'public';
    // @ts-ignore
    const initSqlJs = (globalThis as any).initSqlJs;
    const sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});
    const db = new sqliteInstance.Database();
    
    // Apply schema
    alice.registerModule({
        name: 'feed',
        tables: [
            {
                name: 'posts',
                schema: `
                    id TEXT PRIMARY KEY,
                    content TEXT,
                    timestamp INTEGER,
                    userId TEXT,
                    image TEXT,
                    parentId TEXT,
                    parentUserId TEXT,
                    isEdited INTEGER DEFAULT 0,
                    isDeleted INTEGER DEFAULT 0,
                    type TEXT DEFAULT 'text'
                `
            }
        ],
        migrations: []
    });
    alice.applyModuleSchema(db, 'feed');

    db.run('BEGIN TRANSACTION');
    for (let i = 0; i < 1000; i++) {
        const id = `post-${i}`;
        const content = `Performance audit post content ${i} `.repeat(5);
        const timestamp = Date.now() - (1000 - i) * 1000;
        db.run('INSERT INTO posts (id, content, timestamp, userId, isEdited, isDeleted) VALUES (?, ?, ?, ?, 0, 0)',
            [id, content, timestamp, 'alice']);
    }
    db.run('COMMIT');

    const binary = db.export();
    const dbPath = alice.getModulePath('feed', `${date}.db`, type);
    await alice.getStorage().saveFile(dbPath, binary);
    db.close();

    // Alice syncs to remote
    console.log('Alice syncing 1000 items to remote...');
    await alice.sync();
    const aliceSyncDone = Date.now();
    console.log(`Alice sync time: ${aliceSyncDone - startTime}ms`);

    // 3. Initialize Bob (Consumer)
    const bobDir = path.join(TEMP_DIR, 'bob');
    const bobStorage = new SQLiteNodeStorage(path.join(bobDir, 'db.sqlite'));
    const bob = new SovereignS3nc({
        paths: { appId, userId: 'bob', storeId: 'main' },
        password,
        debug: false
    }, remote, remoteFactory, undefined, bobStorage);
    await bob.init();
    
    // Bob follows Alice
    await bob.getStorage().followUser('alice', 'null', alice.getConfig().publicEncryptionKey!);

    // 4. Measure Bob sync time
    console.log('Bob syncing 1000 items from Alice...');
    const bobStartTime = Date.now();
    await bob.sync();
    const bobEndTime = Date.now();
    const bobSyncDuration = bobEndTime - bobStartTime;

    clearInterval(interval);
    updatePeakMemory();

    // 5. Check storage sizes
    const aliceDbSize = (await fs.stat(path.join(aliceDir, 'db.sqlite'))).size;
    const bobDbSize = (await fs.stat(path.join(bobDir, 'db.sqlite'))).size;

    console.log('\n--- Performance Audit Summary ---');
    console.log(`Time to sync 1000 items (Bob): ${bobSyncDuration}ms`);
    console.log(`Peak memory usage: ${(peakMemory / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Alice SQLite storage size: ${(aliceDbSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Bob SQLite storage size: ${(bobDbSize / 1024 / 1024).toFixed(2)} MB`);
    console.log('---------------------------------\n');

    // Clean up
    await fs.remove(TEMP_DIR);
}

runAudit().catch(err => {
    console.error('Audit failed:', err);
    process.exit(1);
});
