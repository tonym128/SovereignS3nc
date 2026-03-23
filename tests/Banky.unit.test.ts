import { SovereignS3nc } from '../src/SovereignS3nc';
import { BankyManager, BankAccount, Transaction } from '../demo/banky/src/Banky';
import { IRemoteAdapter, DownloadResult } from '../src/interfaces/IRemoteAdapter';
import crypto from 'crypto';
import * as nacl from 'tweetnacl';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';

// --- Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string, etag: string}> = new Map();
    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: h, etag });
        return etag;
    }
    async downloadFile(path: string): Promise<any | null> {
        const entry = this.files.get(path);
        return entry ? { data: entry.data, etag: entry.etag } : null;
    }
    async getFileHash(path: string): Promise<string | null> { return this.files.get(path)?.hash || null; }
    async getFileEtag(path: string): Promise<string | null> { return this.files.get(path)?.etag || null; }

    async canWrite(path: string): Promise<boolean> { return true; }
    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path: string): Promise<void> { this.files.delete(path); }
}

describe('BankyManager Unit Tests', () => {
    let sov: SovereignS3nc;
    let banky: BankyManager;
    let mockRemote: MockRemote;

    beforeEach(async () => {
        (global as any).indexedDB = new IDBFactory();
        mockRemote = new MockRemote();
        const config = {
            paths: { appId: 'banky-test', userId: 'alice', storeId: 'main' },
            password: 'password123',
            debug: false
        };
        sov = new SovereignS3nc(config, mockRemote);
        await sov.init();
        banky = new BankyManager(sov);
    });

    describe('Database Management & Accounts', () => {
        test('should initialize schema and create account', async () => {
            const acc = await banky.createAccount('My Savings');
            expect(acc.name).toBe('My Savings');
            expect(acc.currency).toBe('USD');
            expect(acc.ownerId).toBe('alice');

            const accounts = await banky.getAccounts();
            expect(accounts.length).toBe(1);
            expect(accounts[0].id).toBe(acc.id);
            expect(accounts[0].name).toBe('My Savings');
        });
    });

    describe('Transactions', () => {
        test('should add and retrieve transactions', async () => {
            const acc = await banky.createAccount('Checking');
            await banky.addTransaction(acc.id, 'Allowance', 10.0, 'allowance');
            await banky.addTransaction(acc.id, 'Candy', -2.5, 'spending');

            const txs = await banky.getTransactions(acc.id, 30);
            expect(txs.length).toBe(2);
            expect(txs[0].amount).toBe(-2.5); // Most recent first due to sorting by timestamp descending
            expect(txs[1].amount).toBe(10.0);
            expect(txs[0].description).toBe('Candy');
            expect(txs[1].description).toBe('Allowance');
        });
    });

    describe('Import from legacy Banky', () => {
        test('should import accounts and transactions from JSON', async () => {
            const legacyData = {
                accounts: {
                    'acc1': {
                        name: 'Legacy Savings',
                        transactions: [
                            { description: 'Gift', amount: 50, category: 'gift' },
                            { description: 'Toy', amount: -15, category: 'spending' }
                        ]
                    }
                }
            };

            await banky.importFromBanky(legacyData);

            const accounts = await banky.getAccounts();
            expect(accounts.length).toBe(1);
            expect(accounts[0].name).toBe('Legacy Savings');

            const txs = await banky.getTransactions(accounts[0].id, 30);
            expect(txs.length).toBe(2);
        });
    });
});
