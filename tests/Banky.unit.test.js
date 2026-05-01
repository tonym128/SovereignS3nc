"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const SovereignS3nc_1 = require("../src/SovereignS3nc");
const Banky_1 = require("../demo/banky/src/Banky");
const crypto_1 = __importDefault(require("crypto"));
const fake_indexeddb_1 = require("fake-indexeddb");
const sql_js_1 = __importDefault(require("sql.js"));
// --- Polyfills ---
global.indexedDB = new fake_indexeddb_1.IDBFactory();
global.crypto = crypto_1.default.webcrypto;
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.initSqlJs = sql_js_1.default;
class MockRemote {
    constructor() {
        this.files = new Map();
    }
    async uploadFile(path, data, hash, metadata) {
        const h = hash || crypto_1.default.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: h, etag });
        return etag;
    }
    async downloadFile(path) {
        const entry = this.files.get(path);
        return entry ? { data: entry.data, etag: entry.etag } : null;
    }
    async getFileHash(path) { return this.files.get(path)?.hash || null; }
    async getFileEtag(path) { return this.files.get(path)?.etag || null; }
    async getFileMetadata(path, key) { return null; }
    async canWrite(path) { return true; }
    async listFiles(prefix) {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path) { this.files.delete(path); }
    async purge() { this.files.clear(); }
}
describe('BankyManager Unit Tests', () => {
    let sov;
    let banky;
    let mockRemote;
    beforeEach(async () => {
        global.indexedDB = new fake_indexeddb_1.IDBFactory();
        mockRemote = new MockRemote();
        const config = {
            paths: { appId: 'banky-test', userId: 'alice', storeId: 'main' },
            password: 'password123',
            debug: false
        };
        sov = new SovereignS3nc_1.SovereignS3nc(config, mockRemote);
        await sov.init();
        banky = new Banky_1.BankyManager(sov);
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
//# sourceMappingURL=Banky.unit.test.js.map