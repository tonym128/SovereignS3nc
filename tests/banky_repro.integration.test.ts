
import { SovereignS3nc } from '../src/SovereignS3nc';
import { BankyManager, BankAccount, Transaction } from '../demo/banky/src/Banky';
import { ProfileModule } from '../src/modules/Profile';
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

describe('Banky Shared Account Repro', () => {
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
            paths: { appId: 'banky-repro', userId, storeId: 'main' },
            password,
            debug: true
        };

        const sov = new SovereignS3nc(config, factory(userId), factory);
        // Ensure unique IndexedDB per user
        (sov as any).storage = new IndexedDBStorage(`db_repro_${userId}_${Math.random()}`);
        await sov.init();
        const banky = new BankyManager(sov);
        const messaging = new MessagingModule(sov);
        return { sov, banky, messaging, userId };
    }

    test('Shared account should be visible to recipient after invite and sync', async () => {
        const alice = await setupUser('alice');
        const bob = await setupUser('bob');

        // 1. Alice creates an account
        const acc = await alice.banky.createAccount('Joint Account');
        await alice.banky.addTransaction(acc.id, 'Alice Deposit', 1000, 'income');
        await alice.sov.sync();

        // 2. Alice shares with Bob
        const members: GroupMember[] = [
            { userId: 'alice', publicKey: alice.sov.getConfig().publicEncryptionKey!, role: 'owner', status: 'joined' },
            { userId: 'bob', publicKey: bob.sov.getConfig().publicEncryptionKey!, role: 'member', status: 'pending' }
        ];
        const group = await alice.sov.createGroup(`Shared: ${acc.name}`, members);
        await alice.banky.linkAccountToGroup(acc.id, group.id);
        await alice.banky.publishTransactionsToGroup(acc.id, group.id, group.sharedKey);

        // Send invite via MessagingModule (like App.tsx does now)
        await alice.messaging.sendDirectMessage('bob', `INVITE_GROUP:${JSON.stringify(group)}`);
        await alice.sov.sync();

        // 3. Bob syncs to get the invite
        await bob.sov.sync();

        // 4. Bob processes invites (Auto-join logic from App.tsx)
        const inbox = await bob.messaging.getInboxMessages(2);
        let inviteFound = false;
        for (const msg of inbox) {
            if (msg.content.startsWith('INVITE_GROUP:')) {
                const groupInfo = JSON.parse(msg.content.substring(13));
                if (groupInfo.id === group.id) {
                    await bob.sov.joinGroup(groupInfo);
                    await bob.sov.respondToGroup(groupInfo.id, 'joined');
                    inviteFound = true;
                }
            }
        }
        expect(inviteFound).toBe(true);

        // 5. Bob syncs again to pull Alice's group contributions
        await bob.sov.sync();

        // 6. VERIFICATION: Bob should see the group in getGroups()
        const bobsGroups = await bob.sov.getGroups();
        console.log('Bob groups found:', bobsGroups.length);
        expect(bobsGroups.find(g => g.id === group.id)).toBeDefined();

        // 7. VERIFICATION: Bob should see Alice's transaction in the shared account
        const bobsTxs = await bob.banky.getTransactions(group.id, 5, group.id);
        console.log('Bob transactions found:', bobsTxs.length);
        expect(bobsTxs.length).toBe(1);
        expect(bobsTxs[0].description).toBe('Alice Deposit');
    });
});
