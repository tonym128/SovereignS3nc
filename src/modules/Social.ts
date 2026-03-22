
import { SovereignS3nc } from '../SovereignS3nc';
import { ModuleDefinition } from '../types';
import { ProfileModule, Profile } from './Profile';
import { MessagingModule, Message } from './Messaging';
import { FeedModule, Post } from './Feed';
import { MediaUtils } from '../utils/MediaUtils';

export { Post, Message };

/**
 * Legacy Social Module Definition for backward compatibility.
 */
export const SOCIAL_MODULE_DEFINITION: ModuleDefinition = {
    name: 'social',
    tables: [
        {
            name: 'posts',
            schema: `
                id TEXT PRIMARY KEY,
                content TEXT,
                timestamp INTEGER,
                userId TEXT,
                image TEXT,
                parentId TEXT,
                parentUserId TEXT,
                isEdited INTEGER DEFAULT 0,
                isDeleted INTEGER DEFAULT 0,
                type TEXT DEFAULT 'text'
            `
        },
        {
            name: 'likes',
            schema: `
                postId TEXT,
                userId TEXT,
                timestamp INTEGER,
                PRIMARY KEY (postId, userId)
            `
        },
        {
            name: 'messages',
            schema: `
                id TEXT PRIMARY KEY,
                content TEXT,
                timestamp INTEGER,
                senderId TEXT,
                recipientId TEXT,
                image TEXT,
                isEdited INTEGER DEFAULT 0,
                isDeleted INTEGER DEFAULT 0
            `
        },
        {
            name: 'moderation',
            schema: `
                targetId TEXT PRIMARY KEY,
                action TEXT,
                timestamp INTEGER
            `
        }
    ],
    migrations: [] 
};

/**
 * SocialManager now acts as a composite wrapper over specialized modules.
 * This maintains backward compatibility for existing applications like the Social Demo.
 */
export class SocialManager {
    private profile: ProfileModule;
    private messaging: MessagingModule;
    private feed: FeedModule;

    constructor(private db: SovereignS3nc) {
        // Register the legacy definition to ensure existing tables are handled
        this.db.registerModule(SOCIAL_MODULE_DEFINITION);
        
        // Initialize specialized modules
        this.profile = new ProfileModule(db);
        this.messaging = new MessagingModule(db);
        this.feed = new FeedModule(db);
    }

    // --- Profile Logic (Delegated) ---

    async updateProfile(name: string, bio: string, avatar?: string) {
        return this.profile.updateProfile(name, bio, avatar);
    }

    async getProfile(userId?: string): Promise<Profile | null> {
        return this.profile.getProfile(userId);
    }

    async syncOtherProfiles() {
        return this.profile.syncOtherProfiles();
    }

    public static async compressImage(dataUrl: string, targetSizeBytes: number): Promise<string> {
        return MediaUtils.compressImage(dataUrl, targetSizeBytes);
    }

    // --- Messaging Logic (Delegated) ---

    async sendDirectMessage(recipientId: string, content: string, image?: Uint8Array) {
        return this.messaging.sendDirectMessage(recipientId, content, image);
    }

    async editMessage(recipientId: string, messageId: string, date: string, newContent: string) {
        return this.messaging.editMessage(recipientId, messageId, date, newContent);
    }

    async deleteMessage(recipientId: string, messageId: string, date: string) {
        return this.messaging.deleteMessage(recipientId, messageId, date);
    }

    async getInboxMessages(days: number = 5): Promise<Message[]> {
        return this.messaging.getInboxMessages(days);
    }

    // --- Feed Logic (Delegated) ---

    async getDb(date: string, type: 'private' | 'public' | 'followed' | 'group', groupId?: string, sharedKey?: string): Promise<any> {
        return (this.feed as any).getDb(date, type, groupId, sharedKey);
    }

    async post(content: string, isPublic: boolean = true, image?: Uint8Array, parentId?: string, parentUserId?: string) {
        return this.feed.post(content, isPublic, image, parentId, parentUserId);
    }

    async editPost(postId: string, date: string, newContent: string, isPublic: boolean = true) {
        return this.feed.editPost(postId, date, newContent, isPublic);
    }

    async deletePost(postId: string, date: string, isPublic: boolean = true) {
        return this.feed.deletePost(postId, date, isPublic);
    }

    async like(postId: string, isPublic: boolean = true) {
        return this.feed.like(postId, isPublic);
    }

    async comment(parentId: string, parentUserId: string, content: string, image?: Uint8Array) {
        return this.feed.comment(parentId, parentUserId, content, image);
    }

    async getPosts(date: string, type: 'private' | 'public' | 'followed'): Promise<Post[]> {
        return this.feed.getPosts(date, type);
    }

    async enrichLikes(posts: Post[], days: number = 5) {
        return this.feed.enrichLikes(posts, days);
    }

    // --- Group Logic (Delegated) ---

    async postToGroup(groupId: string, sharedKey: string, content: string, image?: Uint8Array, type: 'text' | 'system' = 'text') {
        return this.feed.postToGroup(groupId, sharedKey, content, image, type);
    }

    async editGroupPost(groupId: string, sharedKey: string, postId: string, date: string, newContent: string) {
        return this.feed.editGroupPost(groupId, sharedKey, postId, date, newContent);
    }

    async deleteGroupPost(groupId: string, sharedKey: string, postId: string, date: string, authorId: string) {
        return this.feed.deleteGroupPost(groupId, sharedKey, postId, date, authorId);
    }

    async getGroupPosts(groupId: string, date: string): Promise<Post[]> {
        return this.feed.getGroupPosts(groupId, date);
    }

    // --- Core Sync ---

    async sync() {
        await this.db.sync();
    }
}
