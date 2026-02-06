import { SovereignConfig } from './types';
import { IStorage } from './interfaces/IStorage';
import { FilesystemStorage } from './adapters/FilesystemStorage';
import { IRemoteAdapter } from './interfaces/IRemoteAdapter';
import { S3RemoteAdapter } from './adapters/S3RemoteAdapter';
import * as crypto from 'crypto';

export class SovereignS3nc {
    private storage: IStorage;
    private remote: IRemoteAdapter;
    private globalRemote: IRemoteAdapter;
    private config: SovereignConfig;
    private remoteFactory?: (userId: string) => IRemoteAdapter;

    constructor(config: SovereignConfig, remote?: IRemoteAdapter, remoteFactory?: (userId: string) => IRemoteAdapter) {
        this.config = config;
        this.remoteFactory = remoteFactory;
        // Initialize Storage
        const localPath = config.localPersistencePath || './data';
        this.storage = new FilesystemStorage(localPath);
        
        // Initialize Remote
        if (remote) {
            this.remote = remote;
            // For testing, we assume the same remote handles global paths if provided manually
            this.globalRemote = remote; 
        } else if (config.s3) {
            this.remote = new S3RemoteAdapter(config.s3, config.paths);
            
            // Global Remote: Points to {appId}/global/
            this.globalRemote = new S3RemoteAdapter(config.s3, {
                appId: config.paths.appId,
                userId: 'global',
                storeId: 'registry'
            });
        } else {
            throw new Error('S3 configuration required for this version');
        }
    }

    async init() {
        await this.storage.init();
    }

    async sync() {
        // 1. Sync My Data (Private & Public)
        const lastSync = await this.storage.getLastSyncDate();
        const today = this.getDateStr(new Date()); // Now UTC
        
        let currentDate: Date;
        if (lastSync) {
            currentDate = new Date(lastSync);
        } else {
            currentDate = new Date();
        }

        const end = new Date();
        // Normalize to UTC midnight
        currentDate.setUTCHours(0, 0, 0, 0);
        end.setUTCHours(0, 0, 0, 0);
        
        const syncDates = new Set<string>();
        syncDates.add(today);

        // We use a temp date for iteration
        let iterDate = new Date(currentDate);
        while (iterDate <= end) {
            syncDates.add(this.getDateStr(iterDate));
            iterDate.setUTCDate(iterDate.getUTCDate() + 1);
        }
        
        const sortedDates = Array.from(syncDates).sort();
        for (const dateStr of sortedDates) {
            await this.syncDay(dateStr, 'private');
            await this.syncDay(dateStr, 'public');
        }
        
        await this.syncUserFile();

        // 2. Global Discovery & Auto-Follow
        await this.ensureGlobalRegistration();
        await this.discoverAndFollowUsers(today);

        // 3. Sync Followed Users (Per-User Logic)
        await this.syncFollowedUsers(today);

        await this.storage.setLastSyncDate(today);
    }

    private async ensureGlobalRegistration() {
        const path = 'users.json';
        const myUserId = this.config.paths.userId;
        
        let userList: string[] = [];
        const remoteData = await this.globalRemote.downloadFile(path);
        
        if (remoteData) {
            try {
                userList = JSON.parse(remoteData.toString());
            } catch (e) {
                console.warn('[Sync] Global user registry corrupted. Resetting.');
                userList = [];
            }
        }
        
        if (!userList.includes(myUserId)) {
            console.log(`[Sync] Registering user ${myUserId} in global registry.`);
            userList.push(myUserId);
            const newData = Buffer.from(JSON.stringify(userList));
            await this.globalRemote.uploadFile(path, newData);
        }
    }

    async follow(userId: string) {
        const startDate = new Date();
        startDate.setUTCDate(startDate.getUTCDate() - 7);
        await this.storage.followUser(userId, this.getDateStr(startDate));
    }

    private async discoverAndFollowUsers(today: string) {
        const path = 'users.json';
        const remoteData = await this.globalRemote.downloadFile(path);
        if (!remoteData) return;

        try {
            const userList: string[] = JSON.parse(remoteData.toString());
            const following = await this.storage.getFollowing();
            const followingIds = following.map(u => u.userId);

            for (const userId of userList) {
                if (userId !== this.config.paths.userId && !followingIds.includes(userId)) {
                    // New user discovered! Set lastSync to 7 days ago
                    const startDate = new Date();
                    startDate.setUTCDate(startDate.getUTCDate() - 7);
                    const lastSyncStr = this.getDateStr(startDate);
                    
                    console.log(`[Sync] Discovered new user ${userId}, starting from ${lastSyncStr}`);
                    await this.storage.followUser(userId, lastSyncStr);
                }
            }
        } catch (e) {
            console.warn('[Sync] Failed to discover users', e);
        }
    }

    private async syncFollowedUsers(today: string) {
        const following = await this.storage.getFollowing();
        for (const user of following) {
            const startDate = new Date(user.lastSync);
            const endDate = new Date(today);
            
            let iter = new Date(startDate);
            iter.setUTCHours(0, 0, 0, 0);
            endDate.setUTCHours(0, 0, 0, 0);

            while (iter <= endDate) {
                const dateStr = this.getDateStr(iter);
                await this.pullUserDay(user.userId, dateStr);
                iter.setUTCDate(iter.getUTCDate() + 1);
            }
            
            await this.storage.updateFollowedUserSync(user.userId, today);
        }
    }

    private createRemote(userId: string): IRemoteAdapter {
        if (this.remoteFactory) return this.remoteFactory(userId);
        
        if (this.config.s3) {
            return new S3RemoteAdapter(this.config.s3, {
                appId: this.config.paths.appId,
                userId: userId,
                storeId: this.config.paths.storeId
            });
        }
        throw new Error('Remote configuration missing');
    }

    private async pullUserDay(userId: string, date: string) {
        // Create a temporary remote for this specific user's public store
        const userRemote = this.createRemote(userId);

        const path = `public/${date}.db`;
        const remoteHash = await userRemote.getFileHash(path);
        
        if (remoteHash) {
             const localHash = await this.storage.getFollowedDbHash(userId, date);
             if (localHash === remoteHash) {
                 return; // Already have the latest version
             }

             const data = await userRemote.downloadFile(path);
             if (data) {
                 await this.storage.saveFollowedDb(userId, date, data);
                 console.log(`[Sync] Pulled followed content for ${userId}: ${path}`);
             }
        }
    }

    private getDateStr(date: Date): string {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private async syncDay(date: string, type: 'private' | 'public') {
        const path = `${type}/${date}.db`;
        
        const localData = await this.storage.getDailyDb(date, type);
        const remoteHash = await this.remote.getFileHash(path);
        
        if (!localData) {
            // Local missing. 
            if (remoteHash) {
                // Remote exists. Catch up (Download).
                console.log(`[Sync] Downloading ${path}`);
                const data = await this.remote.downloadFile(path);
                if (data) {
                    await this.storage.saveDailyDb(date, type, data);
                    // Update cache
                    const newHash = crypto.createHash('sha256').update(data).digest('hex');
                    await this.storage.setRemoteHashCache(date, type, newHash);
                }
            }
        } else {
            // Local exists.
            const localHash = crypto.createHash('sha256').update(localData).digest('hex');
            
            if (localHash === remoteHash) {
                // Optimization: Hashes match, update our local belief and skip
                await this.storage.setRemoteHashCache(date, type, localHash);
                return;
            }

            // Mismatch.
            console.log(`[Sync] Uploading ${path}`);
            await this.remote.uploadFile(path, localData);
            await this.storage.setRemoteHashCache(date, type, localHash);
        }
    }
    
    private async syncUserFile() {
        const path = 'public/user.json';
        const localData = await this.storage.getPublicUserFile();
        const remoteHash = await this.remote.getFileHash(path);
        
        if (!localData) {
             if (remoteHash) {
                 const data = await this.remote.downloadFile(path);
                 if (data) await this.storage.savePublicUserFile(data);
             }
        } else {
            const localHash = crypto.createHash('sha256').update(localData).digest('hex');
            if (localHash === remoteHash) {
                 return;
            }
            console.log(`[Sync] Uploading ${path}`);
            await this.remote.uploadFile(path, localData);
        }
    }
}
