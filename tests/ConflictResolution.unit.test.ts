
import { SovereignS3nc } from '../src/SovereignS3nc';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import { SovereignConfig } from '../src/types';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';

// --- Polyfills ---
(globalThis as any).indexedDB = new IDBFactory();
(globalThis as any).crypto = crypto.webcrypto;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string, etag: string}> = new Map();

    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: h, etag });
        return etag;
    }

    async downloadFile(path: string, ifNoneMatch?: string): Promise<any | null> {
        const entry = this.files.get(path);
        if (!entry) return null;
        if (ifNoneMatch && ifNoneMatch === entry.etag) {
            return { data: null, etag: entry.etag, notModified: true };
        }
        return { data: entry.data, etag: entry.etag };
    }

    async getFileHash(path: string): Promise<string | null> {
        return this.files.get(path)?.hash || null;
    }

    async getFileEtag(path: string): Promise<string | null> {
        return this.files.get(path)?.etag || null;
    }

    async canWrite(path: string): Promise<boolean> { return true; }
    async listFiles(prefix: string): Promise<string[]> { return []; }
}

describe('Conflict Resolution Unit Tests', () => {
    let mockRemote: MockRemote;
    let config: SovereignConfig;
    let sov: SovereignS3nc;
    const appId = 'conflict-app';
    const userId = 'alice';

    beforeEach(async () => {
        mockRemote = new MockRemote();
        (globalThis as any).indexedDB = new IDBFactory();
        config = {
            paths: { appId, userId, storeId: 'main' },
            password: 'password123',
            debug: false
        };
        sov = new SovereignS3nc(config, mockRemote);
        (sov as any).storage = new IndexedDBStorage(`db_${appId}_${userId}`);
        await sov.init();
    });

    test('Sync detects conflict and resolves with "remote" choice', async () => {
        const dateStr = SovereignS3nc.getDateStr(new Date());
        const filePath = `public/${dateStr}.db`;
        const initialData = new TextEncoder().encode('initial data');
        
        // 1. Establish initial state on both local and remote
        await sov.getStorage().saveDailyDb(dateStr, 'public', initialData);
        await mockRemote.uploadFile(filePath, initialData);
        
        // We need to set the sync hash cache so the system thinks it was once in sync
        const hash = crypto.createHash('sha256').update(initialData).digest('hex');
        await sov.getStorage().setGenericRemoteHashCache(`sync_hash:${filePath}`, hash);
        
        // 2. Change both local and remote differently
        const localData = new TextEncoder().encode('local change');
        const remoteData = new TextEncoder().encode('remote change');
        
        await sov.getStorage().saveDailyDb(dateStr, 'public', localData);
        await mockRemote.uploadFile(filePath, remoteData);

        // 3. Listen for conflict event
        let conflictDetected = false;
        sov.on('conflict', (event) => {
            conflictDetected = true;
            expect(event.path).toBe(filePath);
            // Resolve with remote
            sov.resolveConflict(event.id, 'remote');
        });

        // 4. Trigger sync
        await sov.sync();

        expect(conflictDetected).toBe(true);
        
        // 5. Verify local storage matches remote change
        const finalLocal = await sov.getStorage().getDailyDb(dateStr, 'public');
        expect(finalLocal).not.toBeNull();
        expect(new TextDecoder().decode(finalLocal!)).toBe('remote change');
    });

    test('Sync detects conflict and resolves with "local" choice (overwrites remote)', async () => {
        const dateStr = SovereignS3nc.getDateStr(new Date());
        const filePath = `public/${dateStr}.db`;
        const initialData = new TextEncoder().encode('initial data');
        
        await sov.getStorage().saveDailyDb(dateStr, 'public', initialData);
        await mockRemote.uploadFile(filePath, initialData);
        const hash = crypto.createHash('sha256').update(initialData).digest('hex');
        await sov.getStorage().setGenericRemoteHashCache(`sync_hash:${filePath}`, hash);
        
        const localData = new TextEncoder().encode('local change');
        const remoteData = new TextEncoder().encode('remote change');
        
        await sov.getStorage().saveDailyDb(dateStr, 'public', localData);
        await mockRemote.uploadFile(filePath, remoteData);

        sov.on('conflict', (event) => {
            sov.resolveConflict(event.id, 'local');
        });

        await sov.sync();

        // Verify local storage is still local change
        const finalLocal = await sov.getStorage().getDailyDb(dateStr, 'public');
        expect(finalLocal).not.toBeNull();
        expect(new TextDecoder().decode(finalLocal!)).toBe('local change');

        // Verify remote was updated to local change
        const finalRemote = await mockRemote.downloadFile(filePath);
        expect(new TextDecoder().decode(finalRemote.data)).toBe('local change');
    });
});
