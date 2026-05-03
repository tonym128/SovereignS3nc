import * as fs from 'fs-extra';
import * as path from 'path';
import { IStorage } from '../interfaces/IStorage';
import { Logger } from '../utils/Logger';
import { env } from '../utils/Environment';
import { ModuleError } from '../utils/Errors';

export class SQLiteNodeStorage implements IStorage {
    private db: any;
    private sqliteInstance: any;

    constructor(private dbPath: string) {}

    async init(): Promise<void> {
        await fs.ensureDir(path.dirname(this.dbPath));

        const initSqlJs = env.getSqlJs();
        if (!initSqlJs) {
            Logger.error('Storage', 'Failed to load sql.js. Ensure it is installed or available in globalThis.');
            throw new ModuleError('storage', 'sql.js not found');
        }

        this.sqliteInstance = await initSqlJs(env.getSqlConfig() || {});

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
            CREATE TABLE IF NOT EXISTS following (
                userId TEXT PRIMARY KEY,
                lastSync TEXT,
                publicKey TEXT
            );
            CREATE TABLE IF NOT EXISTS remote_hash_cache (
                path TEXT PRIMARY KEY,
                hash TEXT
            );
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        `);
    }

    async getDailyDb(date: string, type: 'private' | 'public'): Promise<Uint8Array | null> {
        return await this.getFile(`${type}/${date}.db`);
    }

    async saveDailyDb(date: string, type: 'private' | 'public', data: Uint8Array): Promise<void> {
        await this.saveFile(`${type}/${date}.db`, data);
    }

    async deleteDailyDb(date: string, type: 'private' | 'public'): Promise<void> {
        await this.deleteFile(`${type}/${date}.db`);
    }

    async getDailyDbHash(date: string, type: 'private' | 'public'): Promise<string | null> {
        const res = this.db.exec('SELECT hash FROM files WHERE path = ?', [`${type}/${date}.db`]);
        if (res.length > 0 && res[0].values.length > 0) {
            return res[0].values[0][0];
        }
        return null;
    }

    async getPublicUserFile(): Promise<Uint8Array | null> {
        return await this.getFile('public/user.json');
    }

    async savePublicUserFile(data: Uint8Array): Promise<void> {
        await this.saveFile('public/user.json', data);
    }

    async getFile(filePath: string): Promise<Uint8Array | null> {
        const res = this.db.exec('SELECT data FROM files WHERE path = ?', [filePath]);
        if (res.length > 0 && res[0].values.length > 0) {
            return res[0].values[0][0];
        }
        return null;
    }

    async saveFile(filePath: string, data: Uint8Array): Promise<void> {
        const hash = await this.calculateHash(data);
        const updatedAt = Date.now();
        this.db.run('INSERT OR REPLACE INTO files (path, data, hash, updatedAt) VALUES (?, ?, ?, ?)', [filePath, data, hash, updatedAt]);
        await this.persist();
    }

    async deleteFile(filePath: string): Promise<void> {
        this.db.run('DELETE FROM files WHERE path = ?', [filePath]);
        await this.persist();
    }

    async getFileTimestamp(filePath: string): Promise<number | null> {
        const res = this.db.exec('SELECT updatedAt FROM files WHERE path = ?', [filePath]);
        if (res.length > 0 && res[0].values.length > 0) {
            return res[0].values[0][0];
        }
        return null;
    }

    async listFiles(prefix: string): Promise<string[]> {
        const res = this.db.exec('SELECT path FROM files WHERE path LIKE ?', [`${prefix}%`]);
        if (res.length > 0) {
            return res[0].values.map((v: any) => v[0]);
        }
        return [];
    }

    async getGenericRemoteHashCache(filePath: string): Promise<string | null> {
        const res = this.db.exec('SELECT hash FROM remote_hash_cache WHERE path = ?', [filePath]);
        if (res.length > 0 && res[0].values.length > 0) {
            return res[0].values[0][0];
        }
        return null;
    }

    async setGenericRemoteHashCache(filePath: string, hash: string): Promise<void> {
        this.db.run('INSERT OR REPLACE INTO remote_hash_cache (path, hash) VALUES (?, ?)', [filePath, hash]);
        await this.persist();
    }

    async getRemoteHashCache(date: string, type: 'private' | 'public'): Promise<string | null> {
        return await this.getGenericRemoteHashCache(`${type}/${date}`);
    }

    async setRemoteHashCache(date: string, type: 'private' | 'public', hash: string): Promise<void> {
        await this.setGenericRemoteHashCache(`${type}/${date}`, hash);
    }

    async getLastSyncDate(): Promise<string | null> {
        const res = this.db.exec("SELECT value FROM metadata WHERE key = 'lastSyncDate'");
        if (res.length > 0 && res[0].values.length > 0) {
            return res[0].values[0][0];
        }
        return null;
    }

    async setLastSyncDate(date: string): Promise<void> {
        this.db.run("INSERT OR REPLACE INTO metadata (key, value) VALUES ('lastSyncDate', ?)", [date]);
        await this.persist();
    }

    async saveFollowedDb(userId: string, date: string, data: Uint8Array): Promise<void> {
        await this.saveFile(`followed/${userId}/${date}.db`, data);
    }

    async getFollowedDbHash(userId: string, date: string): Promise<string | null> {
        return await this.getDailyDbHash(date, 'followed' as any); // Type hack
    }

    async getFollowing(): Promise<any[]> {
        const res = this.db.exec('SELECT * FROM following');
        if (res.length > 0) {
            const columns = res[0].columns;
            return res[0].values.map((row: any) => {
                const user: any = {};
                columns.forEach((col: string, i: number) => {
                    user[col] = row[i];
                });
                return user;
            });
        }
        return [];
    }

    async followUser(userId: string, lastSync: string, publicKey: string): Promise<void> {
        this.db.run('INSERT OR REPLACE INTO following (userId, lastSync, publicKey) VALUES (?, ?, ?)', [userId, lastSync, publicKey]);
        await this.persist();
    }

    async unfollowUser(userId: string): Promise<void> {
        this.db.run('DELETE FROM following WHERE userId = ?', [userId]);
        await this.persist();
    }

    async updateFollowedUserSync(userId: string, date: string): Promise<void> {
        this.db.run('UPDATE following SET lastSync = ? WHERE userId = ?', [date, userId]);
        await this.persist();
    }

    private async persist() {
        const binary = this.db.export();
        await fs.writeFile(this.dbPath, binary);
    }

    private async calculateHash(data: Uint8Array): Promise<string> {
        const { createHash } = await import('crypto');
        return createHash('sha256').update(data).digest('hex');
    }
}
