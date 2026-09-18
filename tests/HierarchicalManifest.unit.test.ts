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

class MockRemote implements IRemoteAdapter {
    public files = new Map<string, { data: Uint8Array; hash: string; etag: string }>();
    public uploadedPaths: string[] = [];

    resetUploadTracking() {
        this.uploadedPaths = [];
    }

    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        this.uploadedPaths.push(path);
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${h.substring(0, 16)}"`;
        this.files.set(path, { data, hash: h, etag });
        return etag;
    }

    async downloadFile(path: string, ifNoneMatch?: string): Promise<DownloadResult | null> {
        const entry = this.files.get(path);
        if (!entry) return null;
        if (ifNoneMatch && ifNoneMatch === entry.etag) {
            return { data: null, etag: entry.etag, notModified: true };
        }
        return { data: entry.data, etag: entry.etag, notModified: false };
    }

    async getFileHash(path: string): Promise<string | null> { return this.files.get(path)?.hash || null; }
    async getFileEtag(path: string): Promise<string | null> { return this.files.get(path)?.etag || null; }
    async canWrite(): Promise<boolean> { return true; }
    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path: string): Promise<void> { this.files.delete(path); }
}

describe('Hierarchical Merkle Tree Manifests (>10k Files Optimization)', () => {
    let mockRemote: MockRemote;
    let sov: SovereignS3nc;

    beforeEach(async () => {
        (global as any).indexedDB = new IDBFactory();
        mockRemote = new MockRemote();

        const config = {
            paths: { appId: 'merkle-app', userId: 'alice', storeId: 'main' },
            password: 'password123',
            debug: false
        };

        sov = new SovereignS3nc(config, mockRemote);
        await sov.init();
    });

    test('generateHierarchicalManifest partitions files into year and blob sub-manifests and computes Merkle root', async () => {
        const storage = sov.getStorage();

        // Seed 2025 date partition
        await storage.saveFile('public/2025-06-15.db', new Uint8Array([1, 2, 3]));
        // Seed 2026 date partitions across modules and core
        await storage.saveFile('public/2026-01-10.db', new Uint8Array([4, 5, 6]));
        await storage.saveFile('public/modules/feed/2026-02-20.db', new Uint8Array([7, 8, 9]));
        await storage.saveFile('public/modules/messaging/dms/bob/2026-03-01.db', new Uint8Array([10, 11, 12]));
        // Seed blobs
        await storage.saveFile('blobs/avatar-blob-123', new Uint8Array([20, 21, 22]));
        await storage.saveFile('blobs/image-blob-456', new Uint8Array([30, 31, 32]));

        const manifest = await sov.generateManifest();

        // Validate top-level Merkle root exists
        expect(manifest.merkleRoot).toBeDefined();
        expect(typeof manifest.merkleRoot).toBe('string');
        expect(manifest.merkleRoot!.length).toBe(64); // SHA-256 hex string

        // Validate subManifests map
        expect(manifest.subManifests).toBeDefined();
        expect(manifest.subManifests!['2025']).toBeDefined();
        expect(manifest.subManifests!['2026']).toBeDefined();
        expect(manifest.subManifests!['blobs']).toBeDefined();

        expect(manifest.subManifests!['2025'].path).toBe('manifests/2025.json');
        expect(manifest.subManifests!['2026'].path).toBe('manifests/2026.json');
        expect(manifest.subManifests!['blobs'].path).toBe('manifests/blobs.json');

        expect(manifest.subManifests!['2025'].count).toBe(1);
        expect(manifest.subManifests!['2026'].count).toBe(3);
        expect(manifest.subManifests!['blobs'].count).toBe(2);

        // Validate backward compatibility: top-level modules and dms arrays are preserved
        expect(manifest.modules['core']).toContain('2025-06-15');
        expect(manifest.modules['core']).toContain('2026-01-10');
        expect(manifest.modules['feed']).toContain('2026-02-20');
        expect(manifest.dms['bob']).toContain('2026-03-01');
    });

    test('syncManifest uploads sub-manifests and top-level manifest incrementally', async () => {
        const storage = sov.getStorage();
        await storage.saveFile('public/2025-01-01.db', new Uint8Array([1, 1, 1]));
        await storage.saveFile('public/2026-01-01.db', new Uint8Array([2, 2, 2]));

        // First sync
        mockRemote.resetUploadTracking();
        await sov.syncManifest();

        expect(mockRemote.uploadedPaths).toContain('manifests/2025.json');
        expect(mockRemote.uploadedPaths).toContain('manifests/2026.json');
        expect(mockRemote.uploadedPaths).toContain('manifest.json');

        // Capture 2025 submanifest hash
        const initial2025Entry = mockRemote.files.get('manifests/2025.json');
        const initial2026Entry = mockRemote.files.get('manifests/2026.json');
        const initialManifestEntry = mockRemote.files.get('manifest.json');
        expect(initial2025Entry).toBeDefined();

        // Modify a 2026 file only
        await storage.saveFile('public/2026-02-02.db', new Uint8Array([3, 3, 3]));

        // Second sync
        mockRemote.resetUploadTracking();
        await sov.syncManifest();

        // 2025 submanifest should NOT be re-uploaded (incremental optimization!)
        expect(mockRemote.uploadedPaths).not.toContain('manifests/2025.json');
        // 2026 submanifest and top-level manifest SHOULD be re-uploaded
        expect(mockRemote.uploadedPaths).toContain('manifests/2026.json');
        expect(mockRemote.uploadedPaths).toContain('manifest.json');

        const newManifest: SovereignManifest = JSON.parse(new TextDecoder().decode(mockRemote.files.get('manifest.json')!.data));
        const oldManifest: SovereignManifest = JSON.parse(new TextDecoder().decode(initialManifestEntry!.data));

        // 2025 hash should match, 2026 hash and Merkle root should differ
        expect(newManifest.subManifests!['2025'].hash).toBe(oldManifest.subManifests!['2025'].hash);
        expect(newManifest.subManifests!['2026'].hash).not.toBe(oldManifest.subManifests!['2026'].hash);
        expect(newManifest.merkleRoot).not.toBe(oldManifest.merkleRoot);
    });

    test('resolveFullManifest reassembles sub-manifests into complete file map', async () => {
        const storage = sov.getStorage();
        await storage.saveFile('public/2025-05-05.db', new Uint8Array([10, 20]));
        await storage.saveFile('public/2026-06-06.db', new Uint8Array([30, 40]));
        await sov.syncManifest();

        const rootManifest = await sov.generateManifest();
        const resolved = await sov.resolveFullManifest('alice', rootManifest);

        expect(resolved.files!['public/2025-05-05.db']).toBeDefined();
        expect(resolved.files!['public/2026-06-06.db']).toBeDefined();
    });

    test('Backward compatibility: seamlessly handles legacy flat manifest without subManifests or merkleRoot', async () => {
        const legacyManifest: SovereignManifest = {
            updatedAt: 1600000000000,
            userId: 'legacy_bob',
            modules: {
                core: ['2024-01-01', '2024-01-02'],
                feed: ['2024-01-01']
            },
            dms: {
                alice: ['2024-01-01']
            },
            groups: {},
            blobs: ['blobs/old_pic'],
            files: {
                'public/2024-01-01.db': { hash: 'hash1', updatedAt: 1600000000000 },
                'public/modules/feed/2024-01-01.db': { hash: 'hash2', updatedAt: 1600000000000 }
            }
        };

        // No subManifests or merkleRoot defined on legacyManifest
        expect(legacyManifest.subManifests).toBeUndefined();
        expect(legacyManifest.merkleRoot).toBeUndefined();

        const resolved = await sov.resolveFullManifest('legacy_bob', legacyManifest);

        // Preserves all files and partitions intact
        expect(resolved.files!['public/2024-01-01.db']).toBeDefined();
        expect(resolved.modules['feed']).toEqual(['2024-01-01']);
        expect(resolved.dms['alice']).toEqual(['2024-01-01']);
    });
});
