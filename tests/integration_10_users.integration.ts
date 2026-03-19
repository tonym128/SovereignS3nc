import { SovereignS3nc } from '../src/SovereignS3nc';
import { SocialManager } from '../src/modules/Social';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import * as fs from 'fs';
import initSqlJs from 'sql.js';

// --- Browser Polyfills for Node.js Test Environment ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

// Load config from the dev environment
const configPath = 'demo/social/config.json';
const envConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

describe('Sovereign Social Integration Test (10 Users)', () => {
    const userCount = 10;
    const users: { 
        userId: string; 
        password: string; 
        sov: SovereignS3nc; 
        social: SocialManager;
        displayName: string;
    }[] = [];

    // Helper to setup a user with live S3 connection
    async function setupUser(index: number) {
        const userId = `user_${index}_${Math.random().toString(36).substring(7)}`;
        const password = `pass_${index}`;
        const displayName = `Display Name ${index}`;

        const s3Config = {
            region: envConfig.region,
            endpoint: envConfig.endpoint,
            credentials: {
                accessKeyId: envConfig.accessKeyId,
                secretAccessKey: envConfig.secretAccessKey
            },
            bucketName: envConfig.bucketName
        };

        const config = {
            s3: s3Config,
            paths: { appId: 'integration-test', userId: userId, storeId: 'social' },
            password: password
        };

        // We use a fresh IndexedDB for each user in the test
        const dbName = `test_db_${userId}`;
        const sov = new SovereignS3nc(config);
        // Override storage to use unique DB name to avoid collision in fake-indexeddb
        (sov as any).storage = new IndexedDBStorage(dbName);
        
        await sov.init();
        const social = new SocialManager(sov, '');
        
        return { userId, password, sov, social, displayName };
    }

    beforeAll(async () => {
        console.log(`Setting up ${userCount} users...`);
        for (let i = 1; i <= userCount; i++) {
            const user = await setupUser(i);
            users.push(user);
        }
    }, 30000);

    test('All users can register and sync profiles', async () => {
        for (const user of users) {
            await user.social.updateProfile(user.displayName, `I am user number ${user.userId}`, `avatar_${user.userId}`);
            await user.sov.sync();
        }

        // Verify global registration by checking the registry from the last user
        const registry = await users[userCount - 1].sov.getPublicRegistry();
        for (const user of users) {
            expect(registry.find(u => u.userId === user.userId)).toBeDefined();
        }
    }, 60000);

    test('Friends (Follow/Unfollow) work across all users', async () => {
        // User 0 follows everyone else
        const me = users[0];
        for (let i = 1; i < users.length; i++) {
            await me.sov.follow(users[i].userId);
        }

        const following = await me.sov.getFollowing();
        const currentRunFollowing = following.filter(f => users.some(u => u.userId === f.userId));
        expect(currentRunFollowing.length).toBe(userCount - 1);

        // Verify profile syncing for followed users
        await me.social.syncOtherProfiles();
        for (let i = 1; i < users.length; i++) {
            const profile = await me.social.getProfile(users[i].userId);
            expect(profile.name).toBe(users[i].displayName);
        }
    }, 60000);

    test('Home feed works with posts from followed users', async () => {
        const today = SovereignS3nc.getDateStr(new Date());
        
        // Everyone (except user 0) creates a post
        for (let i = 1; i < users.length; i++) {
            await users[i].social.post(`Hello from ${users[i].userId}! This is my test post.`);
            await users[i].sov.sync();
        }

        // User 0 syncs to see the posts
        const me = users[0];
        await me.sov.sync();

        let allFollowedPosts: any[] = [];
        for (let i = 1; i < users.length; i++) {
            const userPosts = await me.social.getPosts(`${users[i].userId}/${today}`, 'followed');
            allFollowedPosts = [...allFollowedPosts, ...userPosts];
        }

        expect(allFollowedPosts.length).toBe(userCount - 1);
        for (let i = 1; i < users.length; i++) {
            expect(allFollowedPosts.find(p => p.userId === users[i].userId)).toBeDefined();
        }
    }, 60000);

    test('Direct messaging works between pairs of users', async () => {
        // Test DM from User 1 to User 2
        const sender = users[1];
        const receiver = users[2];
        const messageText = "Secret integration test message";

        await sender.social.sendDirectMessage(receiver.userId, messageText);
        await sender.sov.sync();

        // Receiver syncs
        await receiver.sov.sync();
        const inbox = await receiver.social.getInboxMessages();
        const msg = inbox.find(m => m.senderId === sender.userId && m.content === messageText);
        
        expect(msg).toBeDefined();
        expect(msg!.recipientId).toBe(receiver.userId);
    }, 60000);
});
