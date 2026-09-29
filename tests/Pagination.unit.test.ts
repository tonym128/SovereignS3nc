import { SovereignS3nc } from '../src/SovereignS3nc';
import { FeedModule, Post } from '../src/modules/Feed';
import { MessagingModule, Message } from '../src/modules/Messaging';
import { PaginationCursor, paginateItems, PaginatedResult } from '../src/core/Pagination';
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
    files: Map<string, { data: Uint8Array; hash: string; etag: string }> = new Map();
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

describe('Pagination Unit Tests (Item 9)', () => {
    describe('PaginationCursor', () => {
        test('encodes and decodes valid compound keys accurately', () => {
            const timestamp = 1711756800000;
            const id = 'post_abc_123';
            const cursor = PaginationCursor.encode(timestamp, id);

            expect(typeof cursor).toBe('string');
            expect(cursor.length).toBeGreaterThan(0);
            // URL-safe checks
            expect(cursor).not.toContain('+');
            expect(cursor).not.toContain('/');
            expect(cursor).not.toContain('=');

            const decoded = PaginationCursor.decode(cursor);
            expect(decoded).not.toBeNull();
            expect(decoded?.timestamp).toBe(timestamp);
            expect(decoded?.id).toBe(id);
        });

        test('preserves extra metadata in cursor payload', () => {
            const timestamp = 1711756800000;
            const id = 'item_xyz';
            const extra = { category: 'tech', page: 2 };
            const cursor = PaginationCursor.encode(timestamp, id, extra);

            const decoded = PaginationCursor.decode(cursor);
            expect(decoded).not.toBeNull();
            expect(decoded?.timestamp).toBe(timestamp);
            expect(decoded?.id).toBe(id);
            expect(decoded?.category).toBe('tech');
            expect(decoded?.page).toBe(2);
        });

        test('returns null gracefully for invalid, corrupted, or null cursors', () => {
            expect(PaginationCursor.decode(null)).toBeNull();
            expect(PaginationCursor.decode(undefined)).toBeNull();
            expect(PaginationCursor.decode('')).toBeNull();
            expect(PaginationCursor.decode('   ')).toBeNull();
            expect(PaginationCursor.decode('not-a-valid-base64-json!')).toBeNull();
            expect(PaginationCursor.decode('e30')).toBeNull(); // Empty JSON object {}
            expect(PaginationCursor.decode(Buffer.from('{"t": "not-a-num", "i": 123}').toString('base64'))).toBeNull();
        });
    });

    describe('paginateItems In-Memory Keyset Utility', () => {
        interface TestItem {
            id: string;
            timestamp: number;
            content: string;
        }

        const items: TestItem[] = [
            { id: 'item-5', timestamp: 5000, content: 'Five' },
            { id: 'item-4', timestamp: 4000, content: 'Four' },
            { id: 'item-3', timestamp: 3000, content: 'Three' },
            { id: 'item-2', timestamp: 2000, content: 'Two' },
            { id: 'item-1', timestamp: 1000, content: 'One' },
        ];

        test('handles empty array', () => {
            const res = paginateItems<TestItem>([]);
            expect(res.items).toEqual([]);
            expect(res.hasMore).toBe(false);
            expect(res.nextCursor).toBeNull();
            expect(res.prevCursor).toBeNull();
            expect(res.total).toBe(0);
        });

        test('handles dataset smaller than limit', () => {
            const res = paginateItems(items, { limit: 10 });
            expect(res.items.length).toBe(5);
            expect(res.hasMore).toBe(false);
            expect(res.nextCursor).toBeNull();
            expect(res.prevCursor).not.toBeNull();
        });

        test('paginates sequentially across pages (reverse-chronological "before")', () => {
            // Page 1
            const page1 = paginateItems(items, { limit: 2, direction: 'before' });
            expect(page1.items.length).toBe(2);
            expect(page1.items.map(i => i.id)).toEqual(['item-5', 'item-4']);
            expect(page1.hasMore).toBe(true);
            expect(page1.nextCursor).not.toBeNull();

            // Page 2
            const page2 = paginateItems(items, { limit: 2, cursor: page1.nextCursor!, direction: 'before' });
            expect(page2.items.length).toBe(2);
            expect(page2.items.map(i => i.id)).toEqual(['item-3', 'item-2']);
            expect(page2.hasMore).toBe(true);
            expect(page2.nextCursor).not.toBeNull();

            // Page 3 (final)
            const page3 = paginateItems(items, { limit: 2, cursor: page2.nextCursor!, direction: 'before' });
            expect(page3.items.length).toBe(1);
            expect(page3.items.map(i => i.id)).toEqual(['item-1']);
            expect(page3.hasMore).toBe(false);
            expect(page3.nextCursor).toBeNull();

            // Full set check: no missed or duplicate items
            const allPaginated = [...page1.items, ...page2.items, ...page3.items];
            expect(allPaginated).toEqual(items);
        });

        test('supports forward chronological traversal ("after")', () => {
            const cursor = PaginationCursor.encode(2000, 'item-2');
            const res = paginateItems(items, { limit: 2, cursor, direction: 'after' });
            expect(res.items.length).toBe(2);
            expect(res.items.map(i => i.id)).toEqual(['item-3', 'item-4']);
            expect(res.hasMore).toBe(true);
        });

        test('handles tie-breaking by id for identical timestamps', () => {
            const tieItems: TestItem[] = [
                { id: 'b', timestamp: 1000, content: 'B' },
                { id: 'a', timestamp: 1000, content: 'A' },
            ];

            const page1 = paginateItems(tieItems, { limit: 1, direction: 'before' });
            expect(page1.items[0].id).toBe('b');
            expect(page1.hasMore).toBe(true);

            const page2 = paginateItems(tieItems, { limit: 1, cursor: page1.nextCursor!, direction: 'before' });
            expect(page2.items[0].id).toBe('a');
            expect(page2.hasMore).toBe(false);
        });
    });

    describe('FeedModule Keyset Pagination', () => {
        let sov: SovereignS3nc;
        let feed: FeedModule;
        const today = new Date().toISOString().split('T')[0];

        beforeEach(async () => {
            (global as any).indexedDB = new IDBFactory();
            const testId = Math.random().toString(36).substring(7);
            sov = new SovereignS3nc({
                paths: { appId: `test-app-${testId}`, userId: 'alice', storeId: 'main' },
                password: 'password123',
                debug: false,
                localPersistencePath: `./test-data/feed-pag-${testId}`
            }, new MockRemote());
            await sov.init();
            feed = new FeedModule(sov);
        });

        test('getPostsPaginated queries single partition database with limit and cursor', async () => {
            // Create 5 posts with distinct timestamps
            for (let i = 1; i <= 5; i++) {
                await feed.post(`Post ${i}`);
                await new Promise(r => setTimeout(r, 10));
            }

            // Page 1: limit 2
            const page1 = await feed.getPostsPaginated(today, 'public', { limit: 2 });
            expect(page1.items.length).toBe(2);
            expect(page1.hasMore).toBe(true);
            expect(page1.nextCursor).not.toBeNull();
            expect(page1.items[0].content).toBe('Post 5');
            expect(page1.items[1].content).toBe('Post 4');

            // Page 2: limit 2 with cursor
            const page2 = await feed.getPostsPaginated(today, 'public', { limit: 2, cursor: page1.nextCursor! });
            expect(page2.items.length).toBe(2);
            expect(page2.hasMore).toBe(true);
            expect(page2.items[0].content).toBe('Post 3');
            expect(page2.items[1].content).toBe('Post 2');

            // Page 3: limit 2 with cursor
            const page3 = await feed.getPostsPaginated(today, 'public', { limit: 2, cursor: page2.nextCursor! });
            expect(page3.items.length).toBe(1);
            expect(page3.hasMore).toBe(false);
            expect(page3.nextCursor).toBeNull();
            expect(page3.items[0].content).toBe('Post 1');

            // Backward compatibility: getPosts returns all 5 posts
            const allPosts = await feed.getPosts(today, 'public');
            expect(allPosts.length).toBe(5);
        });

        test('getFeedPostsPaginated paginates combined feed with like enrichment', async () => {
            for (let i = 1; i <= 4; i++) {
                await feed.post(`Feed item ${i}`);
                await new Promise(r => setTimeout(r, 10));
            }

            const allBefore = await feed.getFeedPosts(5);
            // Like post 4
            await feed.like(allBefore[0].id);

            const page1 = await feed.getFeedPostsPaginated({ limit: 2, days: 5 });
            expect(page1.items.length).toBe(2);
            expect(page1.hasMore).toBe(true);
            expect(page1.nextCursor).not.toBeNull();
            expect(page1.items[0].content).toBe('Feed item 4');
            expect(page1.items[0].likesCount).toBe(1);
            expect(page1.items[0].likedByMe).toBe(true);

            const page2 = await feed.getFeedPostsPaginated({ limit: 2, cursor: page1.nextCursor!, days: 5 });
            expect(page2.items.length).toBe(2);
            expect(page2.hasMore).toBe(false);
            expect(page2.items[0].content).toBe('Feed item 2');
            expect(page2.items[1].content).toBe('Feed item 1');

            // Backward compatibility: getFeedPosts returns full array
            const fullFeed = await feed.getFeedPosts(5);
            expect(fullFeed.length).toBe(4);
        });
    });

    describe('MessagingModule Keyset Pagination', () => {
        let sovAlice: SovereignS3nc;
        let sovBob: SovereignS3nc;
        let messagingAlice: MessagingModule;
        let messagingBob: MessagingModule;

        beforeEach(async () => {
            (global as any).indexedDB = new IDBFactory();
            const remote = new MockRemote();
            const appId = `msg-pag-app-${Math.random().toString(36).substring(7)}`;

            sovAlice = new SovereignS3nc({
                paths: { appId, userId: 'alice', storeId: 'main' },
                password: 'password123',
                debug: false
            }, remote);
            await sovAlice.init();
            messagingAlice = new MessagingModule(sovAlice);

            sovBob = new SovereignS3nc({
                paths: { appId, userId: 'bob', storeId: 'main' },
                password: 'password123',
                debug: false
            }, remote);
            await sovBob.init();
            messagingBob = new MessagingModule(sovBob);

            // Follow each other
            await sovAlice.follow('bob', sovBob.getConfig().publicEncryptionKey);
            await sovBob.follow('alice', sovAlice.getConfig().publicEncryptionKey);
        });

        test('getInboxMessagesPaginated supports limit, cursor, and conversationWith filter', async () => {
            // Alice sends Bob 4 messages
            for (let i = 1; i <= 4; i++) {
                await messagingAlice.sendDirectMessage('bob', `Message ${i}`);
                await new Promise(r => setTimeout(r, 10));
            }

            // Alice queries outbox messages with pagination
            const page1 = await messagingAlice.getInboxMessagesPaginated({ limit: 2, days: 5 });
            expect(page1.items.length).toBe(2);
            expect(page1.hasMore).toBe(true);
            expect(page1.nextCursor).not.toBeNull();
            expect(page1.items[0].content).toBe('Message 4');
            expect(page1.items[1].content).toBe('Message 3');

            const page2 = await messagingAlice.getInboxMessagesPaginated({
                limit: 2,
                cursor: page1.nextCursor!,
                days: 5
            });
            expect(page2.items.length).toBe(2);
            expect(page2.hasMore).toBe(false);
            expect(page2.items[0].content).toBe('Message 2');
            expect(page2.items[1].content).toBe('Message 1');

            // conversationWith filter
            const bobFiltered = await messagingAlice.getInboxMessagesPaginated({
                limit: 10,
                conversationWith: 'bob'
            });
            expect(bobFiltered.items.length).toBe(4);

            const nonExistentFiltered = await messagingAlice.getInboxMessagesPaginated({
                limit: 10,
                conversationWith: 'charlie'
            });
            expect(nonExistentFiltered.items.length).toBe(0);

            // Backward compatibility
            const fullInbox = await messagingAlice.getInboxMessages(5);
            expect(fullInbox.length).toBe(4);
        });
    });

    describe('Repository Keyset Pagination', () => {
        let sov: SovereignS3nc;

        beforeEach(async () => {
            (global as any).indexedDB = new IDBFactory();
            const testId = Math.random().toString(36).substring(7);
            sov = new SovereignS3nc({
                paths: { appId: `test-repo-${testId}`, userId: 'alice', storeId: 'main' },
                password: 'password123',
                debug: false
            }, new MockRemote());
            await sov.init();
        });

        test('findPaginated supports pagination on repositories', async () => {
            const ctx = sov.createModuleContext('custom_test');
            ctx.registerDefinition({
                name: 'custom_test',
                tables: [
                    {
                        name: 'events',
                        schema: 'id TEXT PRIMARY KEY, timestamp INTEGER, title TEXT'
                    }
                ]
            });

            const repo = ctx.getRepository<{ id: string; timestamp: number; title: string }>('events');
            for (let i = 1; i <= 3; i++) {
                await repo.insert({ id: `ev-${i}`, timestamp: 1000 * i, title: `Event ${i}` });
            }

            const page1 = await repo.findPaginated(undefined, { limit: 2, direction: 'before' });
            expect(page1.items.length).toBe(2);
            expect(page1.hasMore).toBe(true);
            expect(page1.items[0].id).toBe('ev-3');
            expect(page1.items[1].id).toBe('ev-2');

            const page2 = await repo.findPaginated(undefined, { limit: 2, cursor: page1.nextCursor!, direction: 'before' });
            expect(page2.items.length).toBe(1);
            expect(page2.hasMore).toBe(false);
            expect(page2.items[0].id).toBe('ev-1');
        });
    });
});
