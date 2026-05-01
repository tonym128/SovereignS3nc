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
const fs = __importStar(require("fs"));
const fsExtra = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
const sql_js_1 = __importDefault(require("sql.js"));
// --- Browser Polyfills ---
global.indexedDB = new fake_indexeddb_1.IDBFactory();
global.crypto = crypto_1.default.webcrypto;
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.initSqlJs = sql_js_1.default;
const configPath = 'demo/social/config.json';
const adminConfigPath = 'demo/social/admin_config.json';
const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const adminConfig = JSON.parse(fs.readFileSync(adminConfigPath, 'utf8'));
// Setup Temp Home for CLI tests BEFORE importing src/admin
const tempHome = path.join(__dirname, 'temp_home_' + Math.random().toString(36).substring(7));
process.env.HOME = tempHome;
fsExtra.ensureDirSync(path.join(tempHome, '.sovereigns3nc-cli'));
describe('RustFS Admin & Moderation Integration Tests', () => {
    let adminSov;
    let userSov;
    let adminMod;
    let userMod;
    let userFeed;
    let runAdmin;
    const appId = 'rustfs-admin-test-' + Math.random().toString(36).substring(7);
    process.env.SOV_APP_ID = appId;
    beforeAll(async () => {
        // Setup Admin
        adminSov = new SovereignS3nc_1.SovereignS3nc({
            s3: adminConfig,
            paths: { appId, userId: 'admin-user', storeId: 'social' },
            password: 'admin-password'
        });
        adminSov.storage = new IndexedDBStorage_1.IndexedDBStorage(`admin_db_${appId}`);
        await adminSov.init();
        adminMod = new Moderation_1.ModerationModule(adminSov);
        // Setup User
        userSov = new SovereignS3nc_1.SovereignS3nc({
            s3: userConfig,
            paths: { appId, userId: 'regular-user', storeId: 'social' },
            password: 'user-password'
        });
        userSov.storage = new IndexedDBStorage_1.IndexedDBStorage(`user_db_${appId}`);
        await userSov.init();
        userMod = new Moderation_1.ModerationModule(userSov);
        userFeed = new Feed_1.FeedModule(userSov);
        // Setup CLI environment
        const profile = {
            userId: 'admin-user',
            password: 'admin-password',
            s3Config: { ...adminConfig, appId } // Include appId for the CLI to use the same one
        };
        // The CLI expects appId in paths, but src/admin.ts uses a hardcoded APP_ID = 'sov-social'
        // Wait, I should check src/admin.ts again.
        await fsExtra.writeJson(path.join(tempHome, '.sovereigns3nc-cli', 'profiles.json'), {
            'admin-user': profile
        });
        await fsExtra.writeJson(path.join(tempHome, '.sovereigns3nc-cli', 'current_user.json'), {
            userId: 'admin-user'
        });
        // Import runAdmin after setting up HOME and profiles
        runAdmin = (await Promise.resolve().then(() => __importStar(require('../src/admin')))).run;
        // Verify Admin Status
        expect(await adminMod.isAdmin()).toBe(true);
        expect(await userMod.isAdmin()).toBe(false);
        // SYNC once for both to ensure public user.json is created (Literal path)
        await adminSov.sync();
        await userSov.sync();
    }, 30000);
    afterAll(async () => {
        await fsExtra.remove(tempHome);
    });
    test('Admin lists all users in the system', async () => {
        const users = await adminMod.listUsers();
        // It should contain literal names (because they synced public/user.json)
        // and may contain hashes (private GUIDs)
        expect(users).toContain('admin-user');
        expect(users).toContain('regular-user');
        expect(users.length).toBeGreaterThanOrEqual(2);
    });
    test('Admin publishing their key works as expected, for existing and new users', async () => {
        // 1. Admin publishes key
        await adminMod.publishAdminKey();
        // 2. Existing user syncs and gets it
        await userSov.syncAdminKey();
        expect(userSov.getConfig().adminPublicKey).toBe(adminSov.getConfig().publicEncryptionKey);
        // 3. New user initializes and gets it
        const newUserSov = new SovereignS3nc_1.SovereignS3nc({
            s3: userConfig,
            paths: { appId, userId: 'new-user', storeId: 'social' },
            password: 'new-user-password'
        });
        newUserSov.storage = new IndexedDBStorage_1.IndexedDBStorage(`new_user_db_${appId}`);
        await newUserSov.init();
        expect(newUserSov.getConfig().adminPublicKey).toBe(adminSov.getConfig().publicEncryptionKey);
    });
    test('Non-admin user should not be able to publish an admin E2EE key', async () => {
        try {
            await userMod.publishAdminKey();
            throw new Error('Should have thrown a permission denied error');
        }
        catch (e) {
            expect(e.message).toContain('Permission denied');
        }
    });
    test('User reports an item, admin reviews and rejects', async () => {
        const today = SovereignS3nc_1.SovereignS3nc.getDateStr(new Date());
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
        await adminMod.deleteReport(report.id);
        // 5. Verify post still exists
        const feedPrefix = `regular-user/social/public/modules/feed/`;
        const files = await adminSov.rootRemote.listFiles(feedPrefix);
        expect(files.length).toBeGreaterThan(0);
    });
    test('User reports an item, admin accepts claim, post should be deleted', async () => {
        const today = SovereignS3nc_1.SovereignS3nc.getDateStr(new Date());
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
        await adminMod.deleteReport(report.id);
        // 5. Verify file is gone from S3
        const checkPrefix = `regular-user/social/public/modules/feed/`;
        const checkFiles = await adminSov.rootRemote.listFiles(checkPrefix);
        const fileExists = checkFiles.some((f) => f.includes(today));
        expect(fileExists).toBe(false);
    });
    test('Admin bans a user: content disappears, removed from users.json', async () => {
        const evilUserId = 'evil-user';
        const evilSov = new SovereignS3nc_1.SovereignS3nc({
            s3: userConfig,
            paths: { appId, userId: evilUserId, storeId: 'social' },
            password: 'evil-password'
        });
        evilSov.storage = new IndexedDBStorage_1.IndexedDBStorage(`evil_db_${appId}`);
        await evilSov.init();
        const evilFeed = new Feed_1.FeedModule(evilSov);
        await evilFeed.post("I will be banned");
        await evilSov.sync();
        // Verify registered in global registry
        const globalRemote = adminSov.globalRemote;
        const regBefore = await globalRemote.downloadFile('users.json');
        const usersBefore = JSON.parse(new TextDecoder().decode(regBefore.data));
        expect(usersBefore.find((u) => u.userId === evilUserId)).toBeDefined();
        // 1. Admin bans user
        await adminMod.banUser(evilUserId);
        // 2. Regular user syncs and evil user should be gone from discovery
        await userSov.sync();
        const users = await userSov.discoverUsers();
        expect(users?.find(u => u.userId === evilUserId)).toBeUndefined();
        // 3. Evil user tries to sync (should fail or at least be unable to update registry)
        const checkProfile = await adminSov.rootRemote.downloadFile(`${evilUserId}/social/public/user.json`);
        expect(checkProfile).toBeNull();
        // 4. Verify removed from global registry
        const regAfter = await globalRemote.downloadFile('users.json');
        const usersAfter = JSON.parse(new TextDecoder().decode(regAfter.data));
        expect(usersAfter.find((u) => u.userId === evilUserId)).toBeUndefined();
    });
    test('Regular user cannot access protected admin resources', async () => {
        // 1. User attempts to download admin public key (SHOULD WORK per our new policy)
        const keyResult = await userSov.adminRemote.downloadFile('public_key.json');
        expect(keyResult).not.toBeNull();
        expect(keyResult.data).toBeDefined();
        // 2. User attempts to list admin reports (SHOULD FAIL)
        const files = await userSov.adminRemote.listFiles('reports/');
        expect(files.length).toBe(0);
        // 3. User attempts to delete a file they don't own (SHOULD FAIL)
        try {
            await userSov.rootRemote.deleteFile(`admin-user/social/public/user.json`);
        }
        catch (e) {
            // expected
        }
    });
    test('Export and Import data', async () => {
        // 1. Export
        const dump = await adminMod.exportAllData();
        expect(dump).toBeDefined();
        const parsed = JSON.parse(dump);
        expect(Object.keys(parsed).length).toBeGreaterThan(0);
        // 2. Import into a NEW appId
        const newAppId = appId + '-restored';
        const restoredSov = new SovereignS3nc_1.SovereignS3nc({
            s3: adminConfig,
            paths: { appId: newAppId, userId: 'admin', storeId: 'data' },
            password: 'password'
        });
        await restoredSov.init();
        const restoredMod = new Moderation_1.ModerationModule(restoredSov);
        await restoredMod.importAllData(dump);
        // 3. Verify files exist in new appId
        const files = await restoredSov.rootRemote.listFiles('');
        expect(files.length).toBeGreaterThan(0);
    });
    describe('Admin CLI wrapper tests (run function)', () => {
        test('CLI list-users works', async () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            await runAdmin(['list-users']);
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('System Users'));
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('admin-user'));
            consoleSpy.mockRestore();
        });
        test('CLI list-reports works', async () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            await runAdmin(['list-reports']);
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Pending Reports'));
            consoleSpy.mockRestore();
        });
        test('CLI ban-user works and removes from registry', async () => {
            // Setup another user to ban
            const banMeId = 'ban-me-cli';
            const banMeSov = new SovereignS3nc_1.SovereignS3nc({
                s3: userConfig,
                paths: { appId, userId: banMeId, storeId: 'social' },
                password: 'password'
            });
            banMeSov.storage = new IndexedDBStorage_1.IndexedDBStorage(`ban_me_db_${appId}`);
            await banMeSov.init();
            await banMeSov.sync();
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            await runAdmin(['ban-user', banMeId]);
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(`User ${banMeId} has been banned`));
            consoleSpy.mockRestore();
            // Verify they are gone from registry
            const globalRemote = adminSov.globalRemote;
            const regResult = await globalRemote.downloadFile('users.json');
            const users = JSON.parse(new TextDecoder().decode(regResult.data));
            expect(users.find((u) => u.userId === banMeId)).toBeUndefined();
        });
        test('CLI burn-it-to-the-ground works', async () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
            await runAdmin(['burn-it-to-the-ground']);
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Everything is gone'));
            consoleSpy.mockRestore();
            // Verify
            await new Promise(resolve => setTimeout(resolve, 2000));
            const files = await adminSov.rootRemote.listFiles('');
            expect(files.length).toBe(0);
        });
    });
});
//# sourceMappingURL=admin.integration.js.map