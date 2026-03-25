#!/usr/bin/env node
import { SovereignS3nc } from './SovereignS3nc';
import { ProfileModule, Profile } from './modules/Profile';
import { MessagingModule, Message } from './modules/Messaging';
import { FeedModule, Post } from './modules/Feed';
import { NodeStorage } from './adapters/NodeStorage';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';
const initSqlJs = require('sql.js');

// Polyfills for Node
(global as any).initSqlJs = initSqlJs;
(global as any).TextEncoder = require('util').TextEncoder;
(global as any).TextDecoder = require('util').TextDecoder;

const APP_ID = 'sov-social';
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '.';
const CLI_DATA_DIR = path.join(HOME_DIR, '.sovereigns3nc-cli');

interface UserProfile {
    userId: string;
    password: string;
    s3Config: any;
    lastLogin: number;
    lastViewed?: {
        feed: number;
        messages: number;
        chat: Record<string, number>;
    };
}

async function getSavedProfiles(): Promise<Record<string, UserProfile>> {
    const profilePath = path.join(CLI_DATA_DIR, 'profiles.json');
    if (await fs.pathExists(profilePath)) {
        const profiles = await fs.readJson(profilePath);
        Object.values(profiles).forEach((p: any) => {
            if (!p.lastViewed) p.lastViewed = { feed: 0, messages: 0, chat: {} };
        });
        return profiles;
    }
    return {};
}

async function saveProfile(profile: UserProfile) {
    await fs.ensureDir(CLI_DATA_DIR);
    const profiles = await getSavedProfiles();
    profiles[profile.userId] = profile;
    await fs.writeJson(path.join(CLI_DATA_DIR, 'profiles.json'), profiles);
}

async function getCurrentUser(): Promise<UserProfile | null> {
    const currentPath = path.join(CLI_DATA_DIR, 'current_user.json');
    if (await fs.pathExists(currentPath)) {
        const { userId } = await fs.readJson(currentPath);
        const profiles = await getSavedProfiles();
        return profiles[userId] || null;
    }
    return null;
}

async function setCurrentUser(userId: string) {
    await fs.ensureDir(CLI_DATA_DIR);
    await fs.writeJson(path.join(CLI_DATA_DIR, 'current_user.json'), { userId });
}

async function initSovereign(profile: UserProfile): Promise<{ 
    sov: SovereignS3nc, 
    profile: ProfileModule,
    messaging: MessagingModule,
    feed: FeedModule
}> {
    const storagePath = path.join(CLI_DATA_DIR, 'storage', profile.userId);
    const storage = new NodeStorage(storagePath);
    
    const config = {
        paths: { appId: APP_ID, userId: profile.userId, storeId: 'social' },
        password: profile.password,
        s3: profile.s3Config,
        debug: false
    };

    const sov = new SovereignS3nc(config, undefined, undefined, undefined, storage);
    await sov.init();
    
    return { 
        sov, 
        profile: new ProfileModule(sov),
        messaging: new MessagingModule(sov),
        feed: new FeedModule(sov)
    };
}

export async function run(args: string[]) {
    const command = args[0];

    if (!command || command === 'help') {
        console.log(`
SovereignS3nc CLI - Usage:
  account create <userId> <password> <endpoint> <accessKey> <secretKey> <bucket>
  login <userId>
  logout
  profile update <name> <bio> [avatarPath]
  profile show [userId]
  sync
  post create <content> [imagePath]
  post list [userId]
  post comment <postId> <parentUserId> <content>
  post delete <postId>
  post read
  dm send <recipientId> <content> [imagePath]
  dm list [userId]
  dm read
  follow <userId>
  unfollow <userId>
  following
        `);
        return;
    }

    try {
        switch (command) {
            case 'account':
                if (args[1] === 'create') {
                    const [_, __, userId, password, endpoint, accessKeyId, secretAccessKey, bucketName] = args;
                    const s3Config = { 
                        endpoint, 
                        credentials: { accessKeyId, secretAccessKey }, 
                        bucketName, 
                        region: 'rustfs' 
                    };
                    const profile: UserProfile = { userId, password, s3Config, lastLogin: Date.now() };
                    await saveProfile(profile);
                    await setCurrentUser(userId);
                    const { sov } = await initSovereign(profile);
                    await sov.sync();
                    console.log(`Account created and logged in as ${userId}`);
                }
                break;

            case 'login':
                const userId = args[1];
                const profiles = await getSavedProfiles();
                if (profiles[userId]) {
                    await setCurrentUser(userId);
                    console.log(`Logged in as ${userId}`);
                } else {
                    console.error(`Profile for ${userId} not found. Use account create first.`);
                }
                break;

            case 'logout':
                const currentPath = path.join(CLI_DATA_DIR, 'current_user.json');
                if (await fs.pathExists(currentPath)) {
                    await fs.remove(currentPath);
                }
                console.log('Logged out.');
                break;

            case 'sync':
                {
                    const user = await getCurrentUser();
                    if (!user) return console.error('Not logged in.');
                    const { sov } = await initSovereign(user);
                    console.log('Syncing...');
                    await sov.sync();
                    console.log('Sync complete.');
                }
                break;

            case 'post':
                const postCmd = args[1];
                const user = await getCurrentUser();
                if (!user) return console.error('Not logged in.');
                const { feed, sov } = await initSovereign(user);

                if (postCmd === 'create') {
                    const content = args[2];
                    const imagePath = args[3];
                    let image: Uint8Array | undefined;
                    if (imagePath && await fs.pathExists(imagePath)) {
                        image = await fs.readFile(imagePath);
                    }
                    await feed.post(content, true, image);
                    console.log('Post created.');
                } else if (postCmd === 'list') {
                    const targetId = args[2] || user.userId;
                    const today = new Date().toISOString().split('T')[0];
                    const type = targetId === user.userId ? 'public' : 'followed';
                    const posts = await feed.getPosts(targetId === user.userId ? today : `${targetId}/${today}`, type);
                    
                    const lastViewed = user.lastViewed?.feed || 0;
                    console.log(`\n--- Posts for ${targetId} (${today}) ---`);
                    posts.forEach(p => {
                        const isNew = p.timestamp > lastViewed && p.userId !== user.userId;
                        console.log(`${isNew ? '[NEW] ' : ''}[${p.id}] ${new Date(p.timestamp).toLocaleString()}`);
                        console.log(`${p.content}`);
                        if (p.image) console.log(`(Image: ${p.image})`);
                        console.log('----------------------------');
                    });
                } else if (postCmd === 'comment') {
                    const postId = args[2];
                    const parentUserId = args[3];
                    const content = args[4];
                    await feed.comment(postId, parentUserId, content);
                    console.log('Comment added.');
                } else if (postCmd === 'delete') {
                    const postId = args[2];
                    const today = new Date().toISOString().split('T')[0];
                    await feed.deletePost(postId, today);
                    console.log('Post deleted.');
                } else if (postCmd === 'read') {
                    user.lastViewed!.feed = Date.now();
                    await saveProfile(user);
                    console.log('Feed marked as read.');
                }
                break;

            case 'dm':
                const dmCmd = args[1];
                const dmUser = await getCurrentUser();
                if (!dmUser) return console.error('Not logged in.');
                const { messaging: dmMessaging } = await initSovereign(dmUser);

                if (dmCmd === 'send') {
                    const recipientId = args[2];
                    const content = args[3];
                    const imagePath = args[4];
                    let image: Uint8Array | undefined;
                    if (imagePath && await fs.pathExists(imagePath)) {
                        image = await fs.readFile(imagePath);
                    }
                    await dmMessaging.sendDirectMessage(recipientId, content, image);
                    console.log('Message sent.');
                } else if (dmCmd === 'list') {
                    const messages = await dmMessaging.getInboxMessages(5);
                    const targetId = args[2];
                    const filtered = targetId 
                        ? messages.filter(m => m.senderId === targetId || m.recipientId === targetId)
                        : messages;

                    const lastViewed = dmUser.lastViewed?.messages || 0;
                    console.log(`\n--- DMs ${targetId ? 'with ' + targetId : '(All Recent)'} ---`);
                    filtered.forEach(m => {
                        const isNew = m.timestamp > lastViewed && m.senderId !== dmUser.userId;
                        const sender = m.senderId === dmUser.userId ? 'Me' : m.senderId;
                        console.log(`${isNew ? '[NEW] ' : ''}[${new Date(m.timestamp).toLocaleString()}] ${sender}: ${m.content}`);
                        if (m.image) console.log(`(Image: ${m.image})`);
                    });
                } else if (dmCmd === 'read') {
                    dmUser.lastViewed!.messages = Date.now();
                    await saveProfile(dmUser);
                    console.log('Messages marked as read.');
                }
                break;

            case 'profile':
                const profCmd = args[1];
                const profUser = await getCurrentUser();
                if (!profUser) return console.error('Not logged in.');
                const { sov: profSov, profile: profModule } = await initSovereign(profUser);

                if (profCmd === 'update') {
                    const name = args[2];
                    const bio = args[3];
                    const avatarPath = args[4];
                    let avatarData: string | undefined;
                    
                    if (avatarPath && await fs.pathExists(avatarPath)) {
                        const buffer = await fs.readFile(avatarPath);
                        avatarData = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                    }

                    await profModule.updateProfile(name, bio, avatarData);
                    console.log('Profile updated.');
                } else if (profCmd === 'show') {
                    const targetId = args[2] || profUser.userId;
                    const profile = await profModule.getProfile(targetId);
                    
                    if (profile) {
                        console.log(`\n--- Profile for ${targetId} ---`);
                        console.log(`Name: ${profile.name}`);
                        console.log(`Bio: ${profile.bio}`);
                        console.log(`Updated: ${new Date(profile.updatedAt).toLocaleString()}`);
                    } else {
                        console.log('Profile not found locally. Try syncing.');
                    }
                }
                break;
            
            case 'follow':
                {
                    const user = await getCurrentUser();
                    if (!user) return console.error('Not logged in.');
                    const { sov } = await initSovereign(user);
                    await sov.follow(args[1]);
                    console.log(`Following ${args[1]}`);
                }
                break;

            case 'unfollow':
                {
                    const user = await getCurrentUser();
                    if (!user) return console.error('Not logged in.');
                    const { sov } = await initSovereign(user);
                    await sov.unfollow(args[1]);
                    console.log(`Unfollowed ${args[1]}`);
                }
                break;

            case 'following':
                {
                    const user = await getCurrentUser();
                    if (!user) return console.error('Not logged in.');
                    const { sov } = await initSovereign(user);
                    const list = await sov.getFollowing();
                    console.log('\n--- Following ---');
                    list.forEach(f => console.log(`- ${f.userId} (Last sync: ${f.lastSync})`));
                }
                break;

            default:
                console.log('Unknown command. Type "help" for usage.');
        }
    } catch (e: any) {
        console.error('Error:', e.message);
        if (e.stack) console.debug(e.stack);
    }
}

if (require.main === module) {
    run(process.argv.slice(2));
}
