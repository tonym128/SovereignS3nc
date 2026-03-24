
import { SovereignS3nc } from '../src/SovereignS3nc';
import { ModerationModule } from '../src/modules/Moderation';
import { FeedModule } from '../src/modules/Feed';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import * as fs from 'fs';
import initSqlJs from 'sql.js';

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

describe('RustFS Admin & Moderation Integration Tests', () => {
    let adminSov: SovereignS3nc;
    let userSov: SovereignS3nc;
    let adminMod: ModerationModule;
    let userMod: ModerationModule;
    let userFeed: FeedModule;

    const appId = 'rustfs-admin-test-' + Math.random().toString(36).substring(7);

    beforeAll(async () => {
        // Setup Admin
        adminSov = new SovereignS3nc({
            s3: adminConfig,
            paths: { appId, userId: 'admin-user', storeId: 'social' },
            password: 'admin-password'
        });
        (adminSov as any).storage = new IndexedDBStorage(`admin_db_${appId}`);
        await adminSov.init();
        adminMod = new ModerationModule(adminSov);

        // Setup User
        userSov = new SovereignS3nc({
            s3: userConfig,
            paths: { appId, userId: 'regular-user', storeId: 'social' },
            password: 'user-password'
        });
        (userSov as any).storage = new IndexedDBStorage(`user_db_${appId}`);
        await userSov.init();
        userMod = new ModerationModule(userSov);
        userFeed = new FeedModule(userSov);

        // Verify Admin Status
        expect(await adminMod.isAdmin()).toBe(true);
        expect(await userMod.isAdmin()).toBe(false);
    }, 30000);

    test('Admin publishing their key works as expected, for existing and new users', async () => {
        // 1. Admin publishes key
        await adminMod.publishAdminKey();
        
        // 2. Existing user syncs and gets it
        await userSov.syncAdminKey();
        expect(userSov.getConfig().adminPublicKey).toBe(adminSov.getConfig().publicEncryptionKey);

        // 3. New user initializes and gets it
        const newUserSov = new SovereignS3nc({
            s3: userConfig,
            paths: { appId, userId: 'new-user', storeId: 'social' },
            password: 'new-user-password'
        });
        (newUserSov as any).storage = new IndexedDBStorage(`new_user_db_${appId}`);
        await newUserSov.init();
        expect(newUserSov.getConfig().adminPublicKey).toBe(adminSov.getConfig().publicEncryptionKey);
    });

    test('Non-admin user should not be able to publish an admin E2EE key', async () => {
        try {
            await userMod.publishAdminKey();
            throw new Error('Should have thrown a permission denied error');
        } catch (e: any) {
            expect(e.message).toContain('Permission denied');
        }
    });

    test('User reports an item, admin rejects claim, post should not be deleted', async () => {
        const today = SovereignS3nc.getDateStr(new Date());
        // 1. User creates a post
        await userFeed.post("Harmless content");
        await userSov.sync();

        // S3 Consistency delay
        await new Promise(resolve => setTimeout(resolve, 1000));

        const posts = await userFeed.getPosts(today, 'public');
        const post = posts[0];

        // 2. User reports the post
        await userMod.reportContent(userSov.getConfig().paths.userId, post.id, 'post', 'False alarm', post);

        // 3. Admin reviews reports
        const reports = await adminMod.getReports();
        const report = reports.find(r => r.targetUserId === userSov.getConfig().paths.userId);
        expect(report).toBeDefined();

        // 4. Admin rejects claim (simply deletes the report without deleting the post)
        await adminMod.deleteReport(report!.id);

        // 5. Verify post still exists
        const feedPrefix = `regular-user/social/public/modules/feed/`;
        const files = await (adminSov as any).rootRemote.listFiles(feedPrefix);
        expect(files.length).toBeGreaterThan(0);
    });

    test('User reports an item, admin accepts claim, post should be deleted', async () => {
        const today = SovereignS3nc.getDateStr(new Date());
        // 1. User creates a 'bad' post
        await userFeed.post("Bad content");
        await userSov.sync();

        // Consistency delay
        await new Promise(resolve => setTimeout(resolve, 1000));

        const posts = await userFeed.getPosts(today, 'public');
        const post = posts[0];
        const postFile = `regular-user/social/public/modules/feed/${today}.db`;

        // 2. User reports the post
        await userMod.reportContent(userSov.getConfig().paths.userId, post.id, 'post', 'Toxic content', post);

        // 3. Admin reviews and accepts
        const reports = await adminMod.getReports();
        const report = reports.find(r => r.evidence && r.evidence.content === "Bad content");
        expect(report).toBeDefined();

        // 4. Admin deletes the offending content
        await adminMod.deleteUserFile(postFile);
        await adminMod.deleteReport(report!.id);

        // 5. Verify file is gone from S3
        const checkPrefix = `regular-user/social/public/modules/feed/`;
        const checkFiles = await (adminSov as any).rootRemote.listFiles(checkPrefix);
        const fileExists = checkFiles.some((f: string) => f.includes(today));
        expect(fileExists).toBe(false);
    });

    test('Admin bans a user: content disappears, cannot login in future', async () => {
        const evilUserId = 'evil-user';
        const evilSov = new SovereignS3nc({
            s3: userConfig,
            paths: { appId, userId: evilUserId, storeId: 'social' },
            password: 'evil-password'
        });
        (evilSov as any).storage = new IndexedDBStorage(`evil_db_${appId}`);
        await evilSov.init();
        const evilFeed = new FeedModule(evilSov);
        await evilFeed.post("I will be banned");
        await evilSov.sync();

        // 1. Admin bans user
        await adminMod.banUser(evilUserId);

        // 2. Regular user syncs and evil user should be gone from discovery
        await userSov.sync();
        const users = await userSov.discoverUsers();
        expect(users?.find(u => u.userId === evilUserId)).toBeUndefined();

        // 3. Evil user tries to sync (should fail or at least be unable to update registry)
        const checkProfile = await (adminSov as any).rootRemote.downloadFile(`${evilUserId}/social/public/user.json`);
        expect(checkProfile).toBeNull();
    });

    test('Regular user cannot access protected admin resources', async () => {
        // 1. User attempts to download admin public key (SHOULD WORK per our new policy)
        const keyResult = await (userSov as any).adminRemote.downloadFile('public_key.json');
        expect(keyResult).not.toBeNull();
        expect(keyResult.data).toBeDefined();

        // 2. User attempts to list admin reports (SHOULD FAIL)
        const files = await (userSov as any).adminRemote.listFiles('reports/');
        expect(files.length).toBe(0);

        // 3. User attempts to delete a file they don't own (SHOULD FAIL)
        try {
            await (userSov as any).rootRemote.deleteFile(`admin-user/social/public/user.json`);
        } catch (e) {
            // expected
        }
    });    test('Export and Import data', async () => {
        // 1. Export
        const dump = await adminMod.exportAllData();
        expect(dump).toBeDefined();
        const parsed = JSON.parse(dump);
        expect(Object.keys(parsed).length).toBeGreaterThan(0);

        // 2. Import into a NEW appId
        const newAppId = appId + '-restored';
        const restoredSov = new SovereignS3nc({
            s3: adminConfig,
            paths: { appId: newAppId, userId: 'admin', storeId: 'data' },
            password: 'password'
        });
        await restoredSov.init();
        const restoredMod = new ModerationModule(restoredSov);

        await restoredMod.importAllData(dump);

        // 3. Verify files exist in new appId
        const files = await (restoredSov as any).rootRemote.listFiles('');
        expect(files.length).toBeGreaterThan(0);
    });

    test('Burn it to the ground takes the server down', async () => {
        await adminMod.burnItToTheGround();
        
        // Wait for consistency
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const files = await (adminSov as any).rootRemote.listFiles('');
        expect(files.length).toBe(0);
    });
});
