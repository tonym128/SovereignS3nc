import { SovereignS3nc } from '../src/SovereignS3nc';
import { WebRTCRemoteAdapter } from '../src/adapters/WebRTCRemoteAdapter';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import { SovereignConfig } from '../src/types';
import { IDBFactory } from 'fake-indexeddb';
import crypto from 'crypto';

// Polyfills for Node environment
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;

// A simple proxy to add prefixes, just like S3RemoteAdapter does
class PrefixProxyAdapter implements IRemoteAdapter {
    constructor(private baseAdapter: WebRTCRemoteAdapter, private prefix: string) {}
    
    private getKey(path: string) { return `${this.prefix}/${path}`; }

    uploadFile(path: string, data: Uint8Array, hash?: string) {
        return this.baseAdapter.uploadFile(this.getKey(path), data, hash);
    }
    downloadFile(path: string, ifNoneMatch?: string) {
        return this.baseAdapter.downloadFile(this.getKey(path), ifNoneMatch);
    }
    getFileHash(path: string) {
        return this.baseAdapter.getFileHash(this.getKey(path));
    }
    getFileEtag(path: string) {
        return this.baseAdapter.getFileEtag(this.getKey(path));
    }
}

describe('WebRTC Mesh Integration', () => {
    let aliceS3nc: SovereignS3nc;
    let bobS3nc: SovereignS3nc;

    beforeEach(async () => {
        // Reset DB
        (global as any).indexedDB = new IDBFactory();

        const peerAAdapter = new WebRTCRemoteAdapter('alice-node');
        const peerBAdapter = new WebRTCRemoteAdapter('bob-node');

        // Connect them (mocking WebRTC DataChannel)
        const connAtoB = peerAAdapter.connectPeer((msg) => setTimeout(() => connBtoA.receive(msg), 10));
        const connBtoA = peerBAdapter.connectPeer((msg) => setTimeout(() => connAtoB.receive(msg), 10));

        const configA: SovereignConfig = {
            paths: { appId: 'mesh-app', userId: 'alice', storeId: 'main' },
            password: 'pass',
            debug: false
        };

        const configB: SovereignConfig = {
            paths: { appId: 'mesh-app', userId: 'bob', storeId: 'main' },
            password: 'pass',
            debug: false
        };

        const factoryA = (userId: string) => new PrefixProxyAdapter(peerAAdapter, `mesh-app/${userId}/main`);
        aliceS3nc = new SovereignS3nc(configA, factoryA('alice'), factoryA);
        
        const factoryB = (userId: string) => new PrefixProxyAdapter(peerBAdapter, `mesh-app/${userId}/main`);
        bobS3nc = new SovereignS3nc(configB, factoryB('bob'), factoryB);

        await aliceS3nc.init();
        await bobS3nc.init();
    });

    test('Two SovereignS3nc instances sync a blob via WebRTCRemoteAdapter', async () => {
        // Alice saves a blob
        const data = new Uint8Array([10, 20, 30, 40]);
        const blobPath = await aliceS3nc.saveBlob(data, true); // true = public
        
        // Alice syncs to push it to her remote (which broadcasts it to the mesh)
        await aliceS3nc.sync();

        // Give the gossip protocol a moment to propagate
        await new Promise(resolve => setTimeout(resolve, 50));

        // Bob syncs
        await bobS3nc.sync();
        
        // Bob tries to get Alice's blob
        const bData = await bobS3nc.getBlob(blobPath, 'alice');
        
        expect(bData).toBeDefined();
        expect(bData).toEqual(data);
    });

    test('Two SovereignS3nc instances sync a profile via WebRTCRemoteAdapter', async () => {
        // Alice updates her public profile
        const profileData = new TextEncoder().encode(JSON.stringify({ name: 'Alice Node', bio: 'WebRTC test' }));
        await aliceS3nc.getStorage().savePublicUserFile(profileData);
        await aliceS3nc.sync();

        await new Promise(resolve => setTimeout(resolve, 50));

        // Bob syncs. In a real scenario, he would follow Alice first.
        // Let's manually pull her public user.json file using the createRemote factory logic
        const userRemote = (bobS3nc as any).createRemote('alice');
        const result = await userRemote.downloadFile('public/user.json');
        
        expect(result).toBeDefined();
        // Since user.json is uploaded encrypted with their own publicEncryptionKey
        const alicePubKey = aliceS3nc.getConfig().publicEncryptionKey;
        const decrypted = await bobS3nc.decrypt(result!.data!, alicePubKey!);

        expect(decrypted).toEqual(profileData);
    });
});
