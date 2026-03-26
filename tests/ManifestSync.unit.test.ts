import { SovereignS3nc } from '../src/SovereignS3nc';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import { SovereignConfig } from '../src/types';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import { Logger, LogLevel } from '../src/utils/Logger';

// --- Polyfills ---
globalThis.indexedDB = new IDBFactory();
(globalThis as any).crypto = crypto.webcrypto;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string, etag: string}> = new Map();
    callCounts: Record<string, number> = {
        uploadFile: 0,
        downloadFile: 0,
        getFileHash: 0,
        getFileEtag: 0
    };

    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        this.callCounts.uploadFile++;
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: h, etag });
        return etag;
    }

    async downloadFile(path: string, ifNoneMatch?: string): Promise<any | null> {
        this.callCounts.downloadFile++;
        const entry = this.files.get(path);
        if (!entry) return null;
        if (ifNoneMatch && ifNoneMatch === entry.etag) {
            return { data: null, etag: entry.etag, notModified: true };
        }
        return { data: entry.data, etag: entry.etag };
    }

    async getFileHash(path: string): Promise<string | null> {
        this.callCounts.getFileHash++;
        return this.files.get(path)?.hash || null;
    }

    async getFileEtag(path: string): Promise<string | null> {
        this.callCounts.getFileEtag++;
        return this.files.get(path)?.etag || null;
    }

    async canWrite(path: string): Promise<boolean> {
        return true;
    }

    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }

    async deleteFile(path: string): Promise<void> {
        this.files.delete(path);
    }
}

describe('Manifest Sync Unit Tests', () => {
    let mockRemote: MockRemote;
    let config: SovereignConfig;

    beforeEach(() => {
        mockRemote = new MockRemote();
        (global as any).indexedDB = new IDBFactory();
        config = {
            paths: { appId: 'test-app', userId: 'alice', storeId: 'main' },
            password: 'password123',
            debug: false
        };
        Logger.setLevel(LogLevel.NONE);
    });

    test('should upload manifest after sync', async () => {
        const sov = new SovereignS3nc(config, mockRemote);
        await sov.init();
        
        const today = SovereignS3nc.getDateStr(new Date());
        const dummyData = new Uint8Array([1, 2, 3]);
        await (sov as any).storage.saveDailyDb(today, 'public', dummyData);
        await (sov as any).storage.saveFile('public/blobs/testblob', new Uint8Array([4, 5, 6]));
        
        await sov.sync();
        
        expect(mockRemote.files.has('manifest.json')).toBe(true);
        const manifestData = mockRemote.files.get('manifest.json')!.data;
        const manifest = JSON.parse(new TextDecoder().decode(manifestData));
        
        expect(manifest.files[`public/${today}.db`]).toBeDefined();
        expect(manifest.files[`public/blobs/testblob`]).toBeDefined();
    });

    test('should use remote manifest to skip getFileHash on subsequent sync', async () => {
        const sov = new SovereignS3nc(config, mockRemote);
        await sov.init();
        
        const today = SovereignS3nc.getDateStr(new Date());
        await (sov as any).storage.saveDailyDb(today, 'public', new Uint8Array([1, 2, 3]));
        await sov.sync();
        
        const initialHashCalls = mockRemote.callCounts.getFileHash;
        
        // Sync again - should use manifest and not call getFileHash for existing files
        await sov.sync();
        
        // It might call getFileHash for manifest.json itself or other system files if not in manifest
        // but for public/${today}.db it should be skipped.
        // Let's check the delta.
        expect(mockRemote.callCounts.getFileHash).toBe(initialHashCalls); 
    });

    test('should download missing files identified in manifest without per-file list/head', async () => {
        // 1. Setup remote state with a manifest and some files
        const sov1 = new SovereignS3nc(config, mockRemote);
        await sov1.init();
        const today = SovereignS3nc.getDateStr(new Date());
        await (sov1 as any).storage.saveDailyDb(today, 'public', new Uint8Array([1, 2, 3]));
        await (sov1 as any).storage.saveFile('public/blobs/extra', new Uint8Array([7, 8, 9]));
        await sov1.sync();

        // 2. Clear local storage
        (global as any).indexedDB = new IDBFactory();
        mockRemote.callCounts.getFileHash = 0;
        mockRemote.callCounts.downloadFile = 0;

        // 3. Sync with new instance
        const sov2 = new SovereignS3nc(config, mockRemote);
        await sov2.init();
        await sov2.sync();

        // Should have downloaded the files
        const data1 = await (sov2 as any).storage.getDailyDb(today, 'public');
        const data2 = await (sov2 as any).storage.getFile('public/blobs/extra');
        expect(data1).toEqual(new Uint8Array([1, 2, 3]));
        expect(data2).toEqual(new Uint8Array([7, 8, 9]));

        // Should have downloaded manifest.json
        // Should NOT have called getFileHash for the downloaded files because manifest was used
        // Wait, syncDay might call it if it doesn't trust the manifest? No, I updated it to use it.
        expect(mockRemote.callCounts.getFileHash).toBe(0);
    });

    test('should handle backward compatibility (no remote manifest)', async () => {
        const sov = new SovereignS3nc(config, mockRemote);
        await sov.init();
        
        // Upload something without a manifest
        const today = SovereignS3nc.getDateStr(new Date());
        await (sov as any).storage.saveDailyDb(today, 'public', new Uint8Array([1, 2, 3]));
        
        // Remove manifest if it was somehow created
        mockRemote.files.delete('manifest.json');
        mockRemote.callCounts.getFileHash = 0;

        await sov.sync();
        
        // Should have called getFileHash because manifest was missing
        expect(mockRemote.callCounts.getFileHash).toBeGreaterThan(0);
        expect(mockRemote.files.has('manifest.json')).toBe(true);
    });
});
