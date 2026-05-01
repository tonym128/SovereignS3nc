"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const SovereignS3nc_1 = require("../src/SovereignS3nc");
const IndexedDBStorage_1 = require("../src/adapters/IndexedDBStorage");
const Moderation_1 = require("../src/modules/Moderation");
const crypto_1 = __importDefault(require("crypto"));
const fake_indexeddb_1 = require("fake-indexeddb");
const sql_js_1 = __importDefault(require("sql.js"));
// --- Browser Polyfills ---
globalThis.indexedDB = new fake_indexeddb_1.IDBFactory();
globalThis.crypto = crypto_1.default.webcrypto;
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
globalThis.initSqlJs = sql_js_1.default;
class MockRemote {
    constructor(prefix = '') {
        this.prefix = prefix;
        this.files = new Map();
    }
    async uploadFile(path, data, hash) {
        const h = hash || crypto_1.default.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(this.prefix + path, { data, hash: h, etag });
        return etag;
    }
    async downloadFile(path, ifNoneMatch) {
        const f = this.files.get(this.prefix + path);
        if (!f)
            return null;
        if (ifNoneMatch === f.etag)
            return { data: f.data, etag: f.etag, notModified: true };
        return f;
    }
    async getFileHash(path) {
        return this.files.get(this.prefix + path)?.hash || null;
    }
    async getFileEtag(path) {
        return this.files.get(this.prefix + path)?.etag || null;
    }
    async listFiles(prefix) {
        return Array.from(this.files.keys())
            .filter(k => k.startsWith(this.prefix + prefix))
            .map(k => k.substring(this.prefix.length));
    }
    async deleteFile(path) {
        this.files.delete(this.prefix + path);
    }
    async canWrite(path) {
        return true;
    }
}
describe('SovereignS3nc Extra Coverage Tests', () => {
    let sov;
    let remote;
    const appId = 'extra-test';
    const userId = 'user-1';
    beforeEach(async () => {
        remote = new MockRemote(appId + '/' + userId + '/social/');
        sov = new SovereignS3nc_1.SovereignS3nc({
            paths: { appId, userId, storeId: 'social' },
            password: 'password',
            debug: false
        }, remote);
        sov.storage = new IndexedDBStorage_1.IndexedDBStorage(`db_${Math.random()}`);
        await sov.init();
    });
    test('Conflict Resolution: User chooses remote', async () => {
        const today = SovereignS3nc_1.SovereignS3nc.getDateStr(new Date());
        const path = `public/${today}.db`;
        // 1. Create local data
        await sov.getStorage().saveDailyDb(today, 'public', new Uint8Array([1, 2, 3]));
        // 2. Create different remote data and set sync hash to trigger conflict
        const remoteData = new Uint8Array([4, 5, 6]);
        const remoteHash = crypto_1.default.createHash('sha256').update(remoteData).digest('hex');
        const oldHash = crypto_1.default.createHash('sha256').update(new Uint8Array([0, 0, 0])).digest('hex');
        await remote.uploadFile(path, remoteData, remoteHash);
        await sov.getStorage().setGenericRemoteHashCache(`sync_hash:${path}`, oldHash);
        // 3. Listen for conflict and resolve with 'remote'
        sov.on('conflict', (event) => {
            sov.resolveConflict(event.id, 'remote');
        });
        await sov.sync();
        // 4. Verify local data matches remote
        const localData = await sov.getStorage().getDailyDb(today, 'public');
        expect(localData).toEqual(remoteData);
    });
    test('Moderation: Admin export and burn', async () => {
        const mod = new Moderation_1.ModerationModule(sov);
        // Mock rootRemote
        const rootRemote = new MockRemote(appId + '/');
        sov.rootRemote = rootRemote;
        // Add some data to root
        await rootRemote.uploadFile('user-1/social/public/test.txt', new TextEncoder().encode('hello'));
        // Test Export
        const exportJson = await mod.exportAllData();
        const parsed = JSON.parse(exportJson);
        expect(parsed['user-1/social/public/test.txt']).toBeDefined();
        // Test Burn
        await mod.burnItToTheGround();
        const filesAfter = await rootRemote.listFiles('');
        expect(filesAfter.length).toBe(0);
    });
    test('Encryption/Decryption Edge Cases', async () => {
        const data = new TextEncoder().encode('Secret message');
        const key = crypto_1.default.randomBytes(32).toString('hex');
        const encrypted = await sov.encrypt(data, key);
        const decrypted = await sov.decrypt(encrypted, key);
        expect(new TextDecoder().decode(decrypted)).toBe('Secret message');
        // Wrong key
        const wrongKey = crypto_1.default.randomBytes(32).toString('hex');
        await expect(sov.decrypt(encrypted, wrongKey)).rejects.toThrow();
    });
    test('Shared Secret Derivation', async () => {
        const aliceKeys = nacl.box.keyPair();
        const bobKeys = nacl.box.keyPair();
        const aliceSov = new SovereignS3nc_1.SovereignS3nc({
            paths: { appId: 'test', userId: 'alice', storeId: 'test' },
            debug: false
        }, undefined, undefined, {
            privateKey: Buffer.from(aliceKeys.secretKey).toString('hex'),
            publicKey: Buffer.from(aliceKeys.publicKey).toString('hex')
        });
        const bobSov = new SovereignS3nc_1.SovereignS3nc({
            paths: { appId: 'test', userId: 'bob', storeId: 'test' },
            debug: false
        }, undefined, undefined, {
            privateKey: Buffer.from(bobKeys.secretKey).toString('hex'),
            publicKey: Buffer.from(bobKeys.publicKey).toString('hex')
        });
        const secret1 = aliceSov.deriveSharedSecret(Buffer.from(bobKeys.publicKey).toString('hex'));
        const secret2 = bobSov.deriveSharedSecret(Buffer.from(aliceKeys.publicKey).toString('hex'));
        expect(secret1).toBe(secret2);
    });
});
const nacl = __importStar(require("tweetnacl"));
//# sourceMappingURL=SovereignS3nc_Extra.unit.test.js.map