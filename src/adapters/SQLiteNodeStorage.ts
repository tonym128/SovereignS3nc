
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import { IStorage, FollowedUser } from '../interfaces/IStorage';
import { Logger } from '../utils/Logger';

/**
 * SQLiteNodeStorage stores all files and metadata in a single SQLite database file.
 * Useful for server-side persistence or consolidated local storage in Node.js.
 * Uses sql.js for cross-platform compatibility.
 */
export class SQLiteNodeStorage implements IStorage {
    private dbPath: string;
    private sqliteInstance: any = null;
    private db: any = null;

    constructor(dbPath: string) {
        this.dbPath = dbPath;
    }

    async init(): Promise<void> {
        // @ts-ignore
        const initSqlJs = (globalThis as any).initSqlJs || require('sql.js');
        if (!this.sqliteInstance) {
            this.sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});
        }

        let data: Uint8Array | null = null;
        if (await fs.pathExists(this.dbPath)) {
            data = await fs.readFile(this.dbPath);
        }

        this.db = new this.sqliteInstance.Database(data || undefined);

        // Initialize schema
        this.db.run(`
            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY,
                data BLOB,
                hash TEXT,
                updatedAt INTEGER
            );
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        `);

        // Initialize metadata if not present
        const check = this.db.exec("SELECT key FROM metadata WHERE key = 'following'");
        if (check.length === 0) {
            this.db.run("INSERT INTO metadata (key, value) VALUES ('following', '[]')");
            this.db.run("INSERT INTO metadata (key, value) VALUES ('remoteHashCache', '{}')");
            this.db.run("INSERT INTO metadata (key, value) VALUES ('lastSyncDate', 'null')");
            await this.persist();
        }
    }

    private async persist(): Promise<void> {
        const data = this.db.export();
        await fs.ensureDir(path.dirname(this.dbPath));
        await fs.writeFile(this.dbPath, data);
    }

    async getDailyDb(date: string, type: 'private' | 'public'): Promise<Uint8Array | null> {
        return this.getFile(`${type}/${date}.db`);
    }

    async saveDailyDb(date: string, type: 'private' | 'public', data: Uint8Array): Promise<void> {
        await this.saveFile(`${type}/${date}.db`, data);
    }

    async deleteDailyDb(date: string, type: 'private' | 'public'): Promise<void> {
        await this.deleteFile(`${type}/${date}.db`);
    }

    async getDailyDbHash(date: string, type: 'private' | 'public'): Promise<string | null> {
        const res = this.db.exec("SELECT hash FROM files WHERE path = ?", [`${type}/${date}.db`]);
        if (res.length > 0 && res[0].values.length > 0) {
            return res[0].values[0][0];
        }
        return null;
    }

    async getPublicUserFile(): Promise<Uint8Array | null> {
        return this.getFile('public/user.json');
    }

    async savePublicUserFile(data: Uint8Array): Promise<void> {
        await this.saveFile('public/user.json', data);
    }

    async getFile(filePath: string): Promise<Uint8Array | null> {
        const res = this.db.exec("SELECT data FROM files WHERE path = ?", [filePath]);
        if (res.length > 0 && res[0].values.length > 0) {
            return res[0].values[0][0];
        }
        return null;
    }

    async saveFile(filePath: string, data: Uint8Array): Promise<void> {
        const hash = crypto.createHash('sha256').update(data).digest('hex');
        const now = Date.now();
        this.db.run("INSERT OR REPLACE INTO files (path, data, hash, updatedAt) VALUES (?, ?, ?, ?)", 
            [filePath, data, hash, now]);
        await this.persist();
    }

    async deleteFile(filePath: string): Promise<void> {
        this.db.run("DELETE FROM files WHERE path = ?", [filePath]);
        await this.persist();
    }

    async listFiles(prefix: string): Promise<string[]> {
        const res = this.db.exec("SELECT path FROM files WHERE path LIKE ?", [`${prefix}%`]);
        if (res.length > 0) {
            return res[0].values.map((v: any) => v[0]);
        }
        return [];
    }

    async getGenericRemoteHashCache(filePath: string): Promise<string | null> {
        const cache = await this.getMetadataValue('remoteHashCache');
        const parsed = JSON.parse(cache || '{}');
        return parsed[filePath] || null;
    }

    async setGenericRemoteHashCache(filePath: string, hash: string): Promise<void> {
        const cache = await this.getMetadataValue('remoteHashCache');
        const parsed = JSON.parse(cache || '{}');
        parsed[filePath] = hash;
        await this.setMetadataValue('remoteHashCache', JSON.stringify(parsed));
    }

    async getRemoteHashCache(date: string, type: 'private' | 'public'): Promise<string | null> {
        return this.getGenericRemoteHashCache(`${type}/${date}`);
    }

    async setRemoteHashCache(date: string, type: 'private' | 'public', hash: string): Promise<void> {
        await this.setGenericRemoteHashCache(`${type}/${date}`, hash);
    }

    async getLastSyncDate(): Promise<string | null> {
        const val = await this.getMetadataValue('lastSyncDate');
        return val === 'null' ? null : val;
    }

    async setLastSyncDate(date: string): Promise<void> {
        await this.setMetadataValue('lastSyncDate', date);
    }

    async saveFollowedDb(userId: string, date: string, data: Uint8Array): Promise<void> {
        await this.saveFile(`followed/${userId}/${date}.db`, data);
    }

    async getFollowedDbHash(userId: string, date: string): Promise<string | null> {
        return this.getDailyDbHash(date, `followed/${userId}` as any);
    }

    async getFollowing(): Promise<FollowedUser[]> {
        const val = await this.getMetadataValue('following');
        return JSON.parse(val || '[]');
    }

    async followUser(userId: string, lastSync: string, publicKey: string): Promise<void> {
        const following = await this.getFollowing();
        const index = following.findIndex(f => f.userId === userId);
        if (index >= 0) {
            following[index] = { userId, lastSync, publicKey };
        } else {
            following.push({ userId, lastSync, publicKey });
        }
        await this.setMetadataValue('following', JSON.stringify(following));
    }

    async unfollowUser(userId: string): Promise<void> {
        const following = await this.getFollowing();
        const filtered = following.filter(f => f.userId !== userId);
        await this.setMetadataValue('following', JSON.stringify(filtered));
    }

    async updateFollowedUserSync(userId: string, date: string): Promise<void> {
        const following = await this.getFollowing();
        const index = following.findIndex(f => f.userId === userId);
        if (index >= 0) {
            following[index].lastSync = date;
            await this.setMetadataValue('following', JSON.stringify(following));
        }
    }

    private async getMetadataValue(key: string): Promise<string | null> {
        const res = this.db.exec("SELECT value FROM metadata WHERE key = ?", [key]);
        if (res.length > 0 && res[0].values.length > 0) {
            return res[0].values[0][0];
        }
        return null;
    }

    private async setMetadataValue(key: string, value: string): Promise<void> {
        this.db.run("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)", [key, value]);
        await this.persist();
    }
}
