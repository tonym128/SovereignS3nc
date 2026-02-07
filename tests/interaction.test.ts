import { SovereignS3nc } from '../src/SovereignS3nc';
import { SocialManager } from '../src/modules/Social';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';

const TEST_ROOT = path.join(__dirname, 'interaction-tests');

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string}> = new Map();

    async uploadFile(path: string, data: Uint8Array): Promise<void> {
        const hash = crypto.createHash('sha256').update(data);
        // Note: In real app, the hash salt depends on the key. 
        // For the mock, we just store the raw data and let the lib check hashes.
        this.files.set(path, { data, hash: 'dummy-hash' }); // The lib will overwrite this with calculateHashedContent
    }

    // Overload upload to allow setting the hash directly as the lib does
    async uploadFileWithHash(path: string, data: Uint8Array, hash: string) {
        this.files.set(path, { data, hash });
    }

    async downloadFile(path: string): Promise<Uint8Array | null> {
        return this.files.get(path)?.data || null;
    }
    async getFileHash(path: string): Promise<string | null> {
        return this.files.get(path)?.hash || null;
    }
}

describe('Social Demo Interaction Tests', () => {
    let mockS3: MockRemote;

    beforeEach(async () => {
        await fs.remove(TEST_ROOT);
        await fs.ensureDir(TEST_ROOT);
        mockS3 = new MockRemote();
    });

    async function setupUser(userId: string, password: string) {
        const userDir = path.join(TEST_ROOT, userId);
        const config = {
            paths: { appId: 'social-app', userId: userId, storeId: 'main' },
            localPersistencePath: userDir,
            password: password
        };

        const factory = (uid: string) => {
            const prefix = uid === 'global' ? 'social-app/global/registry' : `social-app/${uid}/main`;
            return {
                uploadFile: async (p: string, d: Uint8Array) => {
                    // Simulate the lib's behavior of calculating hash with key
                    // In tests, we'll just use a simplified version
                    const hash = crypto.createHash('sha256').update(d).digest('hex');
                    await mockS3.uploadFileWithHash(`${prefix}/${p}`, d, hash);
                },
                downloadFile: (p: string) => mockS3.downloadFile(`${prefix}/${p}`),
                getFileHash: (p: string) => mockS3.getFileHash(`${prefix}/${p}`)
            } as IRemoteAdapter;
        };

        const sov = new SovereignS3nc(config, factory(userId), factory);
        await sov.init();
        const social = new SocialManager(sov, userDir);
        return { sov, social, userDir, config };
    }

    test('Zero Knowledge: Private data is invisible to others', async () => {
        const alice = await setupUser('alice', 'alice-pass');
        const bob = await setupUser('bob', 'bob-pass');

        // Alice posts something private
        await alice.social.post('Alice secret journal', false);
        await alice.sov.sync();

        // Alice's private data is stored under her Private GUID
        // Bob shouldn't even know where to look, but even if he guesses her public path...
        const alicePrivatePathGuess = `social-app/alice/main/private/${new Date().toISOString().split('T')[0]}.db`;
        const data = await mockS3.downloadFile(alicePrivatePathGuess);
        expect(data).toBeNull(); // It's not there! It's under a GUID Bob doesn't have.
    });

    test('Full Workflow: Post, Discover, Follow, Collate, and Comment', async () => {
        const alice = await setupUser('alice', 'alice-pass');
        const bob = await setupUser('bob', 'bob-pass');
        const today = new Date().toISOString().split('T')[0];

        // 1. Alice updates her profile and posts
        await alice.social.updateProfile('Alice Liddell', 'In Wonderland');
        await alice.social.post('I found a rabbit hole!', true);
        await alice.sov.sync();

        // 2. Bob syncs - should discover Alice
        await bob.sov.sync();
        
        // 3. Verify Bob followed Alice automatically
        const following = await (bob.sov as any).storage.getFollowing();
        expect(following.map((f: any) => f.userId)).toContain('alice');

        // 4. Verify Bob pulled Alice's post
        const alicePostFile = path.join(bob.userDir, 'followed', 'alice', `${today}.db`);
        expect(await fs.pathExists(alicePostFile)).toBe(true);

        const bobViewsAlice = await bob.social.getPosts('alice/' + today, 'followed' as any);
        expect(bobViewsAlice[0].content).toBe('I found a rabbit hole!');

        // 5. Bob replies to Alice
        const alicePost = bobViewsAlice[0];
        await bob.social.comment(alicePost.id, alicePost.userId, 'Don't go down there!');
        await bob.sov.sync();

        // 6. Alice syncs and sees Bob's comment
        await alice.sov.sync();
        const aliceViewsBob = await alice.social.getPosts('bob/' + today, 'followed' as any);
        expect(aliceViewsBob[0].content).toBe('Don't go down there!');
        expect(aliceViewsBob[0].parentId).toBe(alicePost.id);
    });

    test('Identity Recovery: Login on new device with password', async () => {
        const password = 'extremely-secure-password';
        const alice1 = await setupUser('alice', password);
        
        await alice1.social.post('Device 1 Post', true);
        await alice1.sov.sync();

        // Simulate new device (new local folder, same credentials)
        const alice2Dir = path.join(TEST_ROOT, 'alice-device-2');
        const alice2 = new SovereignS3nc({
            paths: { appId: 'social-app', userId: 'alice', storeId: 'main' },
            localPersistencePath: alice2Dir,
            password: password
        }, alice1.sov['remoteFactory']!('alice'), alice1.sov['remoteFactory']);
        
        await alice2.init();
        await alice2.sync();

        // Alice 2 should have the same Public Key as Alice 1
        expect((alice2 as any).config.publicEncryptionKey).toBe((alice1 as any).config.publicEncryptionKey);
        
        const today = new Date().toISOString().split('T')[0];
        const posts = await new SocialManager(alice2, alice2Dir).getPosts(today, 'public');
        expect(posts[0].content).toBe('Device 1 Post');
    });
});
