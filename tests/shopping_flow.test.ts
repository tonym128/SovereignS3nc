import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';
import { SyncDocument } from '../src/types';

// --- Mock Cloud Infrastructure ---
// Simulates a global S3 bucket
const mockCloudStorage = new Map<string, SyncDocument>();

// Helper to generate a key exactly like S3RemoteAdapter does
function getKey(paths: any, id: string, collection?: string) {
    // Basic logic from S3RemoteAdapter
    let prefix = `${paths.appId}/${paths.userId}/${paths.storeId}/`;
    if (collection) prefix += `${collection}/`;
    return prefix + id;
}

// Concrete Mock Implementation
class MemoryAdapter {
    constructor(private config: any, private paths: any) {}

    async put(doc: SyncDocument, collection?: string): Promise<string> {
        const key = getKey(this.paths, doc._id, collection);
        mockCloudStorage.set(key, JSON.parse(JSON.stringify(doc)));
        return 'etag-' + Date.now();
    }

    async get(id: string, collection?: string): Promise<SyncDocument | null> {
        const key = getKey(this.paths, id, collection);
        const doc = mockCloudStorage.get(key);
        return doc ? JSON.parse(JSON.stringify(doc)) : null;
    }

    async listChanges(since: Date, collection?: string): Promise<any[]> {
        const prefix = `${this.paths.appId}/${this.paths.userId}/${this.paths.storeId}/` + (collection ? `${collection}/` : '');
        const results = [];
        
        for (const [key, doc] of mockCloudStorage.entries()) {
            if (key.startsWith(prefix)) {
                if (new Date(doc._updatedAt) > since) {
                    results.push({
                        id: doc._id,
                        collection: collection, // simplified
                        etag: 'etag',
                        key: key,
                        updatedAt: new Date(doc._updatedAt)
                    });
                }
            }
        }
        return results;
    }

    async delete(id: string, collection?: string): Promise<void> {
        const key = getKey(this.paths, id, collection);
        mockCloudStorage.delete(key);
    }
}

// Mock the S3RemoteAdapter module
jest.mock('../src/adapters/S3RemoteAdapter', () => {
    return {
        S3RemoteAdapter: jest.fn().mockImplementation((config, paths) => {
            return new MemoryAdapter(config, paths);
        })
    };
});

describe('Shopping List Collaborative Flow', () => {
    let alice: SovereignS3nc;
    let bob: SovereignS3nc;

    beforeEach(async () => {
        mockCloudStorage.clear();
        (S3RemoteAdapter as any).mockClear();

        // --- ALICE ---
        alice = new SovereignS3nc({
            s3: { endpoint: 'mock', region: 'us-east-1', bucketName: 'bucket', credentials: { accessKeyId: 'a', secretAccessKey: 's' } },
            paths: { appId: 'shopping', userId: 'alice', storeId: 'data' },
            syncIntervalMs: 0
        });
        await alice.init();

        // --- BOB ---
        bob = new SovereignS3nc({
            s3: { endpoint: 'mock', region: 'us-east-1', bucketName: 'bucket', credentials: { accessKeyId: 'b', secretAccessKey: 's' } },
            paths: { appId: 'shopping', userId: 'bob', storeId: 'data' },
            syncIntervalMs: 0
        });
        await bob.init();
    });

    test('Full Collaboration Cycle', async () => {
        // 1. Alice creates a list
        const listId = await alice.collection('lists').save({
            title: 'Groceries',
            ownerId: 'alice',
            createdAt: Date.now(),
            type: 'list'
        });

        // 2. Alice shares the list
        const shareId = await alice.share(listId, true, 'lists');
        
        // Ensure Alice syncs to "Cloud"
        await alice.sync();

        // 3. Bob follows Alice
        // Bob must follow Alice's PUBLIC ID, not her private login ID
        expect(alice.publicId).toBeDefined();

        const aliceAddress = {
            appId: 'shopping',
            userId: alice.publicId!, // Use Public ID
            endpoint: 'mock',
            bucket: 'bucket',
            region: 'us-east-1'
        };

        await bob.social.follow(aliceAddress);
        
        // 4. Bob Syncs -> Should pull Alice's shared content
        const stats = await bob.sync();
        expect(stats.pulled).toBeGreaterThan(0);

        // 5. Bob should see the list
        // It will be in 'followed_content' collection
        const followedLists = await bob.collection('followed_content').getAll<any>();
        const sharedList = followedLists.find(d => d.type === 'list' && d.title === 'Groceries');
        
        expect(sharedList).toBeDefined();
        // The ID in followed_content is 'follow_alice_{shareId}' or similar depending on implementation
        // Check app.ts logic: "follow_userId_originalId" or based on share logic
        
        // 6. Bob adds an item to this list
        // Bob needs to reference the *Original* List ID (or the ID he knows).
        // In the app, items are stored in Bob's 'items' collection.
        // The 'listId' field points to Alice's list.
        
        // We need the ID that Bob sees. 
        // The share logic in SovereignS3nc:
        // Alice shares `listId` -> `shareId` in Alice's 'shared' store.
        // Bob pulls `shareId` -> saves as `follow_alice_{shareId}` in 'followed_content'.
        // Wait, does Bob decrypt it? 
        // If it's public share, yes.
        
        // Let's verify the content of the shared list
        // expect(sharedList._id).toContain('alice');

        // Bob creates item
        // Note: For Alice to see this, Bob must share the item too!
        const itemId = await bob.collection('items').save({
            listId: listId, // Referring to original ID (assuming Bob knows it or we use the shared one?)
                            // In app.ts, we used logic to strip 'follow_' prefix if present.
            text: 'Milk',
            type: 'item',
            authorId: 'bob',
            createdAt: Date.now()
        });
        
        // Bob shares the item
        await bob.share(itemId, true, 'items');
        await bob.sync();

        // 7. Alice needs to follow Bob to see his items
        expect(bob.publicId).toBeDefined();
        const bobAddress = {
            appId: 'shopping',
            userId: bob.publicId!, // Use Public ID
            endpoint: 'mock',
            bucket: 'bucket',
            region: 'us-east-1'
        };
        await alice.social.follow(bobAddress);
        
        // 8. Alice syncs
        await alice.sync();
        
        // 9. Alice checks for items
        const aliceFollowedItems = await alice.collection('followed_content').getAll<any>();
        const milkItem = aliceFollowedItems.find(i => i.text === 'Milk');
        expect(milkItem).toBeDefined();
        expect(milkItem.authorId).toBe('bob');

        // 10. Conflict / Toggle State
        // Alice checks the item
        const stateId = await alice.collection('item_states').save({
            itemId: milkItem._originalId || milkItem._id, // References the item
            isChecked: true,
            type: 'item_state',
            updatedAt: Date.now()
        });
        await alice.share(stateId, true, 'item_states');
        await alice.sync();

        // Bob syncs
        await bob.sync();
        
        const bobFollowedStates = await bob.collection('followed_content').getAll<any>();
        const state = bobFollowedStates.find(s => s.type === 'item_state' && s.isChecked === true);
        expect(state).toBeDefined();
    });
});
