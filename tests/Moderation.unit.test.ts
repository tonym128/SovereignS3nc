
import { SovereignS3nc } from '../src/SovereignS3nc';
import { ModerationModule, Report } from '../src/modules/Moderation';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import * as nacl from 'tweetnacl';

// --- Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string, etag: string, metadata?: any}> = new Map();
    shouldFailUpload: boolean = false;

    async uploadFile(path: string, data: Uint8Array, hash?: string, metadata?: any): Promise<string | null> {
        if (this.shouldFailUpload) throw new Error('Permission Denied');
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: h, etag, metadata });
        return etag;
    }
    async downloadFile(path: string): Promise<any | null> {
        const entry = this.files.get(path);
        return entry ? { data: entry.data, etag: entry.etag } : null;
    }
    async getFileHash(path: string): Promise<string | null> { return this.files.get(path)?.hash || null; }
    async getFileEtag(path: string): Promise<string | null> { return this.files.get(path)?.etag || null; }
    async canWrite(path: string): Promise<boolean> { return !this.shouldFailUpload; }
    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path: string): Promise<void> { this.files.delete(path); }
    async getFileMetadata(path: string, key: string): Promise<string | null> {
        return this.files.get(path)?.metadata?.[key] || null;
    }
}

describe('ModerationModule Unit Tests', () => {
    let sov: SovereignS3nc;
    let moderation: ModerationModule;
    let mockAdminRemote: MockRemote;
    let mockRootRemote: MockRemote;
    let mockGlobalRemote: MockRemote;

    beforeEach(async () => {
        (global as any).indexedDB = new IDBFactory();
        mockAdminRemote = new MockRemote();
        mockRootRemote = new MockRemote();
        mockGlobalRemote = new MockRemote();

        const config = {
            paths: { appId: 'mod-test', userId: 'admin-alice', storeId: 'main' },
            password: 'admin-password',
            debug: false
        };
        sov = new SovereignS3nc(config);
        await sov.init();
        
        // Inject remotes
        (sov as any).adminRemote = mockAdminRemote;
        (sov as any).rootRemote = mockRootRemote;
        (sov as any).globalRemote = mockGlobalRemote;

        moderation = new ModerationModule(sov);
    });

    describe('Admin Detection', () => {
        test('should return true if user is admin (can write to admin remote)', async () => {
            const isAdmin = await moderation.isAdmin();
            expect(isAdmin).toBe(true);
        });

        test('should return false if user is not admin (cannot write to admin remote)', async () => {
            mockAdminRemote.shouldFailUpload = true;
            const isAdmin = await moderation.isAdmin();
            expect(isAdmin).toBe(false);
        });
    });

    describe('Reporting', () => {
        test('should publish admin public key', async () => {
            await moderation.publishAdminKey();
            const result = await mockAdminRemote.downloadFile('public_key.json');
            expect(result).toBeDefined();
            const data = JSON.parse(new TextDecoder().decode(result.data));
            expect(data.publicKey).toBe(sov.getConfig().publicEncryptionKey);
        });

        test('should submit a report', async () => {
            // Setup admin key
            const adminPk = sov.getConfig().publicEncryptionKey;
            await mockAdminRemote.uploadFile('public_key.json', new TextEncoder().encode(JSON.stringify({ publicKey: adminPk })));

            await moderation.reportContent('bad-user', 'post-1', 'post', 'Spam');
            
            const files = await mockAdminRemote.listFiles('reports/');
            expect(files.length).toBe(1);
            expect(files[0]).toContain('report-');
        });

        test('should fetch and decrypt reports', async () => {
            // Setup admin key
            const adminPk = sov.getConfig().publicEncryptionKey!;
            await mockAdminRemote.uploadFile('public_key.json', new TextEncoder().encode(JSON.stringify({ publicKey: adminPk })));

            // Submit a report
            await moderation.reportContent('bad-user', 'post-1', 'post', 'Harassment');

            // Fetch reports
            const reports = await moderation.getReports();
            expect(reports.length).toBe(1);
            expect(reports[0].targetUserId).toBe('bad-user');
            expect(reports[0].reason).toBe('Harassment');
        });
    });

    describe('Admin Actions', () => {
        test('should blacklist a user', async () => {
            await moderation.blacklistUser('bad-user');
            const result = await mockGlobalRemote.downloadFile('blacklist.json');
            const blacklist = JSON.parse(new TextDecoder().decode(result.data));
            expect(blacklist).toContain('bad-user');
        });

        test('should remove user from global registry', async () => {
            // Setup registry
            const users = [{ userId: 'bad-user', publicKey: 'pk' }, { userId: 'good-user', publicKey: 'pk2' }];
            await mockGlobalRemote.uploadFile('users.json', new TextEncoder().encode(JSON.stringify(users)));

            await moderation.removeFromGlobalRegistry('bad-user');
            const result = await mockGlobalRemote.downloadFile('users.json');
            const updatedUsers = JSON.parse(new TextDecoder().decode(result.data));
            expect(updatedUsers.length).toBe(1);
            expect(updatedUsers[0].userId).toBe('good-user');
        });

        test('should ban a user (hard ban)', async () => {
            // Setup user data
            await mockRootRemote.uploadFile('bad-user/profile.json', new Uint8Array([1, 2, 3]));
            await mockRootRemote.uploadFile('bad-user/public/posts/1.db', new Uint8Array([4, 5, 6]));

            await moderation.banUser('bad-user');

            const files = await mockRootRemote.listFiles('bad-user/');
            expect(files.length).toBe(0);

            const blacklistRes = await mockGlobalRemote.downloadFile('blacklist.json');
            expect(JSON.parse(new TextDecoder().decode(blacklistRes.data))).toContain('bad-user');
        });

        test('should delete a user file', async () => {
            const path = 'some-user/bad-post.db';
            await mockRootRemote.uploadFile(path, new Uint8Array([1]));
            await moderation.deleteUserFile(path);
            const entry = await mockRootRemote.downloadFile(path);
            expect(entry).toBeNull();
        });
    });

    describe('Data Management', () => {
        test('should export and import all data', async () => {
            await mockRootRemote.uploadFile('file1.txt', new TextEncoder().encode('hello'));
            const exportStr = await moderation.exportAllData();
            
            // Clear remote
            await mockRootRemote.deleteFile('file1.txt');
            
            await moderation.importAllData(exportStr);
            const result = await mockRootRemote.downloadFile('file1.txt');
            expect(new TextDecoder().decode(result.data)).toBe('hello');
        });

        test('should burn it to the ground', async () => {
            await mockRootRemote.uploadFile('f1', new Uint8Array([1]));
            await mockRootRemote.uploadFile('f2', new Uint8Array([2]));
            
            await moderation.burnItToTheGround();
            const files = await mockRootRemote.listFiles('');
            expect(files.length).toBe(0);
        });
    });
});
