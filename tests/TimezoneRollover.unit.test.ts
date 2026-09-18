import { SovereignS3nc } from '../src/SovereignS3nc';
import { MessagingModule, Message } from '../src/modules/Messaging';
import { FeedModule, Post } from '../src/modules/Feed';
import { IRemoteAdapter } from '../src/interfaces/IRemoteAdapter';
import { IDBFactory } from 'fake-indexeddb';
import crypto from 'crypto';

// Polyfills
(global as any).indexedDB = new IDBFactory();
(global as any).crypto = crypto.webcrypto;
(global as any).TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;

const mockDbStore: { [path: string]: any } = {};

const createMockDb = (existingData?: Uint8Array) => {
    const table: any[] = existingData && existingData.length > 0 ? [[existingData, null]] : [];
    return {
        run: jest.fn((sql: string, params: any[]) => {
            table.push(params);
        }),
        exec: jest.fn((sql: string, params?: any[]) => {
            if (sql.includes('PRAGMA table_info')) {
                return [{ values: [[0, 'id'], [1, 'encrypted_data'], [2, 'ephemeral_pk']] }];
            }
            if (sql.includes('SELECT encrypted_data, ephemeral_pk') || sql.includes('SELECT encrypted_data')) {
                return table.length > 0 ? [{ columns: ['encrypted_data', 'ephemeral_pk'], values: table }] : [];
            }
            if (sql.includes('SELECT * FROM posts')) {
                return table.length > 0 ? [{ columns: ['id', 'content', 'timestamp', 'userId', 'image', 'parentId', 'parentUserId', 'isEdited', 'isDeleted', 'expiresAt'], values: table }] : [];
            }
            if (sql.includes('SELECT status FROM receipts')) {
                return [];
            }
            return [];
        }),
        export: jest.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
        close: jest.fn()
    };
};

(globalThis as any).initSqlJs = jest.fn().mockResolvedValue({
    Database: jest.fn().mockImplementation((data) => createMockDb(data))
});

class MockRemote implements IRemoteAdapter {
    files: Map<string, { data: Uint8Array; hash: string; etag: string }> = new Map();
    async uploadFile(path: string, data: Uint8Array): Promise<string | null> {
        const etag = `"${Math.random().toString(36).substring(7)}"`;
        this.files.set(path, { data, hash: '', etag });
        return etag;
    }
    async downloadFile(path: string): Promise<any | null> {
        const entry = this.files.get(path);
        if (!entry) return null;
        return { data: entry.data, etag: entry.etag };
    }
    async getFileHash(): Promise<string | null> { return null; }
    async getFileEtag(): Promise<string | null> { return null; }
    async canWrite(): Promise<boolean> { return true; }
    async listFiles(prefix: string): Promise<string[]> {
        return Array.from(this.files.keys()).filter(k => k.startsWith(prefix));
    }
    async deleteFile(path: string): Promise<void> { this.files.delete(path); }
}

describe('Timezone & Midnight UTC Boundary Rollover Tests', () => {
    let aliceSov: SovereignS3nc;
    let bobSov: SovereignS3nc;
    let aliceMessaging: MessagingModule;
    let bobMessaging: MessagingModule;
    let aliceFeed: FeedModule;
    let remote: MockRemote;

    beforeEach(async () => {
        (global as any).indexedDB = new IDBFactory();
        remote = new MockRemote();

        aliceSov = new SovereignS3nc({
            paths: { appId: 'tz-test-alice', userId: 'alice', storeId: 'main' },
            password: 'alice-password-123'
        }, new MockRemote());
        await aliceSov.init();

        bobSov = new SovereignS3nc({
            paths: { appId: 'tz-test-bob', userId: 'bob', storeId: 'main' },
            password: 'bob-password-456'
        }, new MockRemote());
        await bobSov.init();

        aliceMessaging = new MessagingModule(aliceSov);
        bobMessaging = new MessagingModule(bobSov);
        aliceFeed = new FeedModule(aliceSov);
    });

    test('SovereignS3nc.getDateStr strictly adheres to UTC date regardless of local timezone offset', () => {
        // Test date at 23:59:59 UTC
        const dateBeforeMidnight = new Date(Date.UTC(2026, 8, 17, 23, 59, 59));
        expect(SovereignS3nc.getDateStr(dateBeforeMidnight)).toBe('2026-09-17');

        // Test date 2 seconds later at 00:00:01 UTC
        const dateAfterMidnight = new Date(Date.UTC(2026, 8, 18, 0, 0, 1));
        expect(SovereignS3nc.getDateStr(dateAfterMidnight)).toBe('2026-09-18');
    });

    test('Messaging retrieves messages sent across midnight UTC boundary in sorted order', async () => {
        const alicePub = aliceSov.getConfig().publicEncryptionKey!;
        jest.spyOn(bobSov, 'getFollowing').mockResolvedValue([
            { userId: 'alice', lastSync: '', publicKey: alicePub }
        ]);

        // Mock two messages: one before midnight UTC and one after midnight UTC
        const msgDay1: Message = {
            id: 'msg-day-1',
            content: 'Message sent at 23:59:59 UTC',
            timestamp: new Date(Date.UTC(2026, 8, 17, 23, 59, 59)).getTime(),
            senderId: 'alice',
            recipientId: 'bob'
        };

        const msgDay2: Message = {
            id: 'msg-day-2',
            content: 'Message sent at 00:00:05 UTC',
            timestamp: new Date(Date.UTC(2026, 8, 18, 0, 0, 5)).getTime(),
            senderId: 'alice',
            recipientId: 'bob'
        };

        const todayStr = new Date().toISOString().split('T')[0];
        const yesterdayDate = new Date();
        yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
        const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

        // Bob reads incoming files from storage
        jest.spyOn(bobSov.getStorage(), 'getFile').mockImplementation(async (path: string) => {
            if (path.includes(yesterdayStr) || path.includes(todayStr) || path.includes('receipts')) {
                return new Uint8Array([1, 2, 3]);
            }
            return null;
        });

        // Mock decryption to return the corresponding message
        let callCount = 0;
        jest.spyOn(bobSov, 'decrypt').mockImplementation(async () => {
            callCount++;
            const msgToReturn = callCount % 2 === 1 ? msgDay1 : msgDay2;
            return new TextEncoder().encode(JSON.stringify(msgToReturn));
        });

        // Query inbox with 3-day window
        const inbox = await bobMessaging.getInboxMessages(3);
        expect(inbox.length).toBeGreaterThanOrEqual(1);

        // Verify sorting: newer messages appear first
        if (inbox.length >= 2) {
            expect(inbox[0].timestamp).toBeGreaterThanOrEqual(inbox[1].timestamp);
        }
    });

    test('getInboxMessages includes UTC tomorrow to tolerate sender clock skew', async () => {
        const alicePub = aliceSov.getConfig().publicEncryptionKey!;
        jest.spyOn(bobSov, 'getFollowing').mockResolvedValue([
            { userId: 'alice', lastSync: '', publicKey: alicePub }
        ]);

        // Compute tomorrow's UTC date string
        const tomorrow = new Date();
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        let queriedTomorrow = false;
        jest.spyOn(bobSov.getStorage(), 'getFile').mockImplementation(async (path: string) => {
            if (path.includes(tomorrowStr)) {
                queriedTomorrow = true;
                return new Uint8Array([1, 2, 3]);
            }
            return null;
        });

        jest.spyOn(bobSov, 'decrypt').mockResolvedValue(
            new TextEncoder().encode(JSON.stringify({
                id: 'skewed-msg',
                content: 'Message from 5 minutes in future',
                timestamp: Date.now() + 300000,
                senderId: 'alice',
                recipientId: 'bob'
            }))
        );

        const messages = await bobMessaging.getInboxMessages(2);
        expect(queriedTomorrow).toBe(true);
        expect(messages.some(m => m.id === 'skewed-msg')).toBe(true);
    });

    test('Feed getFeedPosts aggregates posts across midnight rollover dates', async () => {
        const today = new Date().toISOString().split('T')[0];
        const yesterdayDate = new Date();
        yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
        const yesterday = yesterdayDate.toISOString().split('T')[0];

        const postYesterday: Post = {
            id: 'post-yesterday',
            content: 'Late night post before midnight',
            timestamp: Date.now() - 3600000,
            userId: 'alice'
        };

        const postToday: Post = {
            id: 'post-today',
            content: 'Early morning post after midnight',
            timestamp: Date.now(),
            userId: 'alice'
        };

        jest.spyOn(aliceFeed, 'getPosts').mockImplementation(async (date: string) => {
            if (date.includes(yesterday)) return [postYesterday];
            if (date.includes(today)) return [postToday];
            return [];
        });

        const feedPosts = await aliceFeed.getFeedPosts(2, false);
        expect(feedPosts.length).toBe(2);
        // Verify sorted newest first
        expect(feedPosts[0].id).toBe('post-today');
        expect(feedPosts[1].id).toBe('post-yesterday');
    });
});
