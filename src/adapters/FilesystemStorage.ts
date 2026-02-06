import { IStorage, FollowedUser } from '../interfaces/IStorage';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';

interface MetaData {
    lastSyncDate: string | null;
    remoteHashes: Record<string, string>; // key: "date-type" -> hash
    following: Record<string, { lastSync: string, publicKey: string }>; // userId -> info
}

export class FilesystemStorage implements IStorage {
    private rootDir: string;
    private metaFile: string;
    private metaCache: MetaData = { lastSyncDate: null, remoteHashes: {}, following: {} };

    constructor(basePath: string) {
        this.rootDir = basePath;
        this.metaFile = path.join(this.rootDir, 'sovereign_meta.json');
    }

    async init(): Promise<void> {
        await fs.ensureDir(this.rootDir);
        await fs.ensureDir(path.join(this.rootDir, 'private'));
        await fs.ensureDir(path.join(this.rootDir, 'public'));
        
        if (await fs.pathExists(this.metaFile)) {
            try {
                this.metaCache = await fs.readJSON(this.metaFile);
            } catch (e) {
                console.warn('Failed to read meta file, resetting cache', e);
                this.metaCache = { lastSyncDate: null, remoteHashes: {}, following: {} };
            }
        }
    }

    async getDailyDb(date: string, type: 'private' | 'public'): Promise<Uint8Array | null> {
        const filePath = this.getFilePath(date, type);
        if (await fs.pathExists(filePath)) {
            return await fs.readFile(filePath);
        }
        return null;
    }

    async saveDailyDb(date: string, type: 'private' | 'public' | 'followed', data: Uint8Array): Promise<void> {
        const filePath = this.getFilePath(date, type);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, data);
    }

    async getDailyDbHash(date: string, type: 'private' | 'public'): Promise<string | null> {
         const data = await this.getDailyDb(date, type);
         if (!data) return null;
         return crypto.createHash('sha256').update(data).digest('hex');
    }

    async getPublicUserFile(): Promise<Uint8Array | null> {
        const filePath = path.join(this.rootDir, 'public', 'user.json'); 
        if (await fs.pathExists(filePath)) return await fs.readFile(filePath);
        return null;
    }

    async savePublicUserFile(data: Uint8Array): Promise<void> {
         const filePath = path.join(this.rootDir, 'public', 'user.json');
         await fs.ensureDir(path.dirname(filePath));
         await fs.writeFile(filePath, data);
    }

    async getRemoteHashCache(date: string, type: 'private' | 'public'): Promise<string | null> {
        const key = `${date}-${type}`;
        return this.metaCache.remoteHashes[key] || null;
    }

    async setRemoteHashCache(date: string, type: 'private' | 'public', hash: string): Promise<void> {
        const key = `${date}-${type}`;
        this.metaCache.remoteHashes[key] = hash;
        await this.saveMeta();
    }

    async getLastSyncDate(): Promise<string | null> {
        return this.metaCache.lastSyncDate;
    }

    async setLastSyncDate(date: string): Promise<void> {
        this.metaCache.lastSyncDate = date;
        await this.saveMeta();
    }

    async saveFollowedDb(userId: string, date: string, data: Uint8Array): Promise<void> {
        const filePath = this.getFollowedPath(userId, date);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, data);
    }

    async getFollowedDbHash(userId: string, date: string): Promise<string | null> {
        const filePath = this.getFollowedPath(userId, date);
        if (await fs.pathExists(filePath)) {
            const data = await fs.readFile(filePath);
            return crypto.createHash('sha256').update(data).digest('hex');
        }
        return null;
    }

    private getFollowedPath(userId: string, date: string): string {
        return path.join(this.rootDir, 'followed', userId, 'public', `${date}.db`);
    }

    async getFollowing(): Promise<FollowedUser[]> {
        if (!this.metaCache.following || Array.isArray(this.metaCache.following)) {
             return [];
        }
        return Object.entries(this.metaCache.following).map(([userId, info]) => ({ 
            userId, 
            lastSync: info.lastSync, 
            publicKey: info.publicKey 
        }));
    }

    async followUser(userId: string, lastSync: string, publicKey: string): Promise<void> {
        if (!this.metaCache.following || Array.isArray(this.metaCache.following)) this.metaCache.following = {};
        
        if (!this.metaCache.following[userId]) {
            this.metaCache.following[userId] = { lastSync, publicKey };
            await this.saveMeta();
        }
    }

    async updateFollowedUserSync(userId: string, date: string): Promise<void> {
        if (!this.metaCache.following || Array.isArray(this.metaCache.following)) return;
        if (this.metaCache.following[userId]) {
            this.metaCache.following[userId].lastSync = date;
            await this.saveMeta();
        }
    }

    private getFilePath(date: string, type: 'private' | 'public' | 'followed'): string {
        if (type === 'followed') {
            // date here is used as "userId/dateStr"
            return path.join(this.rootDir, 'followed', `${date}.db`);
        }
        return path.join(this.rootDir, type, `${date}.db`);
    }

    private async saveMeta() {
        await fs.writeJSON(this.metaFile, this.metaCache);
    }
}
