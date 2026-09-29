import { SovereignS3nc } from '../src/SovereignS3nc';
import { ModuleContext, QueryBuilder } from '../src/core/ModuleContext';
import { IModuleContext } from '../src/interfaces/IModuleContext';
import { ModerationModule } from '../src/modules/Moderation';
import { ProfileModule } from '../src/modules/Profile';
import { FeedModule } from '../src/modules/Feed';
import { MessagingModule } from '../src/modules/Messaging';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import { ModuleError } from '../src/utils/Errors';
import { DailyDatabase } from '../src/core/DailyDatabase';
import { IDBFactory } from 'fake-indexeddb';
import crypto from 'crypto';
import initSqlJs from 'sql.js';

// Polyfills
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
(global as any).initSqlJs = initSqlJs;

class MockRemoteAdapter implements IRemoteAdapter {
    public files = new Map<string, Uint8Array>();

    async uploadFile(path: string, data: Uint8Array): Promise<string | null> {
        this.files.set(path, data);
        return '"etag"';
    }

    async downloadFile(path: string): Promise<{ data: Uint8Array; etag: string | null; notModified?: boolean } | null> {
        const data = this.files.get(path);
        return data ? { data, etag: '"etag"' } : null;
    }

    async deleteFile(path: string): Promise<void> {
        this.files.delete(path);
    }

    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }

    async getFileHash(path: string): Promise<string | null> {
        return null;
    }

    async getFileEtag(path: string): Promise<string | null> {
        return '"etag"';
    }

    async canWrite(): Promise<boolean> {
        return true;
    }
}

describe('Item 7: ModuleContext Encapsulation Layer', () => {
    let sov: SovereignS3nc;
    const testAdminPk = 'admin-public-key-mock-1234567890abcdef';

    beforeEach(async () => {
        const mockRemote = new MockRemoteAdapter();
        sov = await SovereignS3nc.create({
            paths: {
                appId: 'test-app',
                userId: 'alice',
                storeId: 'main'
            },
            password: 'password123',
            adminPublicKey: testAdminPk
        }, mockRemote, (uid) => new MockRemoteAdapter());
    });

    describe('Context Creation & Module Naming Validation', () => {
        test('creates valid ModuleContext with normalized lowercase name', () => {
            const ctx = sov.createModuleContext('Feed');
            expect(ctx.moduleName).toBe('feed');
            expect(ctx.userId).toBe('alice');
            expect(ctx.appId).toBe('test-app');
            expect(ctx.storeId).toBe('main');
            expect(ctx.adminPublicKey).toBe(testAdminPk);
            expect(ctx.sovereign).toBe(sov);
        });

        test('rejects invalid module names to prevent directory traversal / path confusion', () => {
            expect(() => sov.createModuleContext('../feed')).toThrow(ModuleError);
            expect(() => sov.createModuleContext('feed/sub')).toThrow(ModuleError);
            expect(() => sov.createModuleContext('feed$module')).toThrow(ModuleError);
            expect(() => sov.createModuleContext('')).toThrow(ModuleError);
        });

        test('accepts alphanumeric names with underscores and hyphens', () => {
            expect(() => sov.createModuleContext('feed_v2')).not.toThrow();
            expect(() => sov.createModuleContext('custom-mod-1')).not.toThrow();
        });
    });

    describe('Scoped Storage Operations', () => {
        let ctx: IModuleContext;

        beforeEach(() => {
            ctx = sov.createModuleContext('notes');
        });

        test('correctly scopes getPath for private, public, and followed partitions', () => {
            expect(ctx.storage.getPath('2026-09-29.db', 'public'))
                .toBe('public/modules/notes/2026-09-29.db');

            expect(ctx.storage.getPath('2026-09-29.db', 'private'))
                .toBe('private/modules/notes/2026-09-29.db');

            expect(ctx.storage.getPath('bob/2026-09-29.db', 'followed'))
                .toBe('followed/bob/modules/notes/2026-09-29.db');
        });

        test('saves, reads, checks, and deletes scoped files while emitting update events', async () => {
            const emittedEvents: any[] = [];
            sov.on('notes:update', (payload) => emittedEvents.push(payload));

            const testData = new TextEncoder().encode('scoped note content');
            await ctx.storage.saveFile('entry.txt', testData, 'private');

            expect(await ctx.storage.hasFile('entry.txt', 'private')).toBe(true);
            const retrieved = await ctx.storage.getFile('entry.txt', 'private');
            expect(retrieved).not.toBeNull();
            expect(new TextDecoder().decode(retrieved!)).toBe('scoped note content');

            expect(emittedEvents.length).toBeGreaterThan(0);
            expect(emittedEvents[0].path).toBe('private/modules/notes/entry.txt');

            await ctx.storage.deleteFile('entry.txt', 'private');
            expect(await ctx.storage.hasFile('entry.txt', 'private')).toBe(false);
            expect(await ctx.storage.getFile('entry.txt', 'private')).toBeNull();
        });

        test('provides access to raw un-scoped storage adapter via storage.raw', () => {
            expect(ctx.storage.raw).toBe(sov.getStorage());
        });
    });

    describe('Scoped Remotes', () => {
        test('provides clean access to remotes without reaching into core internals', () => {
            const ctx = sov.createModuleContext('moderation');
            expect(ctx.remotes.getPublicRemote()).toBeDefined();
            expect(ctx.remotes.getPrivateRemote()).toBeDefined();
            expect(ctx.remotes.getAdminRemote()).toBeDefined();
            expect(ctx.remotes.getRootRemote()).toBeDefined();
            expect(ctx.remotes.getGlobalRemote()).toBeDefined();

            const userRemote = ctx.remotes.createRemote('bob');
            expect(userRemote).toBeDefined();
        });
    });

    describe('Typed QueryBuilder', () => {
        test('builds SQL queries correctly with parameter binding and ordering', () => {
            const qb = new QueryBuilder('posts');
            qb.select(['id', 'content', 'timestamp'])
                .where('userId = ?', 'alice')
                .where('isDeleted = ?', 0)
                .orderBy('timestamp', 'DESC')
                .limit(20)
                .offset(40);

            const { sql, params } = qb.toSql();
            expect(sql).toBe('SELECT "id", "content", "timestamp" FROM "posts" WHERE (userId = ?) AND (isDeleted = ?) ORDER BY "timestamp" DESC LIMIT 20 OFFSET 40');
            expect(params).toEqual(['alice', 0]);
        });

        test('executes queries against an active SQLite Database instance', async () => {
            const sqlite = await DailyDatabase.getSqliteInstance();
            const db = new sqlite.Database();

            db.exec(`
                CREATE TABLE items (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    priority INTEGER
                );
                INSERT INTO items VALUES ('1', 'Task A', 10);
                INSERT INTO items VALUES ('2', 'Task B', 30);
                INSERT INTO items VALUES ('3', 'Task C', 20);
            `);

            const ctx = sov.createModuleContext('items');
            const qb = ctx.createQueryBuilder<{ id: string; title: string; priority: number }>('items');

            const results = qb
                .where('priority >= ?', 15)
                .orderBy('priority', 'DESC')
                .execute(db);

            expect(results).toHaveLength(2);
            expect(results[0].title).toBe('Task B');
            expect(results[1].title).toBe('Task C');

            const first = qb.first(db);
            expect(first).not.toBeNull();
            expect(first?.title).toBe('Task B');

            db.close();
        });

        test('validates identifiers against SQL injection', () => {
            expect(() => new QueryBuilder('items; DROP TABLE users;--')).toThrow();
            const qb = new QueryBuilder('items');
            expect(() => qb.select(['valid_col', 'bad--col'])).toThrow();
            expect(() => qb.orderBy('bad;drop table')).toThrow();
        });
    });

    describe('Lightweight Repository via ModuleContext', () => {
        test('creates and interacts with typed repository through context.getRepository()', async () => {
            const ctx = sov.createModuleContext('tasks');
            ctx.registerDefinition({
                name: 'tasks',
                tables: [
                    {
                        name: 'todo',
                        schema: 'id TEXT PRIMARY KEY, title TEXT, done INTEGER'
                    }
                ]
            });

            interface TodoItem {
                id: string;
                title: string;
                done: number;
            }

            const repo = ctx.getRepository<TodoItem>('todo', { datePartition: '2026-09-29' });
            await repo.insert({ id: 't1', title: 'Write tests', done: 0 });
            await repo.insert({ id: 't2', title: 'Refactor modules', done: 1 });

            const item = await repo.findById('t1');
            expect(item).not.toBeNull();
            expect(item?.title).toBe('Write tests');

            const doneItems = await repo.find({ done: 1 });
            expect(doneItems).toHaveLength(1);
            expect(doneItems[0].id).toBe('t2');

            expect(await repo.count()).toBe(2);
        });
    });

    describe('Module Integration & Encapsulation', () => {
        test('ModerationModule functions seamlessly with ModuleContext without any internal casts', async () => {
            const ctx = sov.createModuleContext('moderation');
            const modFromCtx = new ModerationModule(ctx);
            const modFromSov = new ModerationModule(sov);

            expect(await modFromCtx.isAdmin()).toBe(true);
            expect(await modFromSov.isAdmin()).toBe(true);

            // Publish admin key without internal leaks
            await expect(modFromCtx.publishAdminKey()).resolves.not.toThrow();

            // Listing users works via scoped remotes
            const users = await modFromCtx.listUsers();
            expect(Array.isArray(users)).toBe(true);
        });

        test('ProfileModule operates using scoped storage and methods', async () => {
            const ctx = sov.createModuleContext('profile');
            const profileMod = new ProfileModule(ctx);

            await profileMod.updateProfile('Alice Developer', 'Building decentralized systems');
            const profile = await profileMod.getProfile();

            expect(profile).not.toBeNull();
            expect(profile?.name).toBe('Alice Developer');
            expect(profile?.bio).toBe('Building decentralized systems');
            expect(profile?.userId).toBe('alice');
        });

        test('FeedModule operates seamlessly using ModuleContext', async () => {
            const ctx = sov.createModuleContext('feed');
            const feedMod = new FeedModule(ctx);

            await feedMod.post('First post via ModuleContext', true);
            const today = new Date().toISOString().split('T')[0];
            const posts = await feedMod.getPosts(today, 'public');

            expect(posts.length).toBeGreaterThan(0);
            expect(posts[0].content).toBe('First post via ModuleContext');
            expect(posts[0].userId).toBe('alice');
        });

        test('MessagingModule operates seamlessly using ModuleContext', async () => {
            const ctx = sov.createModuleContext('messaging');
            const msgMod = new MessagingModule(ctx);

            expect(msgMod.getMinProtocolVersion()).toBe('v1');
            msgMod.setMinProtocolVersion('v3');
            expect(msgMod.getMinProtocolVersion()).toBe('v3');

            const today = new Date().toISOString().split('T')[0];
            const receipt = await msgMod.getMessageReceipt('nonexistent', today);
            expect(receipt).toBeNull();
        });

        test('sov.getModule() retrieves registered module instances', () => {
            const feedMod = new FeedModule(sov);
            expect(sov.getModule(FeedModule)).toBe(feedMod);
            expect(sov.getModule('feed')).toBe(feedMod);
        });
    });
});
