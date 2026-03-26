
import { SovereignS3nc } from '../src/SovereignS3nc';
import { ModerationModule } from '../src/modules/Moderation';
import { FeedModule } from '../src/modules/Feed';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';
import * as fs from 'fs';

// --- Browser Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

const configPath = 'demo/social/config.json';
const adminConfigPath = 'demo/social/admin_config.json';
const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const adminConfig = JSON.parse(fs.readFileSync(adminConfigPath, 'utf8'));

describe('Moderation Surgical Deletion Sync Integration Tests', () => {
    let adminSov: SovereignS3nc;
    let userSov: SovereignS3nc;
    let adminMod: ModerationModule;
    let userFeed: FeedModule;
    const appId = 'mod-sync-test-' + Math.random().toString(36).substring(7);

    beforeAll(async () => {
        // Setup Admin
        adminSov = new SovereignS3nc({
            s3: { ...adminConfig, appId },
            paths: { appId, userId: 'admin-user', storeId: 'social' },
            password: 'admin-password'
        });
        (adminSov as any).storage = new IndexedDBStorage(`admin_db_${appId}`);
        await adminSov.init();
        adminMod = new ModerationModule(adminSov);
        await adminMod.publishAdminKey();

        // Setup User
        userSov = new SovereignS3nc({
            s3: { ...userConfig, appId },
            paths: { appId, userId: 'regular-user', storeId: 'social' },
            password: 'user-password'
        });
        (userSov as any).storage = new IndexedDBStorage(`user_db_${appId}`);
        await userSov.init();
        userFeed = new FeedModule(userSov);

        // Initial sync to exchange keys
        await adminSov.sync();
        await userSov.sync();
    }, 30000);

    test('Admin requests surgical deletion, user syncs and deletes it', async () => {
        const today = SovereignS3nc.getDateStr(new Date());
        
        // 1. User creates two posts
        await userFeed.post("Post to keep");
        await userFeed.post("Post to delete");
        
        await userSov.sync();
        
        // Verify posts exist locally
        let posts = await userFeed.getPosts(today, 'public');
        expect(posts.length).toBe(2);
        const postToDelete = posts.find(p => p.content === "Post to delete")!;
        const postToKeep = posts.find(p => p.content === "Post to keep")!;

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
        const observerSov = new SovereignS3nc({
            s3: { ...userConfig, appId },
            paths: { appId, userId: 'observer-user', storeId: 'social' },
            password: 'observer-password'
        });
        (observerSov as any).storage = new IndexedDBStorage(`observer_db_${appId}`);
        await observerSov.init();
        
        await observerSov.follow('regular-user');
        await observerSov.sync();
        
        const observerFeed = new FeedModule(observerSov);
        const observerPosts = await observerFeed.getPosts(`regular-user/${today}`, 'followed');
        
        expect(observerPosts.length).toBe(1);
        expect(observerPosts[0].id).toBe(postToKeep.id);
    }, 60000);
});
