
import { SovereignS3nc } from '../src/SovereignS3nc';
import { FeedModule } from '../src/modules/Feed';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import { GroupMember } from '../src/types';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';

// --- Browser Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

describe('Member Revocation Integration Tests', () => {
    let aliceSov: SovereignS3nc;
    let bobSov: SovereignS3nc;
    let charlieSov: SovereignS3nc;

    const appId = 'revocation-test-' + Math.random().toString(36).substring(7);
    const storeId = 'social';

    const setupUser = async (userId: string, password: string) => {
        const sov = new SovereignS3nc({
            paths: { appId, userId, storeId },
            password
        });
        (sov as any).storage = new IndexedDBStorage(`${userId}_db_${appId}`);
        await sov.init();
        return sov;
    };

    beforeAll(async () => {
        aliceSov = await setupUser('alice', 'alice-pass');
        bobSov = await setupUser('bob', 'bob-pass');
        charlieSov = await setupUser('charlie', 'charlie-pass');

        await aliceSov.sync();
        await bobSov.sync();
        await charlieSov.sync();

        // Share public keys via registry
        const registry = [
            { userId: 'alice', publicKey: aliceSov.getConfig().publicEncryptionKey! },
            { userId: 'bob', publicKey: bobSov.getConfig().publicEncryptionKey! },
            { userId: 'charlie', publicKey: charlieSov.getConfig().publicEncryptionKey! }
        ];
        const registryData = new TextEncoder().encode(JSON.stringify(registry));
        await (aliceSov as any).globalRemote.uploadFile('users.json', registryData);
        
        await aliceSov.follow('bob');
        await aliceSov.follow('charlie');
        await bobSov.follow('alice');
        await bobSov.follow('charlie');
        await charlieSov.follow('alice');
        await charlieSov.follow('bob');
    }, 30000);

    test('Revocation propagates and stops sync from revoked member', async () => {
        // 1. Alice creates a group with Bob and Charlie
        const members: GroupMember[] = [
            { userId: 'alice', publicKey: aliceSov.getConfig().publicEncryptionKey!, role: 'owner' },
            { userId: 'bob', publicKey: bobSov.getConfig().publicEncryptionKey!, role: 'member' },
            { userId: 'charlie', publicKey: charlieSov.getConfig().publicEncryptionKey!, role: 'member' }
        ];
        const group = await aliceSov.createGroup('Revocation Group', members);

        // 2. Bob and Charlie join
        await bobSov.joinGroup(group);
        await charlieSov.joinGroup(group);

        await aliceSov.sync();
        await bobSov.sync();
        await charlieSov.sync();

        // 3. Verify all see each other in the group
        let aliceGroup = (await aliceSov.getGroups())[0];
        expect(aliceGroup.members.length).toBe(3);

        // 4. Alice removes Charlie
        aliceGroup.members = aliceGroup.members.filter(m => m.userId !== 'charlie');
        await aliceSov.updateGroup(aliceGroup);
        await aliceSov.sync();

        // 5. Bob syncs and should see Charlie is gone
        await bobSov.sync();
        let bobGroup = (await bobSov.getGroups()).find(g => g.id === group.id);
        expect(bobGroup!.members.find(m => m.userId === 'charlie')).toBeUndefined();
        expect(bobGroup!.members.length).toBe(2);

        // 6. Charlie syncs - he still sees the old group state locally, but he won't get updates from Alice anymore
        // because Alice removed him from the metadata she pushes.
        // Also, Alice won't pull from Charlie anymore.
        
        // 7. Verify Alice doesn't pull Charlie's new posts
        const charlieFeed = new FeedModule(charlieSov);
        await charlieFeed.postToGroup(group.id, group.sharedKey, "Charlie's rogue post");
        await charlieSov.sync();

        await aliceSov.sync();
        const aliceFeed = new FeedModule(aliceSov);
        const today = SovereignS3nc.getDateStr(new Date());
        const alicePosts = await aliceFeed.getGroupPosts(group.id, today);
        expect(alicePosts.find(p => p.content === "Charlie's rogue post")).toBeUndefined();
    });
});
