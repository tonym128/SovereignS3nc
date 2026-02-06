import { SovereignConfig } from './types';
import { IStorage } from './interfaces/IStorage';
import { FilesystemStorage } from './adapters/FilesystemStorage';
import { IRemoteAdapter } from './interfaces/IRemoteAdapter';
import { S3RemoteAdapter } from './adapters/S3RemoteAdapter';
import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';

export class SovereignS3nc {
    private storage: IStorage;
    private remote: IRemoteAdapter; // Private Remote
    private publicRemote: IRemoteAdapter;
    private globalRemote: IRemoteAdapter;
    private config: SovereignConfig;
    private remoteFactory?: (userId: string) => IRemoteAdapter;

    constructor(
        config: SovereignConfig, 
        remote?: IRemoteAdapter, 
        remoteFactory?: (userId: string) => IRemoteAdapter,
        keys?: { privateKey: string, publicKey: string }
    ) {
        this.config = config;
        this.remoteFactory = remoteFactory;
        
        if (keys) {
            this.config.encryptionKey = keys.privateKey;
            this.config.publicEncryptionKey = keys.publicKey;
        }

        // Initialize Storage
        const localPath = config.localPersistencePath || './data';
        this.storage = new FilesystemStorage(localPath);
        
        // Initialize Remotes (Placeholder, will be finalized in initKeys)
        if (remote) {
            this.remote = remote;
            this.publicRemote = remote;
            this.globalRemote = remoteFactory ? remoteFactory('global') : remote; 
        } else if (config.s3) {
            // Public Remote uses the provided userId
            this.publicRemote = new S3RemoteAdapter(config.s3, {
                appId: config.paths.appId,
                userId: config.paths.userId,
                storeId: config.paths.storeId
            });

            // Private Remote - placeholder until initKeys derives the private GUID
            this.remote = this.publicRemote; 

            // Global Remote
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
        if (this.config.password && (!this.config.encryptionKey || !this.config.publicEncryptionKey)) {
            await this.initKeys();
        }
    }

    private async initKeys() {
        const password = this.config.password!;
        const publicUserId = this.config.paths.userId;
        const appId = this.config.paths.appId;
        
        // 1. Derive Deterministic Secrets from password
        // Master Key for encrypting the key-file
        const masterKey = crypto.pbkdf2Sync(password, publicUserId + '-master', 1000, 32, 'sha256').toString('hex');
        // Private GUID for the S3 path
        const privateId = crypto.pbkdf2Sync(password, publicUserId + '-private-id', 1000, 32, 'sha256').toString('hex');
        
        console.log(`[Keys] Derived Private GUID for ${publicUserId}: ${privateId.substring(0,8)}...`);

        // 2. Initialize the Private Remote with the secret GUID
        if (!this.remoteFactory && this.config.s3) {
            this.remote = new S3RemoteAdapter(this.config.s3, {
                appId: appId,
                userId: privateId,
                storeId: this.config.paths.storeId
            });
        } else if (this.remoteFactory) {
            this.remote = this.remoteFactory(privateId);
        }

        // 3. Try to load keys from local private storage
        let keyInfo: { privateKey: string, publicKey: string } | null = null;
        const localKeyData = await this.storage.getDailyDb('_keys', 'private'); 
        
        if (localKeyData) {
            try {
                keyInfo = JSON.parse((await this.decrypt(localKeyData, masterKey)).toString());
            } catch (e: any) {
                console.warn(`[Keys] Failed to decrypt local keys: ${e.message}`);
            }
        }

        // 4. If not found locally, try remote (at the Private GUID path)
        if (!keyInfo) {
            const remoteKeyData = await this.remote.downloadFile('_keys.json');
            if (remoteKeyData) {
                try {
                    keyInfo = JSON.parse((await this.decrypt(remoteKeyData, masterKey)).toString());
                    await this.storage.saveDailyDb('_keys', 'private', remoteKeyData);
                } catch (e: any) {
                    throw new Error(`Failed to decrypt remote keys: ${e.message}. Incorrect password?`);
                }
            }
        }

        // 5. Generate new keys if still not found
        if (!keyInfo) {
            console.log('[Keys] Generating new persistent key pair.');
            const privateKey = crypto.randomBytes(32).toString('hex');
            const publicKey = crypto.randomBytes(32).toString('hex');
            keyInfo = { privateKey, publicKey };

            const encrypted = await this.encrypt(Buffer.from(JSON.stringify(keyInfo)), masterKey);
            await this.storage.saveDailyDb('_keys', 'private', encrypted);
            await this.remote.uploadFile('_keys.json', encrypted);
        }

        this.config.encryptionKey = keyInfo.privateKey;
        this.config.publicEncryptionKey = keyInfo.publicKey;
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
            // Private data goes to PRIVATE remote (this.remote)
            await this.syncDay(dateStr, 'private', undefined, this.remote);
            // Public data goes to PUBLIC remote
            await this.syncDay(dateStr, 'public', undefined, this.publicRemote);
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
        const remotePath = 'users.json';
        const myUserId = this.config.paths.userId;
        const myPublicKey = this.config.publicEncryptionKey!;
        
        console.log(`[Sync] Checking global registry at ${remotePath}`);
        let userList: { userId: string, publicKey: string }[] = [];
        const remoteData = await this.globalRemote.downloadFile(remotePath);
        
        if (remoteData) {
            try {
                userList = JSON.parse(remoteData.toString());
            } catch (e) {
                console.warn('[Sync] Global user registry corrupted. Resetting.');
                userList = [];
            }
        }
        
        const existing = userList.find(u => u.userId === myUserId);
        if (!existing || existing.publicKey !== myPublicKey) {
            console.log(`[Sync] Registering/Updating user ${myUserId} in global registry.`);
            if (existing) {
                existing.publicKey = myPublicKey;
            } else {
                userList.push({ userId: myUserId, publicKey: myPublicKey });
            }
            const newData = Buffer.from(JSON.stringify(userList));
            await this.globalRemote.uploadFile(remotePath, newData);
        }
    }

    async follow(userId: string) {
        // Note: For explicit follow we need the public key too. 
        // We'll try to find it in the global registry
        const remotePath = 'users.json';
        const remoteData = await this.globalRemote.downloadFile(remotePath);
        if (remoteData) {
            const userList: { userId: string, publicKey: string }[] = JSON.parse(remoteData.toString());
            const user = userList.find(u => u.userId === userId);
            if (user) {
                const startDate = new Date();
                startDate.setUTCDate(startDate.getUTCDate() - 7);
                await this.storage.followUser(userId, this.getDateStr(startDate), user.publicKey);
                return;
            }
        }
        throw new Error('User not found in registry');
    }

    private async discoverAndFollowUsers(today: string) {
        const remotePath = 'users.json';
        const remoteData = await this.globalRemote.downloadFile(remotePath);
        if (!remoteData) return;

        try {
            const userList: { userId: string, publicKey: string }[] = JSON.parse(remoteData.toString());
            const following = await this.storage.getFollowing();
            const followingIds = following.map(u => u.userId);

            for (const user of userList) {
                if (user.userId !== this.config.paths.userId && !followingIds.includes(user.userId)) {
                    // New user discovered! Set lastSync to 7 days ago
                    const startDate = new Date();
                    startDate.setUTCDate(startDate.getUTCDate() - 7);
                    const lastSyncStr = this.getDateStr(startDate);
                    
                    console.log(`[Sync] Discovered new user ${user.userId}, starting from ${lastSyncStr}`);
                    await this.storage.followUser(user.userId, lastSyncStr, user.publicKey);
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
                await this.pullUserDay(user.userId, dateStr, user.publicKey);
                iter.setUTCDate(iter.getUTCDate() + 1);
            }
            
            await this.storage.updateFollowedUserSync(user.userId, today);
        }
    }

    private createRemote(userId: string): IRemoteAdapter {
        if (this.remoteFactory) {
            console.log(`[Sync] Creating remote for ${userId} using factory.`);
            return this.remoteFactory(userId);
        }
        
        if (this.config.s3) {
            return new S3RemoteAdapter(this.config.s3, {
                appId: this.config.paths.appId,
                userId: userId,
                storeId: this.config.paths.storeId
            });
        }
        throw new Error('Remote configuration missing');
    }

    private async pullUserDay(userId: string, date: string, publicKey: string) {
        // Create a temporary remote for this specific user's public store
        const userRemote = this.createRemote(userId);

        const filePath = `public/${date}.db`;
        const remoteHash = await userRemote.getFileHash(filePath);
        
        if (remoteHash) {
             // Check if we have this locally in the followed folder
             const localData = await this.storage.getDailyDb(`${userId}/${date}`, 'followed' as any);
             
             if (localData) {
                 const localHashedWithKey = this.calculateHashedContent(localData, publicKey);
                 if (localHashedWithKey === remoteHash) {
                     return; // Already have the latest version
                 }
             }

             let data = await userRemote.downloadFile(filePath);
             if (data) {
                 try {
                    data = await this.decrypt(data, publicKey);
                    await this.storage.saveDailyDb(`${userId}/${date}`, 'followed' as any, data);
                    console.log(`[Sync] Pulled followed content for ${userId}: ${filePath}`);
                 } catch (e: any) {
                    console.warn(`[Sync] Failed to decrypt followed content from ${userId} (${date}). Error: ${e.message}`);
                 }
             }
        }
    }

    private getDateStr(date: Date): string {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private async syncDay(date: string, type: 'private' | 'public', localPublicKey?: string, remoteOverride?: IRemoteAdapter) {
        const remotePath = `${type}/${date}.db`;
        const activeRemote = remoteOverride || this.remote;
        
        let localData = await this.storage.getDailyDb(date, type);
        const remoteHash = await activeRemote.getFileHash(remotePath);
        
        // Use provided public key if it's a followed user sync, otherwise use config
        const currentKey = type === 'private' ? this.config.encryptionKey : (localPublicKey || this.config.publicEncryptionKey);

        if (!localData) {
            if (remoteHash) {
                console.log(`[Sync] Downloading ${remotePath}`);
                let data = await activeRemote.downloadFile(remotePath);
                if (data) {
                    if (currentKey) {
                        data = await this.decrypt(data, currentKey);
                    }
                    await this.storage.saveDailyDb(date, type, data);
                    const newHash = this.calculateHashedContent(data, currentKey);
                    await this.storage.setRemoteHashCache(date, type, newHash);
                }
            }
        } else {
            // Calculate hash including the key to force re-upload if key changes
            const localHash = this.calculateHashedContent(localData, currentKey);
            
            if (localHash === remoteHash) {
                await this.storage.setRemoteHashCache(date, type, localHash);
                return;
            }

            console.log(`[Sync] Uploading ${remotePath} (Reason: Content or Key change)`);
            let uploadData = localData;
            if (currentKey) {
                uploadData = await this.encrypt(localData, currentKey);
            }
            await activeRemote.uploadFile(remotePath, uploadData);
            await this.storage.setRemoteHashCache(date, type, localHash);
        }
    }

    private calculateHashedContent(data: Uint8Array, key?: string): string {
        const hasher = crypto.createHash('sha256').update(data);
        if (key) hasher.update(key); // Salt hash with key
        return hasher.digest('hex');
    }

    private async encrypt(data: Uint8Array, key: string): Promise<Uint8Array> {
        const iv = crypto.randomBytes(12);
        const keyBuffer = Buffer.from(key, 'hex');
        if (keyBuffer.length !== 32) throw new Error(`Invalid key length for encryption: ${keyBuffer.length}. Expected 32.`);
        
        const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
        const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, encrypted]);
    }

    private async decrypt(data: Uint8Array, key: string): Promise<Uint8Array> {
        try {
            const iv = data.slice(0, 12);
            const tag = data.slice(12, 28);
            const encrypted = data.slice(28);
            const keyBuffer = Buffer.from(key, 'hex');
            if (keyBuffer.length !== 32) throw new Error(`Invalid key length for decryption: ${keyBuffer.length}. Expected 32.`);

            const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(encrypted), decipher.final()]);
        } catch (e: any) {
            throw new Error(`Decryption failed (key: ${key.substring(0,6)}...): ${e.message}`);
        }
    }
    
    private async syncUserFile() {
        const remotePath = 'public/user.json';
        const localData = await this.storage.getPublicUserFile();
        const remoteHash = await this.publicRemote.getFileHash(remotePath);
        const key = this.config.publicEncryptionKey;

        if (!localData) {
             if (remoteHash) {
                 let data = await this.publicRemote.downloadFile(remotePath);
                 if (data) {
                    if (key) data = await this.decrypt(data, key);
                    await this.storage.savePublicUserFile(data);
                 }
             }
        } else {
            const localHash = this.calculateHashedContent(localData, key);
            if (localHash === remoteHash) {
                 return;
            }
            console.log(`[Sync] Uploading ${remotePath}`);
            let uploadData = localData;
            if (key) uploadData = await this.encrypt(localData, key);
            await this.publicRemote.uploadFile(remotePath, uploadData);
        }
    }
}
