
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

describe('Sovereign Board (Kanban) Functionality Tests', () => {
    let sov: SovereignS3nc;
    let board: FeedModule;
    let mockRemote: MockRemote;
    let appId: string;

    const getPrefixedRemote = (uid: string, isPrivate: boolean = false) => {
        return new PrefixedMockRemote(mockRemote, `${appId}/${uid}/main`);
    };

    beforeEach(async () => {
        (global as any).indexedDB = new IDBFactory();
        mockRemote = new MockRemote();
        appId = `board-test-${Math.random().toString(36).substring(7)}`;
        
        const config = {
            paths: { appId, userId: 'alice', storeId: 'main' },
            password: 'password123',
            debug: false
        };
        const remoteFactory = (uid: string) => getPrefixedRemote(uid);
        
        sov = await SovereignS3nc.create(config, getPrefixedRemote('alice', true), remoteFactory);
        board = new FeedModule(sov);
    });

    test('should create a new board (group)', async () => {
        const groupName = 'Engineering Board';
        const members = [{ userId: 'alice', publicKey: sov.getConfig().publicEncryptionKey!, role: 'owner' as const }];
        const group = await sov.createGroup(groupName, members);
        
        expect(group.name).toBe(groupName);
        expect(group.members.length).toBe(1);
        
        const groups = await sov.getGroups();
        expect(groups.find(g => g.id === group.id)).toBeDefined();
    });

    test('should add tasks to a board', async () => {
        const members = [{ userId: 'alice', publicKey: sov.getConfig().publicEncryptionKey!, role: 'owner' as const }];
        const group = await sov.createGroup('My Board', members);
        const today = new Date().toISOString().split('T')[0];
        
        const taskContent = JSON.stringify({
            title: 'Implement Auth',
            column: 'Todo',
            priority: 'high',
            createdAt: Date.now()
        });
        
        await board.postToGroup(group.id, group.sharedKey, taskContent);
        
        const tasks = await board.getGroupPosts(group.id, today);
        expect(tasks.length).toBe(1);
        expect(JSON.parse(tasks[0].content).title).toBe('Implement Auth');
    });

    test('should move tasks between columns', async () => {
        const members = [{ userId: 'alice', publicKey: sov.getConfig().publicEncryptionKey!, role: 'owner' as const }];
        const group = await sov.createGroup('Sprint 1', members);
        const today = new Date().toISOString().split('T')[0];
        
        const taskContent = JSON.stringify({
            title: 'Fix bug #101',
            column: 'Todo',
            priority: 'medium',
            createdAt: Date.now()
        });
        
        await board.postToGroup(group.id, group.sharedKey, taskContent);
        let tasks = await board.getGroupPosts(group.id, today);
        const taskId = tasks[0].id;
        
        // Move to "In Progress"
        const updatedContent = JSON.parse(tasks[0].content);
        updatedContent.column = 'In Progress';
        await board.editGroupPost(group.id, group.sharedKey, taskId, today, JSON.stringify(updatedContent));
        
        tasks = await board.getGroupPosts(group.id, today);
        expect(JSON.parse(tasks[0].content).column).toBe('In Progress');
    });

    test('should delete tasks from a board', async () => {
        const members = [{ userId: 'alice', publicKey: sov.getConfig().publicEncryptionKey!, role: 'owner' as const }];
        const group = await sov.createGroup('Temporary Board', members);
        const today = new Date().toISOString().split('T')[0];
        
        await board.postToGroup(group.id, group.sharedKey, JSON.stringify({ title: 'Task to delete', column: 'Todo' }));
        let tasks = await board.getGroupPosts(group.id, today);
        expect(tasks.length).toBe(1);
        
        await board.deleteGroupPost(group.id, group.sharedKey, tasks[0].id, today, tasks[0].userId);
        tasks = await board.getGroupPosts(group.id, today);
        expect(tasks.length).toBe(0);
    });

    test('should support multiple users on the same board (simulated)', async () => {
        const groupName = 'Shared Team Board';
        
        // Bob setup first to get his public key
        const configBob = {
            paths: { appId, userId: 'bob', storeId: 'main' },
            password: 'bobpassword',
            debug: false
        };
        const remoteFactoryBob = (uid: string) => getPrefixedRemote(uid);
        const sovBob = await SovereignS3nc.create(configBob, getPrefixedRemote('bob', true), remoteFactoryBob);
        const boardBob = new FeedModule(sovBob);

        // Alice creates board with Bob as member
        const members = [
            { userId: 'alice', publicKey: sov.getConfig().publicEncryptionKey!, role: 'owner' as const },
            { userId: 'bob', publicKey: sovBob.getConfig().publicEncryptionKey!, role: 'member' as const }
        ];
        const group = await sov.createGroup(groupName, members);
        const today = new Date().toISOString().split('T')[0];
        
        await board.postToGroup(group.id, group.sharedKey, JSON.stringify({ title: 'Alice Task', column: 'Todo' }));
        
        // Alice syncs to upload everything
        await sov.sync();
        
        // Bob joins and responds
        await sovBob.joinGroup(group);
        await sovBob.respondToGroup(group.id, 'joined');
        
        // Bob must follow Alice to sync her group data
        await sovBob.follow('alice');
        
        // Bob should see Alice's task after sync
        await sovBob.sync();
        const tasksForBob = await boardBob.getGroupPosts(group.id, today);
        expect(tasksForBob.length).toBe(1);
        expect(JSON.parse(tasksForBob[0].content).title).toBe('Alice Task');
        
        // Bob adds a task
        await boardBob.postToGroup(group.id, group.sharedKey, JSON.stringify({ title: 'Bob Task', column: 'Done' }));
        await sovBob.sync();
        
        // Alice should see Bob's task after sync
        await sov.sync();
        const tasksForAlice = await board.getGroupPosts(group.id, today);
        expect(tasksForAlice.length).toBe(2);
        expect(tasksForAlice.find(t => JSON.parse(t.content).title === 'Bob Task')).toBeDefined();
    });

    test('should support blog reader functionality (public posts)', async () => {
        const today = new Date().toISOString().split('T')[0];
        
        // Alice (Author) posts a blog entry
        const blogPost = JSON.stringify({ title: 'My First Blog', content: 'Hello World', publishedAt: Date.now() });
        await board.post(blogPost, true); // Public post
        await sov.sync();
        
        // Bob (Reader) follows Alice
        const configBob = {
            paths: { appId, userId: 'bob-reader', storeId: 'main' },
            password: 'readerpassword',
            debug: false
        };
        const remoteFactoryBob = (uid: string) => getPrefixedRemote(uid);
        const sovBob = await SovereignS3nc.create(configBob, getPrefixedRemote('bob-reader', true), remoteFactoryBob);
        const boardBob = new FeedModule(sovBob);
        
        await sovBob.follow('alice');
        await sovBob.sync();
        
        // Bob reads Alice's blog
        const alicePosts = await boardBob.getPosts('alice/' + today, 'followed');
        expect(alicePosts.length).toBe(1);
        expect(JSON.parse(alicePosts[0].content).title).toBe('My First Blog');
    });
});
