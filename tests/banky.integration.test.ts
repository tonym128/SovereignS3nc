import { SovereignS3nc } from '../src/SovereignS3nc';
import { BankyManager, BankAccount, Transaction } from '../demo/banky/src/Banky';
import { IRemoteAdapter, DownloadResult } from '../src/interfaces/IRemoteAdapter';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import { GroupMember } from '../src/types';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';
import crypto from 'crypto';

// --- Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

describe('BankyManager Integration & Sharing Tests', () => {
    const mockRemotes: Record<string, Record<string, Uint8Array>> = {};

    function factory(userId: string) {
        if (!mockRemotes[userId]) mockRemotes[userId] = {};
        const remote = mockRemotes[userId];

        return {
            uploadFile: async (path: string, data: Uint8Array) => {
                remote[path] = data;
                return 'etag-' + Math.random();
            },
            downloadFile: async (path: string): Promise<DownloadResult | null> => {
                if (remote[path]) return { data: remote[path], etag: 'etag' };
                return null;
            },
            getFileHash: async (path: string) => null,
            getFileEtag: async (path: string) => null
        } as IRemoteAdapter;
    }

    async function setupUser(userId: string, password = 'password') {
        const config = {
            paths: { appId: 'banky-integration', userId, storeId: 'main' },
            password,
            debug: true
        };

        const sov = new SovereignS3nc(config, factory(userId), factory);
        (sov as any).storage = new IndexedDBStorage(`db_banky_${userId}_${Math.random()}`);
        await sov.init();
        const banky = new BankyManager(sov);
        return { sov, banky, userId };
    }

    test('Share bank account between parent and child', async () => {
        const parent = await setupUser('parent');
        const child = await setupUser('child');

        // 1. Parent creates a shared group for the account
        const members: GroupMember[] = [
            { userId: 'parent', publicKey: parent.sov.getConfig().publicEncryptionKey!, role: 'owner' },
            { userId: 'child', publicKey: child.sov.getConfig().publicEncryptionKey!, role: 'member' }
        ];
        const sharedGroup = await parent.sov.createGroup('Kids Savings', members);

        // 2. Parent initializes the account metadata locally
        // In Banky-Sov, the group itself acts as the context, but let's record an initial transaction
        await parent.banky.addTransaction(sharedGroup.id, 'Initial Deposit', 100.0, 'deposit', undefined, sharedGroup.id, sharedGroup.sharedKey);
        await parent.sov.sync();

        // 3. Child joins the group (gets invite via some channel)
        await child.sov.joinGroup(sharedGroup);
        await child.sov.respondToGroup(sharedGroup.id, 'joined');
        await child.sov.sync(); // Sync to upload their status and pull parent's data

        // 4. Child views transactions
        const today = new Date().toISOString().split('T')[0];
        const childTxs = await child.banky.getTransactions(sharedGroup.id, 5, sharedGroup.id);
        expect(childTxs.length).toBe(1);
        expect(childTxs[0].amount).toBe(100.0);
        expect(childTxs[0].description).toBe('Initial Deposit');
        expect(childTxs[0].userId).toBe('parent');

        // 5. Child spends money
        await child.banky.addTransaction(sharedGroup.id, 'Bought Toy', -25.0, 'spending', undefined, sharedGroup.id, sharedGroup.sharedKey);
        await child.sov.sync();

        // 6. Parent syncs and sees the update
        await parent.sov.sync();
        const parentTxs = await parent.banky.getTransactions(sharedGroup.id, 5, sharedGroup.id);
        
        expect(parentTxs.length).toBe(2);
        
        // Sorting is descending by timestamp
        expect(parentTxs[0].amount).toBe(-25.0);
        expect(parentTxs[0].userId).toBe('child');
        
        expect(parentTxs[1].amount).toBe(100.0);
        expect(parentTxs[1].userId).toBe('parent');
    });

    test('Share bank account between parent and child with auto-discovery', async () => {
        const parent = await setupUser('parent');
        const child = await setupUser('child');

        // 1. Parent follows child, child follows parent
        await parent.sov.follow('child');
        await child.sov.follow('parent');

        // 2. Parent creates an account and adds transactions
        const acc = await parent.banky.createAccount('College Fund');
        await parent.banky.addTransaction(acc.id, 'Saving for college', 500.0, 'deposit');
        await parent.sov.sync();

        // 3. Parent shares with child
        const members: GroupMember[] = [
            { userId: 'parent', publicKey: parent.sov.getConfig().publicEncryptionKey!, role: 'owner', status: 'joined' },
            { userId: 'child', publicKey: child.sov.getConfig().publicEncryptionKey!, role: 'member', status: 'pending' }
        ];
        const group = await parent.sov.createGroup(`Shared Account: ${acc.name}`, members);
        await parent.banky.linkAccountToGroup(acc.id, group.id);
        await parent.banky.publishTransactionsToGroup(acc.id, group.id, group.sharedKey);

        // Send DM invite (mimicking App.tsx handleShareAccount)
        const sharedSecret = parent.sov.deriveSharedSecret(child.sov.getConfig().publicEncryptionKey!);
        const message = { 
            id: 'invite-1', 
            content: `INVITE_GROUP:${JSON.stringify(group)}`, 
            timestamp: Date.now(), 
            senderId: 'parent', 
            recipientId: 'child' 
        };
        const encrypted = await parent.sov.encrypt(new TextEncoder().encode(JSON.stringify(message)), sharedSecret);
        
        const dateStr = new Date().toISOString().split('T')[0];
        const dmPath = `public/modules/social/dms/child/${dateStr}.db`;
        const SQL = await (globalThis as any).initSqlJs();
        const db = new SQL.Database();
        db.exec(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, encrypted_data BLOB);`);
        db.run('INSERT INTO messages (id, encrypted_data) VALUES (?, ?)', ['invite-1', encrypted]);
        await parent.sov.getStorage().saveFile(dmPath, db.export());
        db.close();

        await parent.sov.sync();

        // 4. Child syncs to get the DM
        await child.sov.sync();

        // 5. Child runs "auto-join" logic (mimicking loadData in App.tsx)
        const following = await child.sov.getFollowing();
        const dates = [dateStr];
        for (const user of following) {
            if (!user.publicKey) continue;
            const secret = child.sov.deriveSharedSecret(user.publicKey);
            const myId = 'child';
            for (const d of dates) {
                const localDmPath = `followed/${user.userId}/modules/social/dms/${myId}/${d}.db`;
                const data = await child.sov.getStorage().getFile(localDmPath);
                if (data) {
                    const db2 = new SQL.Database(data);
                    const res = db2.exec('SELECT encrypted_data FROM messages');
                    for (const row of res[0].values) {
                        const decrypted = await child.sov.decrypt(row[0] as Uint8Array, secret);
                        const msg = JSON.parse(new TextDecoder().decode(decrypted));
                        if (msg.content.startsWith('INVITE_GROUP:')) {
                            const groupInfo = JSON.parse(msg.content.substring(13));
                            await child.sov.joinGroup(groupInfo);
                            await child.sov.respondToGroup(groupInfo.id, 'joined');
                        }
                    }
                    db2.close();
                }
            }
        }
        await child.sov.sync();

        // 6. Child should now see the shared account and transactions
        const sharedAccounts = await child.sov.getGroups();
        console.log('Child shared accounts count:', sharedAccounts.length);
        expect(sharedAccounts.length).toBe(1);
        expect(sharedAccounts[0].name).toBe('Shared Account: College Fund');

        const txs = await child.banky.getTransactions(group.id, 5, group.id);
        console.log('Child seen transactions:', txs.length);
        expect(txs.length).toBe(1);
        expect(txs[0].description).toBe('Saving for college');

        // 7. Child adds a transaction to the shared account
        await child.banky.addTransaction(group.id, 'Spent on books', -50.0, 'education', undefined, group.id, group.sharedKey);
        await child.sov.sync();

        // 8. Parent syncs and should see both transactions
        await parent.sov.sync();
        const parentTxs = await parent.banky.getTransactions(group.id, 5, group.id);
        console.log('Parent seen transactions:', parentTxs.length);
        expect(parentTxs.length).toBe(2);
        expect(parentTxs[0].description).toBe('Spent on books');
        expect(parentTxs[1].description).toBe('Saving for college');
    });
});
