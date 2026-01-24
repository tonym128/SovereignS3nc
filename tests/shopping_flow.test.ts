import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SovereignS3nc } from '../src/SovereignS3nc';
import { InMemoryStorage } from '../src/adapters/InMemoryStorage';
import { S3Config, SovereignConfig, SovereignAddress } from '../src/types';

const CONFIG_PATH = path.join(__dirname, '../.test-env.json');

describe('Shopping App Social Flow', () => {
    let config: any;

    beforeAll(() => {
        if (!fs.existsSync(CONFIG_PATH)) {
            throw new Error(`Test config not found at ${CONFIG_PATH}. Run 'npm run setup:test-env' first.`);
        }
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    });

    const createInstance = async (appId: string, userId: string, storeId: string = 'shopping') => {
        const s3Config: S3Config = {
            endpoint: config.endpoint,
            region: config.region,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey
            },
            bucketName: config.bucketName,
            forcePathStyle: true
        };

        const sovereignConfig: SovereignConfig = {
            s3: s3Config,
            paths: { appId, userId, storeId },
            conflictResolutionStrategy: 'Merge',
            // Shopping app uses passphrase derivation but for tests we can skip or simulate.
            // But wait, SovereignS3nc init() derives keys if auth is present.
            // We'll skip auth config here and assume no encryption for simplicity of testing LOGIC first.
            // Ideally we should test with encryption if the app enforces it.
            // The app.ts snippet shows it decrypts identity.
            // Let's stick to unencrypted for logic verification to avoid debugging crypto.
        };

        const storage = new InMemoryStorage();
        const sovereign = new SovereignS3nc(sovereignConfig, storage);
        
        await sovereign.init();
        // Force identity creation (normally done by UI/Auth)
        // We need this for 'getAddress()' to work correctly if it relies on _publicId
        // SovereignS3nc auto-generates publicId if missing? No, checks remote.
        // If we don't provide auth, it might not generate one?
        // Actually SovereignS3nc generates _publicId if not found? 
        // Let's check getAddress().
        
        return { sovereign, storage };
    };

    test('User B should see User A\'s shared list after following', async () => {
        const appId = `shopping-social-${uuidv4()}`;
        const userA = await createInstance(appId, 'Alice');
        const userB = await createInstance(appId, 'Bob');

        // 1. A creates a list
        const listData = {
            title: "Alice's Party",
            ownerId: 'Alice',
            createdAt: Date.now(),
            type: 'list'
        };
        const listId = await userA.sovereign.save(listData, 'lists');
        
        // 2. A shares the list
        await userA.sovereign.share(listId, true, 'lists');
        await userA.sovereign.sync(); // Push share to A's public store

        // 3. B follows A
        const addrA: SovereignAddress = userA.sovereign.getAddress();
        await userB.sovereign.social.follow(addrA);
        
        // 4. B syncs (Pulls followed content)
        await userB.sovereign.sync();

        // 5. Verify B has the list in 'followed_content'
        const followed = await userB.sovereign.collection('followed_content').getAll<any>();
        const foundList = followed.find(d => d.type === 'list' && d.title === "Alice's Party");
        
        expect(foundList).toBeDefined();
        // Check owner
        expect(foundList.ownerId).toBe('Alice');
    }, 60000);

    test('Both users editing (Mutual Follow)', async () => {
        const appId = `shopping-coedit-${uuidv4()}`;
        const userA = await createInstance(appId, 'Alice');
        const userB = await createInstance(appId, 'Bob');

        // Mutual Follow
        const addrA = userA.sovereign.getAddress();
        const addrB = userB.sovereign.getAddress();
        await userA.sovereign.social.follow(addrB);
        await userB.sovereign.social.follow(addrA);

        // 1. A creates list and item
        const listId = await userA.sovereign.save({ title: "Shared List", type: 'list', ownerId: 'Alice', createdAt: Date.now() }, 'lists');
        await userA.sovereign.share(listId, true, 'lists');
        
        const item1Id = await userA.sovereign.save({ listId, text: "Milk", type: 'item', createdAt: Date.now(), authorId: 'Alice' }, 'items');
        await userA.sovereign.share(item1Id, true, 'items');
        
        await userA.sovereign.sync(); // A publishes

        // 2. B syncs and sees list
        await userB.sovereign.sync();
        const followedB = await userB.sovereign.collection('followed_content').getAll<any>();
        const listB = followedB.find(d => d.type === 'list' && d.title === "Shared List");
        expect(listB).toBeDefined();
        
        // Resolve original list ID (B sees it wrapped/renamed? No, getAll decrypts inner data.
        // But SovereignS3nc 'followed_content' usually stores it with ID 'follow_user_origId'
        // But the DATA inside has the original ID usually?
        // Let's check the fetched doc.
        // In the app logic: `if (listId.startsWith('follow_')) ... targetListId = parts...`
        // The ID of the document IN THE STORE is 'follow_Alice_<listId>'.
        // The DATA inside has '_id': listId (original).
        // Let's confirm this behavior.
        
        const originalListId = listB._id; // Wait, getAll returns doc with _id from store key?
        // InMemoryStorage: lists(false) -> keys are store keys. 
        // SovereignS3nc getAll: pushes { ...plain, _id: doc._id }
        // So _id is the LOCAL STORE ID (follow_Alice_...).
        
        // We need the original ID to link items.
        // The app logic parses it from the ID string.
        let targetListId = originalListId;
        if (targetListId.startsWith('follow_')) {
             targetListId = targetListId.split('_').slice(2).join('_');
        }
        expect(targetListId).toBe(listId);

        // 3. B adds an item "Eggs" linking to ORIGINAL List ID
        const item2Id = await userB.sovereign.save({ 
            listId: targetListId, 
            text: "Eggs", 
            type: 'item', 
            createdAt: Date.now(), 
            authorId: 'Bob' 
        }, 'items');
        await userB.sovereign.share(item2Id, true, 'items');
        await userB.sovereign.sync(); // B publishes

        // 4. A syncs and sees "Eggs"
        await userA.sovereign.sync();
        const followedA = await userA.sovereign.collection('followed_content').getAll<any>();
        const eggItem = followedA.find(d => d.type === 'item' && d.text === "Eggs");
        
        expect(eggItem).toBeDefined();
        expect(eggItem.authorId).toBe('Bob');
        
        // 5. A checks "Eggs" (creates state)
        // A needs to refer to "Eggs" original ID.
        let eggOriginalId = eggItem._id;
        if (eggOriginalId.startsWith('follow_')) {
            eggOriginalId = eggOriginalId.split('_').slice(2).join('_');
        }
        expect(eggOriginalId).toBe(item2Id);

        const stateId = await userA.sovereign.save({
            itemId: eggOriginalId,
            isChecked: true,
            updatedAt: Date.now(),
            authorId: 'Alice',
            type: 'item_state'
        }, 'item_states');
        await userA.sovereign.share(stateId, true, 'item_states');
        await userA.sovereign.sync();

        // 6. B syncs and sees state
        await userB.sovereign.sync();
        const followedStatesB = await userB.sovereign.collection('followed_content').getAll<any>();
        const eggState = followedStatesB.find(d => d.type === 'item_state' && d.itemId === item2Id);
        
        expect(eggState).toBeDefined();
        expect(eggState.isChecked).toBe(true);
        expect(eggState.authorId).toBe('Alice');

    }, 60000);
});