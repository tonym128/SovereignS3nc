
import { SovereignS3nc } from '../src/SovereignS3nc';
import { BankyManager, BankAccount, Transaction } from '../demo/banky/src/Banky';
import { MessagingModule } from '../src/modules/Messaging';
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
            getFileHash: async (path: string) => {
                if (!remote[path]) return null;
                return crypto.createHash('sha256').update(remote[path]).digest('hex');
            },
            getFileEtag: async (path: string) => remote[path] ? 'etag' : null
        } as IRemoteAdapter;
    }

    async function setupUser(userId: string, password = 'password') {
        const config = {
            paths: { appId: 'banky-integration', userId, storeId: 'main' },
            password,
            debug: true
        };

        const sov = new SovereignS3nc(config, factory(userId), factory);
        // Use consistent DB per user but unique for the test run
        (sov as any).storage = new IndexedDBStorage(`db_banky_${userId}_${Math.random()}`);
        await sov.init();
        const banky = new BankyManager(sov);
        const messaging = new MessagingModule(sov);
        return { sov, banky, messaging, userId };
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
        await parent.banky.addTransaction(sharedGroup.id, 'Initial Deposit', 100.0, 'deposit', undefined, sharedGroup.id, sharedGroup.sharedKey);
        await parent.sov.sync();

        // 3. Child joins the group
        await child.sov.joinGroup(sharedGroup);
        await child.sov.respondToGroup(sharedGroup.id, 'joined');
        await child.sov.sync(); 

        // 4. Child views transactions
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
        expect(parentTxs[0].amount).toBe(-25.0);
        expect(parentTxs[1].amount).toBe(100.0);
    });

    test('Share bank account between parent and child with auto-discovery', async () => {
        const parent = await setupUser('parent');
        const child = await setupUser('child');

        // 1. Initial sync to register users
        await parent.sov.sync();
        await child.sov.sync();

        // 2. Parent follows child, child follows parent
        await parent.sov.follow('child');
        await child.sov.follow('parent');

        // 3. Parent creates an account and adds transactions
        const acc = await parent.banky.createAccount('College Fund');
        await parent.banky.addTransaction(acc.id, 'Saving for college', 500.0, 'deposit');
        await parent.sov.sync();

        // 4. Parent shares with child
        const members: GroupMember[] = [
            { userId: 'parent', publicKey: parent.sov.getConfig().publicEncryptionKey!, role: 'owner', status: 'joined' },
            { userId: 'child', publicKey: child.sov.getConfig().publicEncryptionKey!, role: 'member', status: 'pending' }
        ];
        const group = await parent.sov.createGroup(`Shared Account: ${acc.name}`, members);
        await parent.banky.linkAccountToGroup(acc.id, group.id);
        await parent.banky.publishTransactionsToGroup(acc.id, group.id, group.sharedKey);

        // Send DM invite using MessagingModule
        await parent.messaging.sendDirectMessage('child', `INVITE_GROUP:${JSON.stringify(group)}`);
        await parent.sov.sync();

        // 5. Child syncs to get the DM
        await child.sov.sync();

        // 6. Child runs "auto-join" logic using MessagingModule
        const inbox = await child.messaging.getInboxMessages(2);
        let inviteFound = false;
        for (const msg of inbox) {
            if (msg.content.startsWith('INVITE_GROUP:')) {
                const groupInfo = JSON.parse(msg.content.substring(13));
                if (groupInfo.id === group.id) {
                    await child.sov.joinGroup(groupInfo);
                    await child.sov.respondToGroup(groupInfo.id, 'joined');
                    inviteFound = true;
                }
            }
        }
        expect(inviteFound).toBe(true);
        await child.sov.sync();

        // 7. Child should now see the shared account and transactions
        const sharedAccounts = await child.sov.getGroups();
        expect(sharedAccounts.length).toBe(1);
        expect(sharedAccounts[0].name).toBe('Shared Account: College Fund');

        const txs = await child.banky.getTransactions(group.id, 5, group.id);
        expect(txs.length).toBe(1);
        expect(txs[0].description).toBe('Saving for college');

        // 8. Child adds a transaction to the shared account
        await child.banky.addTransaction(group.id, 'Spent on books', -50.0, 'education', undefined, group.id, group.sharedKey);
        await child.sov.sync();

        // 9. Parent syncs and should see both transactions
        await parent.sov.sync();
        const parentTxs = await parent.banky.getTransactions(group.id, 5, group.id);
        expect(parentTxs.length).toBe(2);
        expect(parentTxs.find(t => t.description === 'Spent on books')).toBeDefined();
        expect(parentTxs.find(t => t.description === 'Saving for college')).toBeDefined();
    });
});
