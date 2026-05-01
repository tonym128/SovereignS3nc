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
const Moderation_1 = require("../src/modules/Moderation");
const Feed_1 = require("../src/modules/Feed");
const IndexedDBStorage_1 = require("../src/adapters/IndexedDBStorage");
const crypto_1 = __importDefault(require("crypto"));
const fake_indexeddb_1 = require("fake-indexeddb");
const sql_js_1 = __importDefault(require("sql.js"));
const fs = __importStar(require("fs"));
// --- Browser Polyfills ---
globalThis.indexedDB = new fake_indexeddb_1.IDBFactory();
globalThis.crypto = crypto_1.default.webcrypto;
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
globalThis.initSqlJs = sql_js_1.default;
const configPath = 'demo/social/config.json';
const adminConfigPath = 'demo/social/admin_config.json';
const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const adminConfig = JSON.parse(fs.readFileSync(adminConfigPath, 'utf8'));
describe('Moderation Surgical Deletion Sync Integration Tests', () => {
    let adminSov;
    let userSov;
    let adminMod;
    let userFeed;
    const appId = 'mod-sync-test-' + Math.random().toString(36).substring(7);
    beforeAll(async () => {
        // Setup Admin
        adminSov = new SovereignS3nc_1.SovereignS3nc({
            s3: { ...adminConfig, appId },
            paths: { appId, userId: 'admin-user', storeId: 'social' },
            password: 'admin-password',
            debug: true
        });
        adminSov.storage = new IndexedDBStorage_1.IndexedDBStorage(`admin_db_${appId}`);
        await adminSov.init();
        adminMod = new Moderation_1.ModerationModule(adminSov);
        await adminMod.publishAdminKey();
        // Setup User
        userSov = new SovereignS3nc_1.SovereignS3nc({
            s3: { ...userConfig, appId },
            paths: { appId, userId: 'regular-user', storeId: 'social' },
            password: 'user-password',
            debug: true
        });
        userSov.storage = new IndexedDBStorage_1.IndexedDBStorage(`user_db_${appId}`);
        await userSov.init();
        userFeed = new Feed_1.FeedModule(userSov);
        // Initial sync to exchange keys
        await adminSov.sync();
        await userSov.sync();
    }, 30000);
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
        // 3. User syncs. This should:
        // - Download the request file
        // - Detect and process it
        // - Delete the post from local SQLite
        // - Re-upload the SQLite DB
        await userSov.sync();
        // 4. Verify post is deleted locally
        posts = await userFeed.getPosts(today, 'public');
        expect(posts.length).toBe(1);
        expect(posts[0].id).toBe(postToKeep.id);
        expect(posts.find(p => p.id === postToDelete.id)).toBeUndefined();
        // 5. Verify the DB on S3 is also updated (re-uploaded)
        const observerSov = new SovereignS3nc_1.SovereignS3nc({
            s3: { ...userConfig, appId },
            paths: { appId, userId: 'observer-user', storeId: 'social' },
            password: 'observer-password'
        });
        observerSov.storage = new IndexedDBStorage_1.IndexedDBStorage(`observer_db_${appId}`);
        await observerSov.init();
        await observerSov.follow('regular-user');
        await observerSov.sync();
        const observerFeed = new Feed_1.FeedModule(observerSov);
        const observerPosts = await observerFeed.getPosts(`regular-user/${today}`, 'followed');
        expect(observerPosts.length).toBe(1);
        expect(observerPosts[0].id).toBe(postToKeep.id);
    }, 60000);
});
//# sourceMappingURL=ModerationSync.integration.js.map