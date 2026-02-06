import { SovereignS3nc } from '../src/SovereignS3nc';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';

const TEST_ROOT = path.join(__dirname, 'test-data-sync');

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string}> = new Map();

    async uploadFile(path: string, data: Uint8Array): Promise<void> {
        const hash = crypto.createHash('sha256').update(data).digest('hex');
        this.files.set(path, { data, hash });
    }
    async downloadFile(path: string): Promise<Uint8Array | null> {
        return this.files.get(path)?.data || null;
    }
    async getFileHash(path: string): Promise<string | null> {
        return this.files.get(path)?.hash || null;
    }
}

describe('SovereignS3nc Sync Logic', () => {
    let mockRemote: MockRemote;

    function getDateStr(date: Date): string {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    beforeEach(async () => {
        await fs.remove(TEST_ROOT);
        await fs.ensureDir(TEST_ROOT);
        mockRemote = new MockRemote();
    });

    async function createSov(id: string) {
        const userDir = path.join(TEST_ROOT, id);
        const config = {
            paths: { appId: 'test-app', userId: id, storeId: 'main' },
            localPersistencePath: userDir,
            password: 'password-' + id
        };
        const factory = (uid: string) => {
            // Simulate S3 prefixing: appId/userId/storeId/path
            if (uid === 'global') return {
                uploadFile: (p: string, d: Uint8Array) => mockRemote.uploadFile(`test-app/global/registry/${p}`, d),
                downloadFile: (p: string) => mockRemote.downloadFile(`test-app/global/registry/${p}`),
                getFileHash: (p: string) => mockRemote.getFileHash(`test-app/global/registry/${p}`)
            } as IRemoteAdapter;

            const prefix = `test-app/${uid}/main`;

            return {
                uploadFile: (p: string, d: Uint8Array) => mockRemote.uploadFile(`${prefix}/${p}`, d),
                downloadFile: (p: string) => mockRemote.downloadFile(`${prefix}/${p}`),
                getFileHash: (p: string) => mockRemote.getFileHash(`${prefix}/${p}`)
            } as IRemoteAdapter;
        };
        // The library creates globalRemote internally, but for tests we inject the factory
        // We need to pass the factory to constructor so it can use it for global too
        const sov = new SovereignS3nc(config, factory(id), factory);
        await sov.init();
        return { sov, userDir };
    }

    test('should upload and download encrypted content', async () => {
        const { sov, userDir } = await createSov('user-1');
        const today = getDateStr(new Date());
        const content = Buffer.from('test-content');
        
        await fs.ensureDir(path.join(userDir, 'private'));
        await fs.writeFile(path.join(userDir, 'private', `${today}.db`), content);

        await sov.sync();
        
        // Private GUID is derived from 'user-1' + '-private-id'
        const privateId = crypto.pbkdf2Sync('password-user-1', 'user-1-private-id', 1000, 32, 'sha256').toString('hex');
        const remotePath = `test-app/${privateId}/main/private/2026-02-06.db`;
        
        const remoteData = await mockRemote.downloadFile(remotePath);
        expect(remoteData).not.toBeNull();
        expect(remoteData!.toString()).not.toContain('test-content');

        await fs.remove(path.join(userDir, 'private', `${today}.db`));
        await sov.sync();
        expect(await fs.readFile(path.join(userDir, 'private', `${today}.db`))).toEqual(content);
    });

    test('should register in global users.json', async () => {
        const { sov } = await createSov('user-1');
        await sov.sync();

        const registryData = await mockRemote.downloadFile('test-app/global/registry/users.json');
        const registry = JSON.parse(registryData!.toString());
        expect(registry[0].userId).toBe('user-1');
        expect(registry[0].publicKey).toBeDefined();
    });

    test('should pull followed users', async () => {
        const userA = await createSov('user-A');
        const userB = await createSov('user-B');
        const today = getDateStr(new Date());
        const contentB = Buffer.from('content-B');

        // User B uploads public content
        await fs.ensureDir(path.join(userB.userDir, 'public'));
        await fs.writeFile(path.join(userB.userDir, 'public', `${today}.db`), contentB);
        await userB.sov.sync();

        // User A syncs and should discover/pull B
        await userA.sov.sync();

        const followedFile = path.join(userA.userDir, 'followed', 'user-B', `${today}.db`);
        expect(await fs.pathExists(followedFile)).toBe(true);
        expect(await fs.readFile(followedFile)).toEqual(contentB);
    });
});