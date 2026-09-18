import 'fake-indexeddb/auto';
import initSqlJs from 'sql.js';
import { SovereignS3nc } from '../src/SovereignS3nc';
import { Inspector } from '../src/utils/Inspector';
import { SovereignConfig } from '../src/types';
import { WebRTCRemoteAdapter } from '../src/adapters/WebRTCRemoteAdapter';

(global as any).initSqlJs = initSqlJs;
(globalThis as any).initSqlJs = initSqlJs;

const createConfig = (userId: string): SovereignConfig => ({
    offline: true,
    paths: {
        appId: 'inspect-test-app',
        userId,
        storeId: 'main'
    },
    password: 'password123',
    autoFollowDiscoveredUsers: false
});

describe('Browser DevTools & Storage Inspector (Inspector.ts & sov.getDebugSnapshot)', () => {
    let sov: SovereignS3nc;

    beforeEach(async () => {
        const id = 'user-' + Math.random().toString(36).substring(7);
        sov = new SovereignS3nc(createConfig(id));
        await sov.init();
    });

    describe('Inspector.buildPartitionTree', () => {
        it('hierarchically groups files into folder nodes and computes cumulative sizes', () => {
            const files = [
                { path: 'public/manifest.json', size: 100, timestamp: 1000 },
                { path: 'public/modules/feed/2026-09-18.db', size: 5000, timestamp: 2000 },
                { path: 'public/modules/feed/2026-09-17.db', size: 4000, timestamp: 3000 },
                { path: 'private/keys.json', size: 200, timestamp: 4000 },
                { path: 'public/blobs/abc123hash', size: 50000, timestamp: 5000 }
            ];

            const tree = Inspector.buildPartitionTree(files);

            expect(tree.length).toBe(2); // 'private' and 'public'
            const publicDir = tree.find(n => n.name === 'public');
            const privateDir = tree.find(n => n.name === 'private');

            expect(publicDir).toBeDefined();
            expect(publicDir?.type).toBe('directory');
            expect(publicDir?.size).toBe(100 + 5000 + 4000 + 50000);

            expect(privateDir).toBeDefined();
            expect(privateDir?.type).toBe('directory');
            expect(privateDir?.size).toBe(200);

            const modulesDir = publicDir?.children?.find(n => n.name === 'modules');
            expect(modulesDir).toBeDefined();
            const feedDir = modulesDir?.children?.find(n => n.name === 'feed');
            expect(feedDir).toBeDefined();
            expect(feedDir?.children?.length).toBe(2);
        });
    });

    describe('Inspector.computeDiffSummary', () => {
        it('detects SQLite databases and creates db preview', () => {
            const sqliteHeader = new TextEncoder().encode('SQLite format 3\0');
            const localData = new Uint8Array(100);
            localData.set(sqliteHeader, 0);

            const remoteData = new Uint8Array(120);
            remoteData.set(sqliteHeader, 0);

            const diff = Inspector.computeDiffSummary(localData, remoteData, 'feed/2026-09-18.db');
            expect(diff.diffType).toBe('sqlite_db');
            expect(diff.localTextSnippet).toContain('SQLite 3 Database');
            expect(diff.localTextSnippet).toContain('valid=true');
            expect(diff.remoteTextSnippet).toContain('valid=true');
        });

        it('detects JSON files and creates JSON text preview', () => {
            const localJson = JSON.stringify({ version: 1, title: 'Local Post' });
            const remoteJson = JSON.stringify({ version: 2, title: 'Remote Post Updated' });

            const localData = new TextEncoder().encode(localJson);
            const remoteData = new TextEncoder().encode(remoteJson);

            const diff = Inspector.computeDiffSummary(localData, remoteData, 'manifest.json');
            expect(diff.diffType).toBe('json');
            expect(diff.localTextSnippet).toContain('Local Post');
            expect(diff.remoteTextSnippet).toContain('Remote Post Updated');
        });

        it('handles non-UTF-8 binary data gracefully', () => {
            const localBinary = new Uint8Array([0xFF, 0xFE, 0xFD, 0xFC]);
            const remoteBinary = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD, 0xEE]);

            const diff = Inspector.computeDiffSummary(localBinary, remoteBinary, 'blobs/unknown.bin');
            expect(diff.diffType).toBe('binary');
            expect(diff.localTextSnippet).toContain('4 bytes');
            expect(diff.remoteTextSnippet).toContain('5 bytes');
        });
    });

    describe('sov.getDebugSnapshot', () => {
        it('captures full debug snapshot of storage, sync status, and mesh state', async () => {
            const storage = sov.getStorage();
            await storage.saveFile('public/test.txt', new TextEncoder().encode('Hello World'));
            await storage.saveFile('public/blobs/b1', new Uint8Array(1024));
            await storage.saveFile('private/secret.txt', new TextEncoder().encode('Secret Data'));
            await storage.setGenericRemoteHashCache('public/test.txt', 'etag-test-123');

            const snapshot = await sov.getDebugSnapshot();

            expect(snapshot).toBeDefined();
            expect(snapshot.appId).toBe('inspect-test-app');
            expect(snapshot.userId).toBe(sov.getConfig().paths.userId);

            // Storage tree & footprint
            expect(snapshot.storage.tree.length).toBeGreaterThan(0);
            expect(snapshot.storage.footprint.fileCount).toBeGreaterThanOrEqual(3);
            expect(snapshot.storage.footprint.totalBytes).toBeGreaterThanOrEqual(1024);
            expect(snapshot.storage.footprint.byCategory.blobs).toBe(1024);

            // Remote sync
            expect(snapshot.remoteSync.syncMode).toBe('offline');
            expect(snapshot.remoteSync.isSyncing).toBe(false);
            expect(snapshot.remoteSync.etagCache['public/test.txt']).toBe('etag-test-123');

            // Conflicts queue starts empty
            expect(snapshot.conflicts).toEqual([]);
        });

        it('captures unresolved conflicts with semantic diffs and clears them upon resolution', async () => {
            let conflictEmitted = false;
            let capturedConflictId = '';

            sov.on('conflict', (data: any) => {
                conflictEmitted = true;
                capturedConflictId = data.id;
            });

            // Trigger conflict by calling internal handleConflict
            const localData = new TextEncoder().encode(JSON.stringify({ note: 'My local edit' }));
            const remoteData = new TextEncoder().encode(JSON.stringify({ note: 'Remote incoming change' }));

            const conflictPromise = (sov as any).handleConflict('notes/conflict.json', localData, remoteData);

            expect(conflictEmitted).toBe(true);
            expect(capturedConflictId).toBeDefined();

            // Check debug snapshot shows unresolved conflict with semantic diff
            const snapshot = await sov.getDebugSnapshot();
            expect(snapshot.conflicts.length).toBe(1);
            expect(snapshot.conflicts[0].id).toBe(capturedConflictId);
            expect(snapshot.conflicts[0].path).toBe('notes/conflict.json');
            expect(snapshot.conflicts[0].preview.diffType).toBe('json');
            expect(snapshot.conflicts[0].preview.localTextSnippet).toContain('My local edit');
            expect(snapshot.conflicts[0].preview.remoteTextSnippet).toContain('Remote incoming change');

            // Resolve conflict
            sov.resolveConflict(capturedConflictId, 'local');
            const result = await conflictPromise;
            expect(result).toBe('local');

            // After resolution, conflict queue in snapshot is cleared
            const resolvedSnapshot = await sov.getDebugSnapshot();
            expect(resolvedSnapshot.conflicts.length).toBe(0);
        });

        it('gathers WebRTC mesh stats when WebRTCRemoteAdapter is active', async () => {
            const webrtc = new WebRTCRemoteAdapter('local-user', 'test-prefix');
            (sov as any).remote = webrtc;

            // Simulate mesh packets
            webrtc.packetsSent = 15;
            webrtc.packetsReceived = 28;
            webrtc.packetsDropped = 2;
            webrtc.peerLatencies.set('peer-bob', 42);

            const snapshot = await sov.getDebugSnapshot();
            expect(snapshot.mesh.enabled).toBe(true);
            expect(snapshot.mesh.peerId).toBe('local-user');
            expect(snapshot.mesh.stats.packetsSent).toBe(15);
            expect(snapshot.mesh.stats.packetsReceived).toBe(28);
            expect(snapshot.mesh.stats.packetsDropped).toBe(2);
        });
    });
});
