import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SovereignS3nc } from '../src/SovereignS3nc';
import { InMemoryStorage } from '../src/adapters/InMemoryStorage';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';
import { S3Config, SovereignConfig } from '../src/types';

const CONFIG_PATH = path.join(__dirname, '../.test-env.json');

describe('Demo Apps Integration Tests', () => {
    let config: any;

    beforeAll(() => {
        if (!fs.existsSync(CONFIG_PATH)) {
            throw new Error(`Test config not found at ${CONFIG_PATH}. Run 'npm run setup:test-env' first.`);
        }
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    });

    const createInstance = async (appId: string, userId: string = 'user1', storeId: string = 'default') => {
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
            paths: {
                appId,
                userId,
                storeId
            },
            conflictResolutionStrategy: 'Merge'
        };

        const storage = new InMemoryStorage();
        const sovereign = new SovereignS3nc(sovereignConfig, storage);
        
        await sovereign.init();
        return { sovereign, storage };
    };

    describe('Chat App (Public Sharing)', () => {
        test('should allow sharing a message publicly and syncing to another device', async () => {
            const appId = `chat-test-${uuidv4()}`;
            const userId = `alice-${uuidv4()}`; 
            const storeId = 'device-main'; // Use same storeId to share Identity/PublicId
            
            const userA1 = await createInstance(appId, userId, storeId);
            await userA1.sovereign.sync(); 

            const message = { text: "Hello Public World", timestamp: Date.now() };
            const docId = await userA1.sovereign.save(message, 'messages');

            const sharedId = await userA1.sovereign.share(docId, true, 'messages');
            expect(sharedId).toBeDefined();

            await userA1.sovereign.sync();

            const userA2 = await createInstance(appId, userId, storeId);
            // userA2 will pull identity from remote (since storeId is same)
            
            const shares = await userA2.sovereign.getPublicShares();
            const found = shares.find((c: any) => c.id === sharedId || (c.key && c.key.includes(sharedId)));
            expect(found).toBeDefined();
            
            const doc = await userA2.sovereign.getSharedDoc(sharedId);
            expect(doc).toBeDefined();
            expect(doc.data.text).toBe("Hello Public World");
        }, 60000);
    });

    describe('Notes App (Private Sync)', () => {
         test('should sync private notes across devices', async () => {
            const appId = `notes-test-${uuidv4()}`;
            const userId = `user-${uuidv4()}`;
            const storeId = 'main-store'; 
            
            const device1 = await createInstance(appId, userId, storeId);
            const note = { title: 'Secret Plan', content: 'World Domination', updatedAt: Date.now() };
            await device1.sovereign.save(note, 'notes');
            await device1.sovereign.sync();
            
            const device2 = await createInstance(appId, userId, storeId);
            await device2.sovereign.sync();
            
            const notes = await device2.sovereign.getAll('notes');
            expect(notes).toHaveLength(1);
            expect((notes[0] as any).title).toBe('Secret Plan');
         }, 60000);
    });

    describe('Shopping App (Conflict Resolution)', () => {
        test('should merge changes from two devices', async () => {
            const appId = `shopping-test-${uuidv4()}`;
            const userId = `family-${uuidv4()}`;
            const storeId = 'list-store'; 
            
            const devA = await createInstance(appId, userId, storeId);
            const devB = await createInstance(appId, userId, storeId);
            
            await devA.sovereign.sync();
            await devB.sovereign.sync();
            
            const milk = { name: 'Milk', checked: false };
            await devA.sovereign.save(milk, 'items');
            await devA.sovereign.sync();
            
            await devB.sovereign.sync();
            let itemsB = await devB.sovereign.getAll('items');
            expect(itemsB).toHaveLength(1);
            
            // A adds Eggs
            await devA.sovereign.save({ name: 'Eggs', checked: false }, 'items');
            
            // B checks Milk
            const milkDoc = itemsB[0] as any;
            milkDoc.checked = true;
            await devB.sovereign.save(milkDoc, 'items'); 
            
            // Sync both
            // devA.sync() skipped here to avoid "lastSyncTime > updateTime" issue if B's update happened before A's sync
            await devB.sovereign.sync(); // Pushes Milk Update, Pulls nothing (A hasn't pushed Eggs yet)
            await devA.sovereign.sync(); // Pushes Eggs, Pulls Milk Update
            
            // One more sync for B to get Eggs
            await devB.sovereign.sync(); 
            
            const finalA = await devA.sovereign.getAll('items');
            const finalB = await devB.sovereign.getAll('items');
            
            expect(finalA).toHaveLength(2);
            expect(finalB).toHaveLength(2);
            
            const milkA = finalA.find((i: any) => i.name === 'Milk') as any;
            expect(milkA.checked).toBe(true);
            
            const eggsB = finalB.find((i: any) => i.name === 'Eggs') as any;
            expect(eggsB).toBeDefined();
        }, 60000);
    });
    
    describe('Social App (Profiles)', () => {
        test('should allow creating and retrieving a public profile', async () => {
             const appId = `social-test-${uuidv4()}`;
             const userId = `zoe-${uuidv4()}`;
             const userZ = await createInstance(appId, userId, 'device1');
             
             await userZ.sovereign.sync();

             const myProfile = { name: "Zoe", bio: "Public" };
             const pid = await userZ.sovereign.save(myProfile, 'profiles');
             const sharedId = await userZ.sovereign.share(pid, true, 'profiles');
             await userZ.sovereign.sync();
             
             const zPublicId = userZ.sovereign.publicId;
             expect(zPublicId).toBeDefined();
             
             const observerRemote = new S3RemoteAdapter({
                endpoint: config.endpoint,
                region: config.region,
                credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
                bucketName: config.bucketName,
                forcePathStyle: true
             }, {
                 appId: appId,
                 userId: zPublicId!,
                 storeId: 'shared'
             });

             const fetched = await observerRemote.get(sharedId, 'profiles');
             expect(fetched).toBeDefined();
             if (!fetched) throw new Error("Fetched is null");
             expect(fetched.data.bio).toBe("Public");
        }, 60000);
    });
});