import { SovereignS3nc } from '../src/SovereignS3nc';
import { SocialManager } from '../src/modules/Social';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';

const TEST_ROOT = path.join(__dirname, 'functional-test-data');

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

describe('Functional Integration Tests', () => {
    let mockRemote: MockRemote;

    beforeEach(async () => {
        await fs.remove(TEST_ROOT);
        await fs.ensureDir(TEST_ROOT);
        mockRemote = new MockRemote();
    });

    async function createUser(id: string, password: string) {
        const userDir = path.join(TEST_ROOT, id);
        const config = {
            paths: { appId: 'test-app', userId: id, storeId: 'main' },
            localPersistencePath: userDir,
            password: password
        };
        const factory = (uid: string) => {
            if (uid === 'global') return {
                uploadFile: (p: string, d: Uint8Array) => mockRemote.uploadFile(`test-app/global/registry/${p}`, d),
                downloadFile: (p: string) => mockRemote.downloadFile(`test-app/global/registry/${p}`),
                getFileHash: (p: string) => mockRemote.getFileHash(`test-app/global/registry/${p}`)
            } as IRemoteAdapter;

            return {
                uploadFile: (p: string, d: Uint8Array) => mockRemote.uploadFile(`test-app/${uid}/main/${p}`, d),
                downloadFile: (p: string) => mockRemote.downloadFile(`test-app/${uid}/main/${p}`),
                getFileHash: (p: string) => mockRemote.getFileHash(`test-app/${uid}/main/${p}`)
            } as IRemoteAdapter;
        };

        const sov = new SovereignS3nc(config, factory(id), factory);
        await sov.init();
        const social = new SocialManager(sov, userDir);
        return { sov, social, userDir };
    }

    test('should post to SQLite and sync encrypted private DB', async () => {
        const { sov, social, userDir } = await createUser('user-A', 'pass-A');
        const today = new Date().toISOString().split('T')[0];
        const content = 'Hello private';
        
        await social.post(content, false);
        await sov.sync();

        // Derive Private GUID for assertion
        const privateId = crypto.pbkdf2Sync('pass-A', 'user-A-private-id', 1000, 32, 'sha256').toString('hex');
        const remotePath = `test-app/${privateId}/main/private/2026-02-06.db`;

        const remoteData = await mockRemote.downloadFile(remotePath);
        expect(remoteData).not.toBeNull();
        expect(remoteData!.toString()).not.toContain(content);

        await fs.remove(path.join(userDir, 'private', `${today}.db`));
        await sov.sync();

        const posts = await social.getPosts(today, 'private');
        expect(posts[0].content).toBe(content);
    });

    test('should collate public posts from followed users', async () => {
        const userA = await createUser('user-A', 'pass-A');
        const userB = await createUser('user-B', 'pass-B');
        const today = new Date().toISOString().split('T')[0];

        // 1. User B posts something public and syncs
        await userB.social.post('Hello from B', true);
        await userB.sov.sync();

        // 2. User A syncs (will discover B in registry)
        await userA.sov.sync();

        // 3. Verify user-A has user-B's DB
        const followedFile = path.join(userA.userDir, 'followed', 'user-B', `${today}.db`);
        expect(await fs.pathExists(followedFile)).toBe(true);

        // 4. Read it
        const posts = await userA.social.getPosts('user-B/' + today, 'followed' as any);
        expect(posts[0].content).toBe('Hello from B');
    });
});