
import { SovereignS3nc } from '../src/SovereignS3nc';
import { FeedModule, Post } from '../src/modules/Feed';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';

// --- Polyfills ---
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

class MockRemote implements IRemoteAdapter {
    files: Map<string, {data: Uint8Array, hash: string, etag: string}> = new Map();
    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        const h = hash || crypto.createHash('sha256').update(data).digest('hex');
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: h, etag });
        return etag;
    }
    async downloadFile(path: string): Promise<any | null> {
        const entry = this.files.get(path);
        return entry ? { data: entry.data, etag: entry.etag } : null;
    }
    async getFileHash(path: string): Promise<string | null> { return this.files.get(path)?.hash || null; }
    async getFileEtag(path: string): Promise<string | null> { return this.files.get(path)?.etag || null; }
    async canWrite(path: string): Promise<boolean> { return true; }
    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path: string): Promise<void> { this.files.delete(path); }
}

describe('FeedModule Unit Tests', () => {
    let sov: SovereignS3nc;
    let feed: FeedModule;
    let mockRemote: MockRemote;
    const today = new Date().toISOString().split('T')[0];

    beforeEach(async () => {
        (global as any).indexedDB = new IDBFactory();
        mockRemote = new MockRemote();
        const testId = Math.random().toString(36).substring(7);
        const config = {
            paths: { appId: `feed-test-${testId}`, userId: 'alice', storeId: 'main' },
            password: 'password123',
            debug: false,
            localPersistencePath: `./test-data/feed-unit-${testId}`
        };
        sov = new SovereignS3nc(config, mockRemote);
        await sov.init();
        feed = new FeedModule(sov);
    });

    describe('Basic Posting', () => {
        test('should create a public post', async () => {
            await feed.post('Public post');
            const posts = await feed.getPosts(today, 'public');
            expect(posts.length).toBe(1);
            expect(posts[0].content).toBe('Public post');
            expect(posts[0].userId).toBe('alice');
        });

        test('should create a private post', async () => {
            await feed.post('Private post', false);
            const posts = await feed.getPosts(today, 'private');
            expect(posts.length).toBe(1);
            expect(posts[0].content).toBe('Private post');
        });

        test('should create a post with an image', async () => {
            const image = new Uint8Array([1, 2, 3]);
            await feed.post('Post with image', true, image);
            const posts = await feed.getPosts(today, 'public');
            expect(posts[0].image).toBeDefined();
            expect(posts[0].image).toContain('blobs/');
        });
    });

    describe('Post Modifications', () => {
        test('should edit a post', async () => {
            await feed.post('Original content');
            let posts = await feed.getPosts(today, 'public');
            const postId = posts[0].id;

            await feed.editPost(postId, today, 'Edited content');
            posts = await feed.getPosts(today, 'public');
            expect(posts[0].content).toBe('Edited content');
            expect(posts[0].isEdited).toBe(true);
        });

        test('should delete a post', async () => {
            await feed.post('To be deleted');
            let posts = await feed.getPosts(today, 'public');
            const postId = posts[0].id;

            await feed.deletePost(postId, today);
            posts = await feed.getPosts(today, 'public');
            expect(posts[0].isDeleted).toBe(true);
            expect(posts[0].content).toBe('');
        });
    });

    describe('Interactions', () => {
        test('should like a post', async () => {
            await feed.post('Liking this');
            const posts = await feed.getPosts(today, 'public');
            const postId = posts[0].id;

            await feed.like(postId);
            await feed.enrichLikes(posts);
            expect(posts[0].likesCount).toBe(1);
            expect(posts[0].likedByMe).toBe(true);
        });

        test('should comment on a post', async () => {
            await feed.post('Parent post');
            const posts = await feed.getPosts(today, 'public');
            const parentId = posts[0].id;

            await feed.comment(parentId, 'alice', 'My comment');
            const allPosts = await feed.getPosts(today, 'public');
            const comment = allPosts.find(p => p.parentId === parentId);
            expect(comment).toBeDefined();
            expect(comment?.content).toBe('My comment');
            expect(comment?.parentUserId).toBe('alice');
        });
    });

    describe('Group Functionality', () => {
        const groupId = 'group1';
        const sharedKey = '0'.repeat(64);

        beforeEach(async () => {
            const group = {
                id: groupId,
                name: 'Test Group',
                sharedKey: sharedKey,
                members: [{ userId: 'alice', role: 'owner' }]
            };
            await sov.getStorage().saveFile(`private/groups/${groupId}/info.json`, new TextEncoder().encode(JSON.stringify(group)));
        });

        test('should post to a group', async () => {
            await feed.postToGroup(groupId, sharedKey, 'Group post');
            const posts = await feed.getGroupPosts(groupId, today);
            expect(posts.length).toBe(1);
            expect(posts[0].content).toBe('Group post');
        });

        test('should edit a group post', async () => {
            await feed.postToGroup(groupId, sharedKey, 'Original group post');
            let posts = await feed.getGroupPosts(groupId, today);
            const postId = posts[0].id;

            await feed.editGroupPost(groupId, sharedKey, postId, today, 'Edited group post');
            posts = await feed.getGroupPosts(groupId, today);
            expect(posts[0].content).toBe('Edited group post');
            expect(posts[0].isEdited).toBe(true);
        });

        test('should delete own group post', async () => {
            await feed.postToGroup(groupId, sharedKey, 'Delete me');
            let posts = await feed.getGroupPosts(groupId, today);
            const postId = posts[0].id;

            await feed.deleteGroupPost(groupId, sharedKey, postId, today, 'alice');
            posts = await feed.getGroupPosts(groupId, today);
            expect(posts.length).toBe(0);
        });

        test('should moderate (delete) another user\'s group post as admin', async () => {
            await feed.postToGroup(groupId, sharedKey, 'Bobs post');
            let posts = await feed.getGroupPosts(groupId, today);
            const postId = posts[0].id;

            await feed.deleteGroupPost(groupId, sharedKey, postId, today, 'bob');
            
            posts = await feed.getGroupPosts(groupId, today);
            expect(posts.length).toBe(0);
        });

        test('should support post TTL expiration and cleanupExpired', async () => {
            const expiredTime = Date.now() - 1000;
            await feed.post('Expired post', true, undefined, undefined, undefined, expiredTime);
            await feed.post('Active post', true, undefined, undefined, undefined, Date.now() + 60000);

            // getPosts should filter out the expired post
            let posts = await feed.getPosts(today, 'public');
            expect(posts.some(p => p.content === 'Expired post')).toBe(false);
            expect(posts.some(p => p.content === 'Active post')).toBe(true);

            // cleanupExpired should remove the expired post from database
            const deleted = await feed.cleanupExpired(today, true);
            expect(deleted).toBeGreaterThanOrEqual(1);
        });
    });
});
