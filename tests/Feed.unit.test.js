"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const SovereignS3nc_1 = require("../src/SovereignS3nc");
const Feed_1 = require("../src/modules/Feed");
const crypto_1 = __importDefault(require("crypto"));
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
describe('FeedModule Unit Tests', () => {
    let sov;
    let feed;
    let mockRemote;
    const today = new Date().toISOString().split('T')[0];
    beforeEach(async () => {
        global.indexedDB = new fake_indexeddb_1.IDBFactory();
        mockRemote = new MockRemote();
        const config = {
            paths: { appId: 'feed-test', userId: 'alice', storeId: 'main' },
            password: 'password123',
            debug: false
        };
        sov = new SovereignS3nc_1.SovereignS3nc(config, mockRemote);
        await sov.init();
        feed = new Feed_1.FeedModule(sov);
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
    });
});
//# sourceMappingURL=Feed.unit.test.js.map