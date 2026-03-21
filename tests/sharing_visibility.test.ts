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

describe('Sharing Visibility Debug Test', () => {
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
                if (remote[path]) {
                    return crypto.createHash('sha256').update(remote[path]).digest('hex');
                }
                return null;
            },
            getFileEtag: async (path: string) => remote[path] ? 'etag' : null
        } as IRemoteAdapter;
    }

    async function setupUser(userId: string) {
        const config = {
            paths: { appId: 'visibility-test', userId, storeId: 'main' },
            password: 'password',
            debug: true
        };
        const sov = new SovereignS3nc(config, factory(userId), factory);
        (sov as any).storage = new IndexedDBStorage(`db_viz_${userId}_${Math.random()}`);
        await sov.init();
        const banky = new BankyManager(sov);
        return { sov, banky, userId };
    }

    test('Receiver sees shared account and transactions', async () => {
        const alice = await setupUser('alice');
        const bob = await setupUser('bob');

        // 1. Setup following
        await alice.sov.follow('bob');
        await bob.sov.follow('alice');

        // 2. Alice creates account and transactions
        const acc = await alice.banky.createAccount('Shared Ledger');
        await alice.banky.addTransaction(acc.id, 'Alice Deposit', 100, 'income');
        await alice.sov.sync(); // Initial sync to publish key

        // 3. Alice shares with Bob
        const members: GroupMember[] = [
            { userId: 'alice', publicKey: alice.sov.getConfig().publicEncryptionKey!, role: 'owner', status: 'joined' },
            { userId: 'bob', publicKey: bob.sov.getConfig().publicEncryptionKey!, role: 'member', status: 'pending' }
        ];
        const group = await alice.sov.createGroup(`Shared Account: ${acc.name}`, members);
        await alice.banky.linkAccountToGroup(acc.id, group.id);
        await alice.banky.publishTransactionsToGroup(acc.id, group.id, group.sharedKey);
        
        // Alice syncs to publish group data and manifest
        await alice.sov.sync();

        // Check if group file exists in Alice's remote
        const aliceGroupFile = `public/groups/${group.id}/${new Date().toISOString().split('T')[0]}.db`;
        expect(mockRemotes['alice'][aliceGroupFile]).toBeDefined();

        // 4. Bob syncs to discover the group (if we had the auto-join logic in a helper)
        // For this test, we'll manually join Bob to focus on visibility
        await bob.sov.joinGroup(group);
        await bob.sov.respondToGroup(group.id, 'joined');
        
        // Bob syncs to pull Alice's data
        await bob.sov.sync();

        // 5. Verify Bob sees the group
        const bobGroups = await bob.sov.getGroups();
        expect(bobGroups.length).toBe(1);
        expect(bobGroups[0].id).toBe(group.id);

        // 6. Verify Bob sees the transaction
        const bobTxs = await bob.banky.getTransactions(group.id, 5, group.id);
        expect(bobTxs.length).toBe(1);
        expect(bobTxs[0].description).toBe('Alice Deposit');
    });
});
