import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import { IStorage, FollowedUser } from '../interfaces/IStorage';
import { Logger } from '../utils/Logger';

export class NodeStorage implements IStorage {
    private baseDir: string;
    private metadataPath: string;
    private filesDir: string;
    private metadataLock: Promise<void> = Promise.resolve();

    constructor(baseDir: string) {
        this.baseDir = baseDir;
        this.metadataPath = path.join(baseDir, 'metadata.json');
        this.filesDir = path.join(baseDir, 'files');
    }

    async init(): Promise<void> {
        await fs.ensureDir(this.baseDir);
        await fs.ensureDir(this.filesDir);
        if (!(await fs.pathExists(this.metadataPath))) {
            await fs.writeJson(this.metadataPath, { 
                following: [],
                remoteHashCache: {},
                lastSyncDate: null
            });
        }
    }

    private async getMetadata(): Promise<any> {
        return await fs.readJson(this.metadataPath);
    }

    private async saveMetadata(metadata: any): Promise<void> {
        await fs.writeJson(this.metadataPath, metadata);
    }

    private async withMetadataLock<T>(operation: () => Promise<T>): Promise<T> {
        const nextLock = this.metadataLock.then(async () => {
            try {
                return await operation();
            } catch (e) {
                throw e;
            }
        });
        this.metadataLock = nextLock.then(() => {}, () => {});
        return nextLock;
    }

    private getFilePath(filePath: string): string {
        // Sanitize path to prevent directory traversal and leading slash issues
        const safePath = filePath.replace(/\.\./g, '').replace(/^\/+/, '');
        return path.join(this.filesDir, safePath);
    }

    async getDailyDb(date: string, type: 'private' | 'public'): Promise<Uint8Array | null> {
        const filePath = this.getFilePath(`${type}/${date}.db`);
        if (await fs.pathExists(filePath)) {
            return await fs.readFile(filePath);
        }
        return null;
    }

    async saveDailyDb(date: string, type: 'private' | 'public', data: Uint8Array): Promise<void> {
        const filePath = this.getFilePath(`${type}/${date}.db`);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, data);
    }

    async deleteDailyDb(date: string, type: 'private' | 'public'): Promise<void> {
        const filePath = this.getFilePath(`${type}/${date}.db`);
        if (await fs.pathExists(filePath)) {
            await fs.unlink(filePath);
        }
    }

    async getDailyDbHash(date: string, type: 'private' | 'public'): Promise<string | null> {
        const data = await this.getDailyDb(date, type);
        if (!data) return null;
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    async getPublicUserFile(): Promise<Uint8Array | null> {
        return await this.getFile('public/user.json');
    }

    async savePublicUserFile(data: Uint8Array): Promise<void> {
        await this.saveFile('public/user.json', data);
    }

    async getFile(filePath: string): Promise<Uint8Array | null> {
        const fullPath = this.getFilePath(filePath);
        if (await fs.pathExists(fullPath)) {
            return await fs.readFile(fullPath);
        }
        return null;
    }

    async saveFile(filePath: string, data: Uint8Array): Promise<void> {
        const fullPath = this.getFilePath(filePath);
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, data);
    }

    async deleteFile(filePath: string): Promise<void> {
        const fullPath = this.getFilePath(filePath);
        if (await fs.pathExists(fullPath)) {
            await fs.unlink(fullPath);
        }
    }

    async getFileTimestamp(filePath: string): Promise<number | null> {
        const fullPath = this.getFilePath(filePath);
        if (await fs.pathExists(fullPath)) {
            const stat = await fs.stat(fullPath);
            return stat.mtimeMs;
        }
        return null;
    }

    async listFiles(prefix: string): Promise<string[]> {
        const fullPrefix = this.getFilePath(prefix);
        if (!(await fs.pathExists(fullPrefix))) return [];
        
        const files: string[] = [];
        const walk = async (dir: string) => {
            const list = await fs.readdir(dir);
            for (const file of list) {
                const fullPath = path.join(dir, file);
                const stat = await fs.stat(fullPath);
                if (stat.isDirectory()) {
                    await walk(fullPath);
                } else {
                    const relativePath = path.relative(this.filesDir, fullPath);
                    if (relativePath.startsWith(prefix)) {
                        files.push(relativePath);
                    }
                }
            }
        };
        await walk(fullPrefix);
        return files;
    }

    async getGenericRemoteHashCache(filePath: string): Promise<string | null> {
        return this.withMetadataLock(async () => {
            const metadata = await this.getMetadata();
            return metadata.remoteHashCache[filePath] || null;
        });
    }

    async setGenericRemoteHashCache(filePath: string, hash: string): Promise<void> {
        return this.withMetadataLock(async () => {
            const metadata = await this.getMetadata();
            metadata.remoteHashCache[filePath] = hash;
            await this.saveMetadata(metadata);
        });
    }

    async getRemoteHashCache(date: string, type: 'private' | 'public'): Promise<string | null> {
        return this.getGenericRemoteHashCache(`${type}/${date}`);
    }

    async setRemoteHashCache(date: string, type: 'private' | 'public', hash: string): Promise<void> {
        await this.setGenericRemoteHashCache(`${type}/${date}`, hash);
    }

    async getLastSyncDate(): Promise<string | null> {
        return this.withMetadataLock(async () => {
            const metadata = await this.getMetadata();
            return metadata.lastSyncDate;
        });
    }

    async setLastSyncDate(date: string): Promise<void> {
        return this.withMetadataLock(async () => {
            const metadata = await this.getMetadata();
            metadata.lastSyncDate = date;
            await this.saveMetadata(metadata);
        });
    }

    async saveFollowedDb(userId: string, date: string, data: Uint8Array): Promise<void> {
        const filePath = this.getFilePath(`followed/${userId}/${date}.db`);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, data);
    }

    async getFollowedDbHash(userId: string, date: string): Promise<string | null> {
        const filePath = this.getFilePath(`followed/${userId}/${date}.db`);
        if (await fs.pathExists(filePath)) {
            const data = await fs.readFile(filePath);
            return crypto.createHash('sha256').update(data).digest('hex');
        }
        return null;
    }

    async getFollowing(): Promise<FollowedUser[]> {
        return this.withMetadataLock(async () => {
            const metadata = await this.getMetadata();
            return metadata.following;
        });
    }

    async followUser(userId: string, lastSync: string, publicKey: string): Promise<void> {
        return this.withMetadataLock(async () => {
            const metadata = await this.getMetadata();
            const index = metadata.following.findIndex((f: any) => f.userId === userId);
            if (index >= 0) {
                metadata.following[index] = { userId, lastSync, publicKey };
            } else {
                metadata.following.push({ userId, lastSync, publicKey });
            }
            await this.saveMetadata(metadata);
        });
    }

    async unfollowUser(userId: string): Promise<void> {
        return this.withMetadataLock(async () => {
            const metadata = await this.getMetadata();
            metadata.following = metadata.following.filter((f: any) => f.userId !== userId);
            await this.saveMetadata(metadata);
        });
    }

    async updateFollowedUserSync(userId: string, date: string): Promise<void> {
        return this.withMetadataLock(async () => {
            const metadata = await this.getMetadata();
            const index = metadata.following.findIndex((f: any) => f.userId === userId);
            if (index >= 0) {
                metadata.following[index].lastSync = date;
                await this.saveMetadata(metadata);
            }
        });
    }
}
