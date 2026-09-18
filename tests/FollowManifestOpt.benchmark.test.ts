import { SovereignS3nc } from '../src/SovereignS3nc';
import { IRemoteAdapter, DownloadResult } from '../src/interfaces/IRemoteAdapter';
import { IDBFactory } from 'fake-indexeddb';
import crypto from 'crypto';
import initSqlJs from 'sql.js';
import { SovereignManifest } from '../src/types';

// Polyfills
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

interface RemoteFileEntry {
    data: Uint8Array;
    hash: string;
    etag: string;
}

class StatsTracker {
    downloadCalls = 0;
    uploadCalls = 0;
    notModifiedResponses = 0;
    fullDownloadResponses = 0;
    requestsByUser = new Map<string, number>();

    reset() {
        this.downloadCalls = 0;
        this.uploadCalls = 0;
        this.notModifiedResponses = 0;
        this.fullDownloadResponses = 0;
        this.requestsByUser.clear();
    }

    record(userId: string) {
        const count = this.requestsByUser.get(userId) || 0;
        this.requestsByUser.set(userId, count + 1);
    }
}

class ScopedMockRemote implements IRemoteAdapter {
    constructor(
        public userId: string,
        private sharedStorage: Map<string, RemoteFileEntry>,
        private stats: StatsTracker
    ) {}

    private toFullPath(path: string): string {
        return `${this.userId}/${path}`;
    }

    async uploadFile(path: string, data: Uint8Array): Promise<string | null> {
        this.stats.uploadCalls++;
        this.stats.record(this.userId);
        const fullPath = this.toFullPath(path);
        const hash = crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${hash.substring(0, 16)}"`;
        this.sharedStorage.set(fullPath, { data, hash, etag });
        return etag;
    }

    async downloadFile(path: string, ifNoneMatch?: string): Promise<DownloadResult | null> {
        this.stats.downloadCalls++;
        this.stats.record(this.userId);
        const fullPath = this.toFullPath(path);
        const entry = this.sharedStorage.get(fullPath);
        if (!entry) return null;

        if (ifNoneMatch && ifNoneMatch === entry.etag) {
            this.stats.notModifiedResponses++;
            return {
                data: null,
                etag: entry.etag,
                notModified: true
            };
        }

        this.stats.fullDownloadResponses++;
        return {
            data: entry.data,
            etag: entry.etag,
            notModified: false
        };
    }

    async getFileHash(path: string): Promise<string | null> {
        return this.sharedStorage.get(this.toFullPath(path))?.hash || null;
    }

    async getFileEtag(path: string): Promise<string | null> {
        return this.sharedStorage.get(this.toFullPath(path))?.etag || null;
    }

    async canWrite(): Promise<boolean> {
        return true;
    }

    async listFiles(prefix: string): Promise<string[]> {
        const fullPrefix = this.toFullPath(prefix);
        return Array.from(this.sharedStorage.keys())
            .filter(k => k.startsWith(fullPrefix))
            .map(k => k.substring(this.userId.length + 1));
    }

    async deleteFile(path: string): Promise<void> {
        this.sharedStorage.delete(this.toFullPath(path));
    }
}

describe('Aggregated Follow-Manifest Diffing & ETag Request Optimization Benchmark', () => {
    let sharedStorage: Map<string, RemoteFileEntry>;
    let statsTracker: StatsTracker;
    let aliceSov: SovereignS3nc;
    const NUM_FOLLOWED_USERS = 20;
    const DATES = ['2026-09-16', '2026-09-17', '2026-09-18'];

    beforeEach(async () => {
        (global as any).indexedDB = new IDBFactory();
        sharedStorage = new Map<string, RemoteFileEntry>();
        statsTracker = new StatsTracker();

        const SQL = await initSqlJs();
        const dummyDb = new SQL.Database();
        dummyDb.exec(`CREATE TABLE posts (id TEXT PRIMARY KEY, content TEXT, timestamp INTEGER);`);
        dummyDb.run(`INSERT INTO posts VALUES ('p1', 'hello world', 123456789)`);
        const dummyBinary = dummyDb.export();
        dummyDb.close();

        // Seed 20 followed users with manifests and partitioned databases in mock remote
        for (let i = 0; i < NUM_FOLLOWED_USERS; i++) {
            const uid = `user_${i}`;
            const userRemote = new ScopedMockRemote(uid, sharedStorage, statsTracker);

            const manifest: SovereignManifest = {
                updatedAt: Date.now(),
                userId: uid,
                modules: {
                    feed: [...DATES]
                },
                dms: {},
                groups: {},
                blobs: [],
                files: {}
            };

            for (const d of DATES) {
                const dbPath = `public/modules/feed/${d}.db`;
                await userRemote.uploadFile(dbPath, dummyBinary);
            }

            const manifestData = new TextEncoder().encode(JSON.stringify(manifest));
            await userRemote.uploadFile('manifest.json', manifestData);
        }

        // Initialize Alice
        const config = {
            paths: { appId: 'feed-benchmark', userId: 'alice', storeId: 'main' },
            password: 'alice-secure-password',
            followManifestCacheTtlMs: 60000,
            debug: false
        };

        const remoteFactory = (uid: string) => new ScopedMockRemote(uid, sharedStorage, statsTracker);
        const aliceRemote = new ScopedMockRemote('alice', sharedStorage, statsTracker);

        aliceSov = new SovereignS3nc(config, aliceRemote, remoteFactory);
        await aliceSov.init();

        // Follow all 20 users
        for (let i = 0; i < NUM_FOLLOWED_USERS; i++) {
            await aliceSov.follow(`user_${i}`, `pk_${i}`);
        }

        statsTracker.reset();
    });

    test('Benchmark: Request count reduction when syncing 20 followed users across multiple intervals', async () => {
        // --- Cycle 1: Initial Cold Sync ---
        // Alice has never synced with these 20 users.
        // Must download manifests and all partition files.
        await aliceSov.sync();
        const coldDownloads = statsTracker.downloadCalls;
        const coldNotModified = statsTracker.notModifiedResponses;

        // Verify all 20 users have their data locally
        for (let i = 0; i < NUM_FOLLOWED_USERS; i++) {
            const localFile = await aliceSov.getStorage().getFile(`followed/user_${i}/modules/feed/${DATES[0]}.db`);
            expect(localFile).not.toBeNull();
        }

        // Baseline: 20 manifests + 60 date partitions (20 * 3) = at least 80 requests
        expect(coldDownloads).toBeGreaterThanOrEqual(80);
        expect(coldNotModified).toBe(0);

        // --- Cycle 2: Immediate Auto-Sync (within TTL cache) ---
        // Short interval (e.g. 5s-30s). Follow-manifest TTL is 60s.
        // Manifest is served from TTL memory cache and detected as unchanged.
        statsTracker.reset();
        await aliceSov.sync();
        const ttlDownloads = statsTracker.downloadCalls;

        // Zero requests made for any followed user
        let followedUserRequests = 0;
        for (let i = 0; i < NUM_FOLLOWED_USERS; i++) {
            followedUserRequests += statsTracker.requestsByUser.get(`user_${i}`) || 0;
        }

        expect(followedUserRequests).toBe(0);
        // Overall downloads should be only Alice's own sync (<= 8)
        expect(ttlDownloads).toBeLessThanOrEqual(8);

        // --- Cycle 3: Auto-Sync after TTL expiry with 304 Not Modified ---
        // TTL expires (simulated via expireFollowManifestCache), but remote users have made no changes.
        // S3 conditional GET returns 304 Not Modified for manifest.json.
        // Diffing recognizes ETag unchanged, skipping all 60 date partitions!
        aliceSov.expireFollowManifestCache();
        statsTracker.reset();

        await aliceSov.sync();
        const expiredTtlDownloads = statsTracker.downloadCalls;
        const notModifiedCount = statsTracker.notModifiedResponses;

        // Followed users manifest requests: exactly 20 requests (1 per user)
        // None of the 60 date files should be queried!
        expect(notModifiedCount).toBe(NUM_FOLLOWED_USERS);
        expect(expiredTtlDownloads).toBeLessThanOrEqual(NUM_FOLLOWED_USERS + 8);

        // Calculate and verify request reduction percentage
        const savedRequests = coldDownloads - expiredTtlDownloads;
        const reductionPercent = (savedRequests / coldDownloads) * 100;
        expect(reductionPercent).toBeGreaterThanOrEqual(65); // >= 65% reduction in requests!

        // --- Cycle 4: Selective Invalidation ---
        // user_5 publishes a new post on a new day.
        const SQL = await initSqlJs();
        const dummyDb = new SQL.Database();
        dummyDb.exec(`CREATE TABLE posts (id TEXT PRIMARY KEY, content TEXT, timestamp INTEGER);`);
        dummyDb.run(`INSERT INTO posts VALUES ('p_new', 'brand new update', 999999999)`);
        const newBinary = dummyDb.export();
        dummyDb.close();

        const updatedDate = '2026-09-19';
        const user5Remote = new ScopedMockRemote('user_5', sharedStorage, statsTracker);
        await user5Remote.uploadFile(`public/modules/feed/${updatedDate}.db`, newBinary);

        const updatedManifest: SovereignManifest = {
            updatedAt: Date.now() + 1000,
            userId: 'user_5',
            modules: {
                feed: [...DATES, updatedDate]
            },
            dms: {},
            groups: {},
            blobs: [],
            files: {}
        };
        await user5Remote.uploadFile('manifest.json', new TextEncoder().encode(JSON.stringify(updatedManifest)));

        // Run sync after TTL expiry
        aliceSov.expireFollowManifestCache();
        statsTracker.reset();
        await aliceSov.sync();

        // 19 other users return 304 Not Modified on manifest (+ 3 on user_5's unchanged past dates)
        expect(statsTracker.notModifiedResponses).toBeGreaterThanOrEqual(19);

        // Verify user_5's new date partition was downloaded locally
        const downloadedNew = await aliceSov.getStorage().getFile(`followed/user_5/modules/feed/${updatedDate}.db`);
        expect(downloadedNew).not.toBeNull();
    });

    test('clearFollowManifestCache should target specific user or all users', async () => {
        await aliceSov.sync();

        // Both user_0 and user_1 should be cached
        expect(aliceSov.getFollowManifestCache('user_0')).toBeDefined();
        expect(aliceSov.getFollowManifestCache('user_1')).toBeDefined();

        // Clear only user_0
        aliceSov.clearFollowManifestCache('user_0');
        expect(aliceSov.getFollowManifestCache('user_0')).toBeUndefined();
        expect(aliceSov.getFollowManifestCache('user_1')).toBeDefined();

        // Clear all
        aliceSov.clearFollowManifestCache();
        expect(aliceSov.getFollowManifestCache('user_1')).toBeUndefined();
    });
});
