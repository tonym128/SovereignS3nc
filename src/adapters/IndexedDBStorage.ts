import { IStorage, FollowedUser } from '../interfaces/IStorage';
import { Logger } from '../utils/Logger';

export class IndexedDBStorage implements IStorage {
    private db: IDBDatabase | null = null;
    private dbName: string;

    constructor(dbName: string = 'sovereign_s3nc') {
        this.dbName = dbName;
    }

    async init(): Promise<void> {
        if (this.db) return;
        Logger.debug(`[IDB] Initializing ${this.dbName}...`);
        return new Promise((resolve, reject) => {
            try {
                const request = indexedDB.open(this.dbName, 1);

                request.onerror = (event) => {
                    console.error('[IDB] Error opening database:', request.error);
                    reject(request.error);
                };

                request.onsuccess = (event) => {
                    this.db = (event.target as IDBOpenDBRequest).result;
                    Logger.debug('[IDB] Database opened successfully');
                    resolve();
                };

                request.onupgradeneeded = (event) => {
                    Logger.debug('[IDB] Upgrading database...');
                    const db = (event.target as IDBOpenDBRequest).result;
                    if (!db.objectStoreNames.contains('files')) {
                        db.createObjectStore('files');
                        Logger.debug('[IDB] Created "files" store');
                    }
                    if (!db.objectStoreNames.contains('metadata')) {
                        db.createObjectStore('metadata');
                        Logger.debug('[IDB] Created "metadata" store');
                    }
                };

                request.onblocked = () => {
                    Logger.warn('[IDB] Database opening blocked. Please close other tabs of this app.');
                };
            } catch (e) {
                reject(e);
            }
        });
    }

    private getStore(name: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
        if (!this.db) throw new Error('Database not initialized');
        const tx = this.db.transaction(name, mode);
        return tx.objectStore(name);
    }

    private sanitizePath(filePath: string): string {
        return filePath.replace(/\.\./g, '').replace(/^\/+/, '');
    }

    async getDailyDb(date: string, type: 'private' | 'public' | 'followed'): Promise<Uint8Array | null> {
        return new Promise((resolve, reject) => {
            try {
                const store = this.getStore('files');
                const request = store.get(this.sanitizePath(`${type}/${date}`));
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async saveDailyDb(date: string, type: 'private' | 'public' | 'followed', data: Uint8Array): Promise<void> {
        const path = this.sanitizePath(`${type}/${date}`);
        return new Promise((resolve, reject) => {
            try {
                const tx = this.db!.transaction(['files', 'metadata'], 'readwrite');
                const filesStore = tx.objectStore('files');
                const metadataStore = tx.objectStore('metadata');
                
                filesStore.put(data, path);
                metadataStore.put(Date.now(), `timestamp:${path}`);
                
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async deleteDailyDb(date: string, type: 'private' | 'public' | 'followed'): Promise<void> {
        const path = this.sanitizePath(`${type}/${date}`);
        return new Promise((resolve, reject) => {
            try {
                const tx = this.db!.transaction(['files', 'metadata'], 'readwrite');
                const filesStore = tx.objectStore('files');
                const metadataStore = tx.objectStore('metadata');
                
                filesStore.delete(path);
                metadataStore.delete(`timestamp:${path}`);
                
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async getDailyDbHash(date: string, type: 'private' | 'public'): Promise<string | null> {
        const data = await this.getDailyDb(date, type as any);
        if (!data) return null;
        return this.hash(data);
    }

    async getPublicUserFile(): Promise<Uint8Array | null> {
        return this.getFile('public/user.json');
    }

    async savePublicUserFile(data: Uint8Array): Promise<void> {
        await this.saveFile('public/user.json', data);
    }

    async getFile(path: string): Promise<Uint8Array | null> {
        return new Promise((resolve, reject) => {
            try {
                const store = this.getStore('files');
                const request = store.get(this.sanitizePath(path));
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async saveFile(path: string, data: Uint8Array): Promise<void> {
        const sanitizedPath = this.sanitizePath(path);
        return new Promise((resolve, reject) => {
            try {
                const tx = this.db!.transaction(['files', 'metadata'], 'readwrite');
                const filesStore = tx.objectStore('files');
                const metadataStore = tx.objectStore('metadata');
                
                filesStore.put(data, sanitizedPath);
                metadataStore.put(Date.now(), `timestamp:${sanitizedPath}`);
                
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async deleteFile(path: string): Promise<void> {
        const sanitizedPath = this.sanitizePath(path);
        return new Promise((resolve, reject) => {
            try {
                const tx = this.db!.transaction(['files', 'metadata'], 'readwrite');
                const filesStore = tx.objectStore('files');
                const metadataStore = tx.objectStore('metadata');
                
                filesStore.delete(sanitizedPath);
                metadataStore.delete(`timestamp:${sanitizedPath}`);
                
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async getFileTimestamp(path: string): Promise<number | null> {
        return new Promise((resolve, reject) => {
            try {
                const store = this.getStore('metadata');
                const request = store.get(`timestamp:${this.sanitizePath(path)}`);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async listFiles(prefix: string): Promise<string[]> {
        const sanitizedPrefix = this.sanitizePath(prefix);
        return new Promise((resolve, reject) => {
            try {
                const store = this.getStore('files');
                const request = store.getAllKeys();
                request.onsuccess = () => {
                    const allKeys = request.result as string[];
                    resolve(allKeys.filter(k => k.startsWith(sanitizedPrefix)));
                };
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async getGenericRemoteHashCache(path: string): Promise<string | null> {
        return new Promise((resolve, reject) => {
            try {
                const store = this.getStore('metadata');
                const request = store.get(`hash_generic:${path}`);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async setGenericRemoteHashCache(path: string, hash: string): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const store = this.getStore('metadata', 'readwrite');
                const request = store.put(hash, `hash_generic:${path}`);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async getRemoteHashCache(date: string, type: 'private' | 'public'): Promise<string | null> {
        return new Promise((resolve, reject) => {
            try {
                const store = this.getStore('metadata');
                const request = store.get(`hash:${date}-${type}`);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async setRemoteHashCache(date: string, type: 'private' | 'public', hash: string): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const store = this.getStore('metadata', 'readwrite');
                const request = store.put(hash, `hash:${date}-${type}`);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async getLastSyncDate(): Promise<string | null> {
        return new Promise((resolve, reject) => {
            try {
                const store = this.getStore('metadata');
                const request = store.get('lastSyncDate');
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async setLastSyncDate(date: string): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const store = this.getStore('metadata', 'readwrite');
                const request = store.put(date, 'lastSyncDate');
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async saveFollowedDb(userId: string, date: string, data: Uint8Array): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const store = this.getStore('files', 'readwrite');
                const request = store.put(data, `followed/${userId}/${date}`);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    async getFollowedDbHash(userId: string, date: string): Promise<string | null> {
        try {
            const data: Uint8Array | null = await new Promise((resolve, reject) => {
                const store = this.getStore('files');
                const request = store.get(`followed/${userId}/${date}`);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
            return data ? this.hash(data) : null;
        } catch (e) {
            return null;
        }
    }

    async getFollowing(): Promise<FollowedUser[]> {
        try {
            const followingMap: any = await new Promise((resolve, reject) => {
                const store = this.getStore('metadata');
                const request = store.get('following');
                request.onsuccess = () => resolve(request.result || {});
                request.onerror = () => reject(request.error);
            });
            return Object.entries(followingMap).map(([userId, info]: [string, any]) => ({
                userId,
                lastSync: info.lastSync,
                publicKey: info.publicKey
            }));
        } catch (e) {
            return [];
        }
    }

    async followUser(userId: string, lastSync: string, publicKey: string): Promise<void> {
        const following = await this.getFollowingMap();
        if (!following[userId]) {
            following[userId] = { lastSync, publicKey };
            await this.saveFollowingMap(following);
        }
    }

    async unfollowUser(userId: string): Promise<void> {
        const following = await this.getFollowingMap();
        if (following[userId]) {
            delete following[userId];
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
        return new Promise((resolve, reject) => {
            try {
                const store = this.getStore('metadata');
                const request = store.get('following');
                request.onsuccess = () => resolve(request.result || {});
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    private async saveFollowingMap(map: Record<string, any>): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const store = this.getStore('metadata', 'readwrite');
                const request = store.put(map, 'following');
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    private async hash(data: Uint8Array): Promise<string> {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data as any);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
}
