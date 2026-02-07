import { IStorage, FollowedUser } from '../interfaces/IStorage';
import { openDB, IDBPDatabase } from 'idb';

export class IndexedDBStorage implements IStorage {
    private db!: IDBPDatabase;
    private readonly DB_NAME = 'sovereign_s3nc';
    private readonly STORE_FILES = 'files';
    private readonly STORE_META = 'metadata';

    async init(): Promise<void> {
        this.db = await openDB(this.DB_NAME, 1, {
            upgrade(db) {
                db.createObjectStore('files');
                db.createObjectStore('metadata');
            },
        });
    }

    async getDailyDb(date: string, type: 'private' | 'public' | 'followed'): Promise<Uint8Array | null> {
        return (await this.db.get(this.STORE_FILES, `${type}/${date}`)) || null;
    }

    async saveDailyDb(date: string, type: 'private' | 'public' | 'followed', data: Uint8Array): Promise<void> {
        await this.db.put(this.STORE_FILES, data, `${type}/${date}`);
    }

    async getDailyDbHash(date: string, type: 'private' | 'public'): Promise<string | null> {
        const data = await this.getDailyDb(date, type);
        if (!data) return null;
        return this.hash(data);
    }

    async getPublicUserFile(): Promise<Uint8Array | null> {
        return (await this.db.get(this.STORE_FILES, 'public/user.json')) || null;
    }

    async savePublicUserFile(data: Uint8Array): Promise<void> {
        await this.db.put(this.STORE_FILES, data, 'public/user.json');
    }

    async getRemoteHashCache(date: string, type: 'private' | 'public'): Promise<string | null> {
        return (await this.db.get(this.STORE_META, `hash:${date}-${type}`)) || null;
    }

    async setRemoteHashCache(date: string, type: 'private' | 'public', hash: string): Promise<void> {
        await this.db.put(this.STORE_META, hash, `hash:${date}-${type}`);
    }

    async getLastSyncDate(): Promise<string | null> {
        return (await this.db.get(this.STORE_META, 'lastSyncDate')) || null;
    }

    async setLastSyncDate(date: string): Promise<void> {
        await this.db.put(this.STORE_META, date, 'lastSyncDate');
    }

    async saveFollowedDb(userId: string, date: string, data: Uint8Array): Promise<void> {
        await this.db.put(this.STORE_FILES, data, `followed/${userId}/${date}`);
    }

    async getFollowedDbHash(userId: string, date: string): Promise<string | null> {
        const data = await this.db.get(this.STORE_FILES, `followed/${userId}/${date}`);
        return data ? this.hash(data) : null;
    }

    async getFollowing(): Promise<FollowedUser[]> {
        const following = await this.db.get(this.STORE_META, 'following') || {};
        return Object.entries(following).map(([userId, info]: [string, any]) => ({
            userId,
            lastSync: info.lastSync,
            publicKey: info.publicKey
        }));
    }

    async followUser(userId: string, lastSync: string, publicKey: string): Promise<void> {
        const following = await this.db.get(this.STORE_META, 'following') || {};
        if (!following[userId]) {
            following[userId] = { lastSync, publicKey };
            await this.db.put(this.STORE_META, following, 'following');
        }
    }

    async updateFollowedUserSync(userId: string, date: string): Promise<void> {
        const following = await this.db.get(this.STORE_META, 'following') || {};
        if (following[userId]) {
            following[userId].lastSync = date;
            await this.db.put(this.STORE_META, following, 'following');
        }
    }

    private async hash(data: Uint8Array): Promise<string> {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
}
