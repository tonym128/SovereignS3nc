import { IStorage, FollowedUser } from '../interfaces/IStorage';

export class IndexedDBStorage implements IStorage {
    private db: IDBDatabase | null = null;
    private dbName: string;

    constructor(dbName: string = 'sovereign_s3nc') {
        this.dbName = dbName;
    }

    async init(): Promise<void> {
        console.log(`[IDB] Initializing ${this.dbName}...`);
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = (event) => {
                console.error('[IDB] Error opening database:', request.error);
                reject(request.error);
            };

            request.onsuccess = (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                console.log('[IDB] Database opened successfully');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                console.log('[IDB] Upgrading database...');
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains('files')) {
                    db.createObjectStore('files');
                    console.log('[IDB] Created "files" store');
                }
                if (!db.objectStoreNames.contains('metadata')) {
                    db.createObjectStore('metadata');
                    console.log('[IDB] Created "metadata" store');
                }
            };

            request.onblocked = () => {
                console.warn('[IDB] Database opening blocked. Please close other tabs of this app.');
            };
        });
    }

    private async getStore(name: string, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
        if (!this.db) throw new Error('Database not initialized');
        const tx = this.db.transaction(name, mode);
        return tx.objectStore(name);
    }

    async getDailyDb(date: string, type: 'private' | 'public' | 'followed'): Promise<Uint8Array | null> {
        return new Promise(async (resolve, reject) => {
            const store = await this.getStore('files');
            const request = store.get(`${type}/${date}`);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async saveDailyDb(date: string, type: 'private' | 'public' | 'followed', data: Uint8Array): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const store = await this.getStore('files', 'readwrite');
            const request = store.put(data, `${type}/${date}`);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getDailyDbHash(date: string, type: 'private' | 'public'): Promise<string | null> {
        const data = await this.getDailyDb(date, type);
        if (!data) return null;
        return this.hash(data);
    }

    async getPublicUserFile(): Promise<Uint8Array | null> {
        return new Promise(async (resolve, reject) => {
            const store = await this.getStore('files');
            const request = store.get('public/user.json');
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async savePublicUserFile(data: Uint8Array): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const store = await this.getStore('files', 'readwrite');
            const request = store.put(data, 'public/user.json');
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getRemoteHashCache(date: string, type: 'private' | 'public'): Promise<string | null> {
        return new Promise(async (resolve, reject) => {
            const store = await this.getStore('metadata');
            const request = store.get(`hash:${date}-${type}`);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async setRemoteHashCache(date: string, type: 'private' | 'public', hash: string): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const store = await this.getStore('metadata', 'readwrite');
            const request = store.put(hash, `hash:${date}-${type}`);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getLastSyncDate(): Promise<string | null> {
        return new Promise(async (resolve, reject) => {
            const store = await this.getStore('metadata');
            const request = store.get('lastSyncDate');
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async setLastSyncDate(date: string): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const store = await this.getStore('metadata', 'readwrite');
            const request = store.put(date, 'lastSyncDate');
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async saveFollowedDb(userId: string, date: string, data: Uint8Array): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const store = await this.getStore('files', 'readwrite');
            const request = store.put(data, `followed/${userId}/${date}`);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getFollowedDbHash(userId: string, date: string): Promise<string | null> {
        const data: Uint8Array | null = await new Promise(async (resolve, reject) => {
            const store = await this.getStore('files');
            const request = store.get(`followed/${userId}/${date}`);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
        return data ? this.hash(data) : null;
    }

    async getFollowing(): Promise<FollowedUser[]> {
        const followingMap: any = await new Promise(async (resolve, reject) => {
            const store = await this.getStore('metadata');
            const request = store.get('following');
            request.onsuccess = () => resolve(request.result || {});
            request.onerror = () => reject(request.error);
        });
        return Object.entries(followingMap).map(([userId, info]: [string, any]) => ({
            userId,
            lastSync: info.lastSync,
            publicKey: info.publicKey
        }));
    }

    async followUser(userId: string, lastSync: string, publicKey: string): Promise<void> {
        const following = await this.getFollowingMap();
        if (!following[userId]) {
            following[userId] = { lastSync, publicKey };
            await this.saveFollowingMap(following);
        }
    }

    async updateFollowedUserSync(userId: string, date: string): Promise<void> {
        const following = await this.getFollowingMap();
        if (following[userId]) {
            following[userId].lastSync = date;
            await this.saveFollowingMap(following);
        }
    }

    private async getFollowingMap(): Promise<Record<string, any>> {
        return new Promise(async (resolve, reject) => {
            const store = await this.getStore('metadata');
            const request = store.get('following');
            request.onsuccess = () => resolve(request.result || {});
            request.onerror = () => reject(request.error);
        });
    }

    private async saveFollowingMap(map: Record<string, any>): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const store = await this.getStore('metadata', 'readwrite');
            const request = store.put(map, 'following');
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    private async hash(data: Uint8Array): Promise<string> {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data as any);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
}