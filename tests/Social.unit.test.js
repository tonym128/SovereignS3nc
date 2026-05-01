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
const Profile_1 = require("../src/modules/Profile");
const Messaging_1 = require("../src/modules/Messaging");
const Feed_1 = require("../src/modules/Feed");
const crypto_1 = __importDefault(require("crypto"));
const nacl = __importStar(require("tweetnacl"));
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
    async uploadFile(path, data, hash) {
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
    async canWrite(path) { return true; }
    async listFiles(prefix) {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path) { this.files.delete(path); }
}
describe('Granular Module Unit Tests', () => {
    let sov;
    let profile;
    let messaging;
    let feed;
    let mockRemote;
    beforeEach(async () => {
        global.indexedDB = new fake_indexeddb_1.IDBFactory();
        mockRemote = new MockRemote();
        const config = {
            paths: { appId: 'social-test', userId: 'alice', storeId: 'main' },
            password: 'password123',
            debug: false
        };
        sov = new SovereignS3nc_1.SovereignS3nc(config, mockRemote);
        await sov.init();
        profile = new Profile_1.ProfileModule(sov);
        messaging = new Messaging_1.MessagingModule(sov);
        feed = new Feed_1.FeedModule(sov);
    });
    describe('Database Management (Feed)', () => {
        test('should initialize schema in namespaced path', async () => {
            const today = new Date().toISOString().split('T')[0];
            const db = await feed.getDb(today, 'public');
            const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
            const tableNames = tables[0].values.map((v) => v[0]);
            expect(tableNames).toContain('posts');
            expect(tableNames).toContain('likes');
            db.close();
            // Verify file exists in namespaced path
            const expectedPath = sov.getModulePath('feed', `${today}.db`, 'public');
            const data = await sov.getStorage().getFile(expectedPath);
            expect(data).toBeDefined();
        });
    });
    describe('Posting and Fetching', () => {
        test('should create a namespaced public post', async () => {
            await feed.post('Hello Namespaced World', true);
            const today = new Date().toISOString().split('T')[0];
            const posts = await feed.getPosts(today, 'public');
            expect(posts.length).toBe(1);
            expect(posts[0].content).toBe('Hello Namespaced World');
        });
        test('should create a namespaced private post', async () => {
            await feed.post('Secret namespaced thoughts', false);
            const today = new Date().toISOString().split('T')[0];
            const posts = await feed.getPosts(today, 'private');
            expect(posts.length).toBe(1);
            expect(posts[0].content).toBe('Secret namespaced thoughts');
        });
    });
    describe('Direct Messaging', () => {
        test('should send a namespaced DM', async () => {
            const bobPair = nacl.box.keyPair();
            const bobPublicKey = Buffer.from(bobPair.publicKey).toString('hex');
            const registry = [{ userId: 'bob', publicKey: bobPublicKey }];
            await mockRemote.uploadFile('users.json', new TextEncoder().encode(JSON.stringify(registry)));
            await messaging.sendDirectMessage('bob', 'Hello Namespaced Bob');
            const today = new Date().toISOString().split('T')[0];
            const outboxPath = sov.getModulePath('messaging', `dms/outbox/${today}.db`, 'private');
            const outboxData = await sov.getStorage().getFile(outboxPath);
            expect(outboxData).toBeDefined();
            const publicDmPath = sov.getModulePath('messaging', `dms/bob/${today}.db`, 'public');
            const publicDmData = await sov.getStorage().getFile(publicDmPath);
            expect(publicDmData).toBeDefined();
        });
        test('should get namespaced inbox messages', async () => {
            const today = new Date().toISOString().split('T')[0];
            const bobId = 'bob';
            const bobPair = nacl.box.keyPair();
            const bobPublicKey = Buffer.from(bobPair.publicKey).toString('hex');
            const sharedSecret = sov.deriveSharedSecret(bobPublicKey);
            const message = { id: 'msg1', content: 'Hey Namespaced Alice', timestamp: Date.now(), senderId: 'bob', recipientId: 'alice' };
            const encrypted = await sov.encrypt(new TextEncoder().encode(JSON.stringify(message)), sharedSecret);
            const SQL = await global.initSqlJs();
            const db = new SQL.Database();
            db.exec('CREATE TABLE messages (id TEXT PRIMARY KEY, encrypted_data BLOB)');
            db.run('INSERT INTO messages (id, encrypted_data) VALUES (?, ?)', ['msg1', encrypted]);
            const dbData = db.export();
            db.close();
            const myId = sov.getConfig().paths.userId;
            // Test that it can read from both new 'messaging' and legacy 'social' paths
            const localPath = sov.getModulePath('messaging', `${bobId}/dms/${myId}/${today}.db`, 'followed');
            await sov.getStorage().saveFile(localPath, dbData);
            await sov.getStorage().followUser(bobId, today, bobPublicKey);
            const inbox = await messaging.getInboxMessages(1);
            expect(inbox.length).toBe(1);
            expect(inbox[0].content).toBe('Hey Namespaced Alice');
        });
    });
    describe('Profile Management', () => {
        test('should get namespaced followed user profile', async () => {
            const bobId = 'bob';
            const bobProfile = { name: 'Bob Namespaced', bio: 'I build namespaced things', userId: bobId };
            const bobData = new TextEncoder().encode(JSON.stringify(bobProfile));
            const localPath = sov.getModulePath('profile', `${bobId}/profile`, 'followed');
            await sov.getStorage().saveFile(localPath, bobData);
            const p = await profile.getProfile(bobId);
            expect(p.name).toBe('Bob Namespaced');
        });
    });
});
//# sourceMappingURL=Social.unit.test.js.map