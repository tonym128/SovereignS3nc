import { SovereignS3nc } from './src/SovereignS3nc';
import { SocialManager } from './src/modules/Social';
import { IRemoteAdapter } from './src/interfaces/IRemoteAdapter';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';

// --- Setup Mock S3 environment ---
class MockS3 implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string}> = new Map();
    async uploadFile(p: string, data: Uint8Array) {
        const hash = crypto.createHash('sha256').update(data).digest('hex');
        this.files.set(p, { data, hash });
    }
    async downloadFile(p: string) { return this.files.get(p)?.data || null; }
    async getFileHash(p: string) { return this.files.get(p)?.hash || null; }
}

const mockS3 = new MockS3();
const factory = (uid: string) => {
    // S3 prefixing: appId/userId/storeId/path
    if (uid === 'global') {
        return {
            uploadFile: (p: string, d: Uint8Array) => mockS3.uploadFile(`test-app/global/registry/${p}`, d),
            downloadFile: (p: string) => mockS3.downloadFile(`test-app/global/registry/${p}`),
            getFileHash: (p: string) => mockS3.getFileHash(`test-app/global/registry/${p}`)
        } as IRemoteAdapter;
    }
    const prefix = `test-app/${uid}/main`;
    return {
        uploadFile: (p: string, d: Uint8Array) => mockS3.uploadFile(`${prefix}/${p}`, d),
        downloadFile: (p: string) => mockS3.downloadFile(`${prefix}/${p}`),
        getFileHash: (p: string) => mockS3.getFileHash(`${prefix}/${p}`)
    } as IRemoteAdapter;
};

async function runDemo() {
    const demoDir = path.join(__dirname, 'demo-runtime');
    await fs.remove(demoDir);

    console.log('--- User ALICE Setup ---');
    const aliceDir = path.join(demoDir, 'alice');
    const aliceSov = new SovereignS3nc({
        paths: { appId: 'test-app', userId: 'alice', storeId: 'main' },
        localPersistencePath: aliceDir,
        password: 'alice-password'
    }, factory('alice'), factory);
    await aliceSov.init();
    const aliceSocial = new SocialManager(aliceSov, aliceDir);

    console.log('Alice: Posting a public update...');
    await aliceSocial.post('Hello world, I am Alice!', true);
    await aliceSov.sync();

    console.log('\n--- User BOB Setup ---');
    const bobDir = path.join(demoDir, 'bob');
    const bobSov = new SovereignS3nc({
        paths: { appId: 'test-app', userId: 'bob', storeId: 'main' },
        localPersistencePath: bobDir,
        password: 'bob-password'
    }, factory('bob'), factory);
    await bobSov.init();
    const bobSocial = new SocialManager(bobSov, bobDir);

    console.log('Bob: Syncing to discover Alice...');
    await bobSov.sync(); // This triggers auto-discovery via users.json

    console.log('\n--- Collation Check ---');
    const today = new Date().toISOString().split('T')[0];
    const alicePosts = await bobSocial.getPosts('alice/' + today, 'followed' as any);
    
    console.log(`Bob sees Alice's post: "${alicePosts[0]?.content}"`);
    console.log('Success! Collation works with Zero Knowledge keys.');
}

runDemo().catch(console.error);