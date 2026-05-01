"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const SovereignS3nc_1 = require("../src/SovereignS3nc");
const Moderation_1 = require("../src/modules/Moderation");
const Feed_1 = require("../src/modules/Feed");
const IndexedDBStorage_1 = require("../src/adapters/IndexedDBStorage");
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
    getPath(path) {
        return this.prefix + path;
    }
    async uploadFile(path, data, hash) {
        const fullPath = this.getPath(path);
        console.log(`[MockRemote] Uploading to: ${fullPath}`);
        const h = hash || crypto_1.default.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(fullPath, { data, hash: h, etag });
        return etag;
    }
    async downloadFile(path, ifNoneMatch) {
        const fullPath = this.getPath(path);
        const entry = this.files.get(fullPath);
        if (!entry)
            return null;
        if (ifNoneMatch && ifNoneMatch === entry.etag) {
            return { data: null, etag: entry.etag, notModified: true };
        }
        return { data: entry.data, etag: entry.etag };
    }
    async getFileHash(path) {
        const fullPath = this.getPath(path);
        return this.files.get(fullPath)?.hash || null;
    }
    async getFileEtag(path) {
        const fullPath = this.getPath(path);
        return this.files.get(fullPath)?.etag || null;
    }
    async canWrite(path) {
        return true;
    }
    async listFiles(prefix) {
        const fullPrefix = this.getPath(prefix);
        return Array.from(this.files.keys())
            .filter(k => k.startsWith(fullPrefix))
            .map(k => k.substring(this.prefix.length));
    }
    async deleteFile(path) {
        const fullPath = this.getPath(path);
        this.files.delete(fullPath);
    }
}
describe('Moderation Surgical Deletion Sync Integration Tests', () => {
    let adminSov;
    let userSov;
    let adminMod;
    let userFeed;
    let globalFiles;
    let remoteFactory;
    const appId = 'mod-sync-test';
    beforeAll(async () => {
        globalFiles = new Map();
        remoteFactory = (uid) => {
            // Map system UIDs to their literal folders
            let prefix = appId + '/' + uid + '/';
            if (uid === 'root')
                prefix = appId + '/';
            if (uid === 'admin')
                prefix = appId + '/admin-user/';
            if (uid === 'global')
                prefix = appId + '/global/';
            // For regular users, include storeId
            if (uid === 'admin-user' || uid === 'regular-user' || uid === 'observer-user') {
                prefix = appId + '/' + uid + '/social/';
            }
            // For private IDs (long hashes)
            else if (uid.length > 32) {
                prefix = appId + '/' + uid + '/social/';
            }
            const r = new MockRemote(prefix);
            r.files = globalFiles;
            return r;
        };
        // Setup Admin
        adminSov = new SovereignS3nc_1.SovereignS3nc({
            paths: { appId, userId: 'admin-user', storeId: 'social' },
            password: 'admin-password',
            debug: false
        }, undefined, remoteFactory);
        adminSov.storage = new IndexedDBStorage_1.IndexedDBStorage(`admin_db_${appId}`);
        await adminSov.init();
        adminMod = new Moderation_1.ModerationModule(adminSov);
        await adminMod.publishAdminKey();
        // Setup User
        userSov = new SovereignS3nc_1.SovereignS3nc({
            paths: { appId, userId: 'regular-user', storeId: 'social' },
            password: 'user-password',
            debug: false
        }, undefined, remoteFactory);
        userSov.storage = new IndexedDBStorage_1.IndexedDBStorage(`user_db_${appId}`);
        await userSov.init();
        userFeed = new Feed_1.FeedModule(userSov);
        // Initial sync to exchange keys
        await adminSov.sync();
        await userSov.sync();
    });
    test('Admin requests surgical deletion, user syncs and deletes it', async () => {
        const today = SovereignS3nc_1.SovereignS3nc.getDateStr(new Date());
        // 1. User creates two posts
        await userFeed.post("Post to keep");
        await userFeed.post("Post to delete");
        await userSov.sync();
        // Verify posts exist locally
        let posts = await userFeed.getPosts(today, 'public');
        expect(posts.length).toBe(2);
        const postToDelete = posts.find(p => p.content === "Post to delete");
        const postToKeep = posts.find(p => p.content === "Post to keep");
        // 2. Admin sends deletion request for one post
        await adminMod.requestPostDeletion('regular-user', postToDelete.id, today);
        await adminSov.sync();
        // 3. User syncs.
        await userSov.sync();
        // 4. Verify post is deleted locally
        posts = await userFeed.getPosts(today, 'public');
        expect(posts.length).toBe(1);
        expect(posts[0].id).toBe(postToKeep.id);
        expect(posts.find(p => p.id === postToDelete.id)).toBeUndefined();
        // 5. Verify the DB on Remote is also updated (re-uploaded by user after processing request)
        const observerSov = new SovereignS3nc_1.SovereignS3nc({
            paths: { appId, userId: 'observer-user', storeId: 'social' },
            password: 'observer-password'
        }, undefined, remoteFactory);
        observerSov.storage = new IndexedDBStorage_1.IndexedDBStorage(`observer_db_${appId}`);
        await observerSov.init();
        await observerSov.follow('regular-user');
        await observerSov.sync();
        const observerFeed = new Feed_1.FeedModule(observerSov);
        const observerPosts = await observerFeed.getPosts(`regular-user/${today}`, 'followed');
        expect(observerPosts.length).toBe(1);
        expect(observerPosts[0].id).toBe(postToKeep.id);
    });
});
//# sourceMappingURL=ModerationSync.unit.test.js.map