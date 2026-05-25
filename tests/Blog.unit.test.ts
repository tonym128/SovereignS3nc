
import { SovereignS3nc } from '../src/SovereignS3nc';
import { FeedModule, Post } from '../src/modules/Feed';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import crypto from 'crypto';
import { IDBFactory } from 'fake-indexeddb';
import initSqlJs from 'sql.js';
import { Buffer } from 'buffer';

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
    async downloadFile(path: string, ifNoneMatch?: string): Promise<any | null> {
        const entry = this.files.get(path);
        if (!entry) return null;
        if (ifNoneMatch && ifNoneMatch === entry.etag) {
            return { data: null, etag: entry.etag, notModified: true };
        }
        return { data: entry.data, etag: entry.etag };
    }
    async getFileHash(path: string): Promise<string | null> { return this.files.get(path)?.hash || null; }
    async getFileEtag(path: string): Promise<string | null> { return this.files.get(path)?.etag || null; }
    async canWrite(path: string): Promise<boolean> { return true; }
    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path: string): Promise<void> { this.files.delete(path); }
}

class PrefixedMockRemote implements IRemoteAdapter {
    constructor(private base: MockRemote, private prefix: string) {}
    private p(path: string) { return `${this.prefix}/${path}`; }
    async uploadFile(path: string, data: Uint8Array, hash?: string) { return this.base.uploadFile(this.p(path), data, hash); }
    async downloadFile(path: string, ifNoneMatch?: string) { return this.base.downloadFile(this.p(path), ifNoneMatch); }
    async getFileHash(path: string) { return this.base.getFileHash(this.p(path)); }
    async getFileEtag(path: string) { return this.base.getFileEtag(this.p(path)); }
    async canWrite(path: string) { return this.base.canWrite(this.p(path)); }
    async listFiles(prefix: string) { 
        const results = await this.base.listFiles(this.p(prefix));
        return results.map(r => r.substring(this.prefix.length + 1));
    }
    async deleteFile(path: string) { return this.base.deleteFile(this.p(path)); }
}

describe('Sovereign Blog Enhanced Functionality Tests', () => {
    let sov: SovereignS3nc;
    let blog: FeedModule;
    let mockRemote: MockRemote;
    let appId: string;

    const getPrefixedRemote = (uid: string, isPrivate: boolean = false) => {
        return new PrefixedMockRemote(mockRemote, `${appId}/${uid}/main`);
    };

    beforeEach(async () => {
        (global as any).indexedDB = new IDBFactory();
        mockRemote = new MockRemote();
        appId = `blog-test-${Math.random().toString(36).substring(7)}`;
        
        const config = {
            paths: { appId, userId: 'author-1', storeId: 'main' },
            password: 'password123',
            debug: false
        };
        const remoteFactory = (uid: string) => getPrefixedRemote(uid);
        
        sov = await SovereignS3nc.create(config, getPrefixedRemote('author-1', true), remoteFactory);
        blog = new FeedModule(sov);
    });

    test('should strictly separate Drafts (private) from Published (public) posts', async () => {
        const today = new Date().toISOString().split('T')[0];
        
        // 1. Create a Draft
        await blog.post(JSON.stringify({ title: 'My Secret Draft', status: 'draft' }), false);
        
        // 2. Create a Published Post
        await blog.post(JSON.stringify({ title: 'Hello World', status: 'published' }), true);
        
        // 3. Verify local state
        const publicPosts = await blog.getPosts(today, 'public');
        const privatePosts = await blog.getPosts(today, 'private');
        
        expect(publicPosts.length).toBe(1);
        expect(JSON.parse(publicPosts[0].content).title).toBe('Hello World');
        
        expect(privatePosts.length).toBe(1);
        expect(JSON.parse(privatePosts[0].content).title).toBe('My Secret Draft');

        // 4. Verify remote sync isolation
        await sov.sync();
        
        // Bob (Follower) should only see the public post
        const configBob = { paths: { appId, userId: 'bob', storeId: 'main' }, password: 'bobpassword' };
        const sovBob = await SovereignS3nc.create(configBob, getPrefixedRemote('bob', true), (uid: string) => getPrefixedRemote(uid));
        const blogBob = new FeedModule(sovBob);
        
        await sovBob.follow('author-1');
        await sovBob.sync();
        
        const followedPosts = await blogBob.getPosts(`author-1/${today}`, 'followed');
        expect(followedPosts.length).toBe(1);
        expect(JSON.parse(followedPosts[0].content).title).toBe('Hello World');
        expect(followedPosts.find(p => p.content.includes('My Secret Draft'))).toBeUndefined();
    });

    test('should manage media blobs for markdown posts', async () => {
        // 1. Upload a "photo"
        const photoData = new TextEncoder().encode('fake-image-binary-data');
        const blobPath = await sov.saveBlob(photoData, true);
        
        expect(blobPath).toContain('public/blobs/');
        
        // 2. Create a post referencing the blob
        const mdContent = `Check out this photo: ![](${blobPath})`;
        await blog.post(JSON.stringify({ title: 'Photo Post', content: mdContent }), true);
        
        await sov.sync();
        
        // 3. Verify Reader can fetch both post and blob
        const configBob = { paths: { appId, userId: 'bob-reader', storeId: 'main' }, password: 'readerpassword' };
        const sovBob = await SovereignS3nc.create(configBob, getPrefixedRemote('bob-reader', true), (uid: string) => getPrefixedRemote(uid));
        const blogBob = new FeedModule(sovBob);
        
        await sovBob.follow('author-1');
        await sovBob.sync();
        
        const today = new Date().toISOString().split('T')[0];
        const posts = await blogBob.getPosts(`author-1/${today}`, 'followed');
        const postData = JSON.parse(posts[0].content);
        
        // Extract blob path from markdown
        const match = postData.content.match(/public\/blobs\/[a-f0-9]+/);
        expect(match).not.toBeNull();
        const extractedPath = match[0];
        
        // Fetch the actual blob data
        const downloadedBlob = await sovBob.getBlob(extractedPath, 'author-1');
        expect(downloadedBlob).toBeDefined();
        expect(new TextDecoder().decode(downloadedBlob!)).toBe('fake-image-binary-data');
    });

    test('should simulate static site export by collecting all public data', async () => {
        const today = new Date().toISOString().split('T')[0];
        
        // 1. Setup blog content
        const photoData = new TextEncoder().encode('image-data');
        const blobPath = await sov.saveBlob(photoData, true);
        await blog.post(JSON.stringify({ title: 'Export Test', content: `Image: ${blobPath}` }), true);
        await sov.sync();
        
        // 2. Simulate Export Logic
        const publicPosts = await blog.getPosts(today, 'public');
        const exportData: any = { posts: [], blobs: {} };
        
        for (const p of publicPosts) {
            const data = JSON.parse(p.content);
            exportData.posts.push(data);
            
            // Regex match blobs
            const matches = data.content.match(/public\/blobs\/[a-f0-9]+/g);
            if (matches) {
                for (const match of matches) {
                    const blob = await sov.getBlob(match);
                    if (blob) exportData.blobs[match] = Buffer.from(blob).toString('base64');
                }
            }
        }
        
        expect(exportData.posts.length).toBe(1);
        expect(exportData.posts[0].title).toBe('Export Test');
        expect(exportData.blobs[blobPath]).toBe(Buffer.from(photoData).toString('base64'));
    });
});
