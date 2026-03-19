import { SovereignConfig } from './types';
import { IStorage } from './interfaces/IStorage';
import { IRemoteAdapter } from './interfaces/IRemoteAdapter';
import { S3RemoteAdapter } from './adapters/S3RemoteAdapter';
import { IndexedDBStorage } from './adapters/IndexedDBStorage';
import * as crypto from 'crypto';
import * as path from 'path';

export class SovereignS3nc {
    public static readonly VERSION = '1.1.0';
    private storage: IStorage;
    private remote: IRemoteAdapter; // Private Remote
    private publicRemote: IRemoteAdapter;
    private globalRemote: IRemoteAdapter;
    private config: SovereignConfig;
    private remoteFactory?: (userId: string) => IRemoteAdapter;
    private isSyncing: boolean = false;

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

        // Auto-detect environment for storage
        const isBrowser = typeof globalThis !== 'undefined' && typeof (globalThis as any).indexedDB !== 'undefined';
        if (isBrowser) {
            const dbName = `sov_${config.paths.appId}_${config.paths.userId}`;
            this.storage = new IndexedDBStorage(dbName);
        } else {
            throw new Error('IndexedDBStorage requested but not in a browser environment.');
        }
        
        // Initialize Remotes
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

            // Global Remote - Simplified path
            this.globalRemote = new S3RemoteAdapter(config.s3, {
                appId: config.paths.appId,
                userId: 'global',
                storeId: 'users'
            });

            // Private Remote - Initialize with a dummy or same as public for now, 
            // but it will be replaced in initKeys with the proper Private GUID.
            this.remote = this.publicRemote;
        } else {
            throw new Error('S3 configuration required for this version');
        }
    }

    async init() {
        console.log(`[Sovereign] v${SovereignS3nc.VERSION} Initializing storage...`);
        await this.storage.init();
        if (this.config.password && (!this.config.encryptionKey || !this.config.publicEncryptionKey)) {
            console.log('[Sovereign] Initializing keys...');
            await this.initKeys();
        }
        
        // Ensure we are in the global registry even before the first sync
        if (this.config.publicEncryptionKey) {
            await this.ensureGlobalRegistration();
        }

        console.log('[Sovereign] Initialization complete.');
    }

    private async initKeys() {
        const password = this.config.password!;
        const publicUserId = this.config.paths.userId;
        const appId = this.config.paths.appId;
        
        console.log('[Keys] Step 1: Deriving secrets from password...');
        // 1. Derive Deterministic Secrets from password
        // Master Key for encrypting the key-file
        let masterKey: string;
        let privateId: string;
        
        try {
            masterKey = crypto.pbkdf2Sync(password, publicUserId + '-master', 1000, 32, 'sha256').toString('hex');
            privateId = crypto.pbkdf2Sync(password, publicUserId + '-private-id', 1000, 32, 'sha256').toString('hex');
        } catch (e: any) {
            console.error('[Keys] PBKDF2 failed. This usually means crypto-browserify is not working correctly.');
            throw new Error(`Secret derivation failed: ${e.message}`);
        }
        
        console.log(`[Keys] Derived Private GUID for ${publicUserId}: ${privateId.substring(0,8)}...`);

        // 2. Initialize the Private Remote with the secret GUID
        console.log('[Keys] Step 2: Initializing Private Remote...');
        try {
            if (!this.remoteFactory && this.config.s3) {
                this.remote = new S3RemoteAdapter(this.config.s3, {
                    appId: appId,
                    userId: privateId,
                    storeId: this.config.paths.storeId
                });
            } else if (this.remoteFactory) {
                this.remote = this.remoteFactory(privateId);
            }
        } catch (e: any) {
            console.error('[Keys] Remote initialization failed:', e.message);
            throw e;
        }

        // 3. Try to load keys from local private storage
        console.log('[Keys] Step 3: Checking local storage for keys...');
        let keyInfo: { privateKey: string, publicKey: string } | null = null;
        let localKeyData: Uint8Array | null = null;
        try {
            localKeyData = await this.storage.getDailyDb('_keys', 'private'); 
            console.log(`[Keys] Local key data search complete. Found: ${!!localKeyData}`);
        } catch (e: any) {
            console.error(`[Keys] Error reading local keys: ${e.message}`);
        }
        
        if (localKeyData) {
            console.log('[Keys] Decrypting local keys...');
            try {
                const decrypted = await this.decrypt(localKeyData, masterKey);
                keyInfo = JSON.parse(decrypted.toString());
                console.log('[Keys] Local keys decrypted successfully.');
            } catch (e: any) {
                console.warn(`[Keys] Failed to decrypt local keys: ${e.message}`);
            }
        }

        // 4. If not found locally, try remote (at the Private GUID path)
        if (!keyInfo) {
            console.log('[Keys] Step 4: Trying to download keys from remote...');
            const result = await this.remote.downloadFile('_keys.json');
            console.log(`[Keys] Remote key data download complete. Found: ${!!result?.data}`);
            if (result && result.data) {
                try {
                    console.log('[Keys] Decrypting remote keys...');
                    const decrypted = await this.decrypt(result.data, masterKey);
                    keyInfo = JSON.parse(decrypted.toString());
                    await this.storage.saveDailyDb('_keys', 'private', result.data);
                    console.log('[Keys] Remote keys decrypted and saved locally.');
                } catch (e: any) {
                    throw new Error(`Failed to decrypt remote keys: ${e.message}. Incorrect password?`);
                }
            } else {
                console.log('[Keys] No remote keys found.');
            }
        }

        // 5. Generate new keys if still not found
        if (!keyInfo) {
            console.log('[Keys] Step 5: Generating new persistent key pair.');
            const privateKey = crypto.randomBytes(32).toString('hex');
            const publicKey = crypto.randomBytes(32).toString('hex');
            keyInfo = { privateKey, publicKey };

            console.log('[Keys] Encrypting new keys for storage...');
            const encrypted = await this.encrypt(Buffer.from(JSON.stringify(keyInfo)), masterKey);
            await this.storage.saveDailyDb('_keys', 'private', encrypted);
            console.log('[Keys] Uploading new keys to remote...');
            await this.remote.uploadFile('_keys.json', encrypted);
            console.log('[Keys] New keys generated, saved and uploaded.');
        }

        this.config.encryptionKey = keyInfo.privateKey;
        this.config.publicEncryptionKey = keyInfo.publicKey;
    }

    async sync() {
        if (this.isSyncing) {
            console.log('[Sovereign] Sync already in progress, skipping...');
            return;
        }
        this.isSyncing = true;
        try {
            // 1. Sync My Data (Private & Public)
            const lastSync = await this.storage.getLastSyncDate();
            const today = SovereignS3nc.getDateStr(new Date()); // Now UTC
            
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
                syncDates.add(SovereignS3nc.getDateStr(iterDate));
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

            // 4. Sync Blobs and other files
            await this.syncGenericFiles('public/blobs/');
            await this.syncGenericFiles('public/dms/');
            await this.syncGenericFiles('private/blobs/');
            await this.syncGenericFiles('private/dms/');

            await this.storage.setLastSyncDate(today);
        } finally {
            this.isSyncing = false;
        }
    }

    async saveBlob(data: Uint8Array, isPublic: boolean = true): Promise<string> {
        const hash = this.calculateHashedContent(data);
        const type = isPublic ? 'public' : 'private';
        const path = `${type}/blobs/${hash}`;
        await this.storage.saveFile(path, data);
        return path;
    }

    async getBlob(path: string, userId?: string): Promise<Uint8Array | null> {
        const myId = this.config.paths.userId;
        if (!userId || userId === myId) {
            let data = await this.storage.getFile(path);
            if (!data) {
                // Try to download from own remote
                const activeRemote = path.startsWith('public/') ? this.publicRemote : this.remote;
                const key = path.startsWith('public/') ? undefined : this.config.encryptionKey;
                const result = await activeRemote.downloadFile(path);
                if (result && result.data) {
                    data = result.data;
                    if (key) {
                        data = await this.decrypt(data, key);
                    }
                    await this.storage.saveFile(path, data);
                }
            }
            return data;
        }

        // Fetch from another user's public blobs
        if (!path.startsWith('public/')) {
            throw new Error('Only public blobs can be fetched from other users');
        }

        const userRemote = this.createRemote(userId);
        const result = await userRemote.downloadFile(path);
        if (result && result.data) {
            const data = result.data;
            // Check if it matches hash (Public blobs are not encrypted/salted)
            const expectedHash = path.split('/').pop();
            const actualHash = this.calculateHashedContent(data);
            if (expectedHash !== actualHash) {
                console.warn(`[Blob] Hash mismatch for ${path}. Expected ${expectedHash}, got ${actualHash}`);
            }

            await this.storage.saveFile(`followed/${userId}/${path}`, data);
            return data;
        }
        return null;
    }

    private async syncGenericFiles(prefix: string) {
        try {
            const files = await this.storage.listFiles(prefix);
            const isPublic = prefix.startsWith('public/');
            const activeRemote = isPublic ? this.publicRemote : this.remote;
            // Public blobs are NOT encrypted for easy sharing
            const key = isPublic ? undefined : this.config.encryptionKey;

            for (const filePath of files) {
                const localData = await this.storage.getFile(filePath);
                if (!localData) continue;

                const localHash = this.calculateHashedContent(localData, key);
                const cachedEtag = await this.storage.getGenericRemoteHashCache(filePath);
                
                // First check by hash (already an optimization)
                const remoteHash = await activeRemote.getFileHash(filePath);

                if (localHash !== remoteHash) {
                    console.log(`[Sync] Uploading generic file: ${filePath}`);
                    let uploadData = localData;
                    if (key) {
                        uploadData = await this.encrypt(localData, key);
                    }
                    const etag = await activeRemote.uploadFile(filePath, uploadData, localHash);
                    if (etag) await this.storage.setGenericRemoteHashCache(filePath, etag);
                } else if (!cachedEtag) {
                    // Even if hashes match, we might want to cache the ETag if we don't have it
                    const remoteEtag = await activeRemote.getFileEtag(filePath);
                    if (remoteEtag) await this.storage.setGenericRemoteHashCache(filePath, remoteEtag);
                }
            }
        } catch (e: any) {
            console.warn(`[Sync] syncGenericFiles failed for ${prefix}: ${e.message}`);
        }
    }

    private async ensureGlobalRegistration() {
        const remotePath = 'users.json';
        const myUserId = this.config.paths.userId;
        const myPublicKey = this.config.publicEncryptionKey!;
        
        console.log(`[Sync] Checking global registry at ${remotePath}`);
        let userList: { userId: string, publicKey: string }[] = [];
        let remoteData: Uint8Array | null = null;
        
        try {
            const result = await this.globalRemote.downloadFile(remotePath);
            if (result && result.data) remoteData = result.data;
        } catch (e: any) {
            console.warn(`[Sync] Could not reach global registry (offline?): ${e.message}`);
            return; // We are likely offline, skip registration for now
        }
        
        if (remoteData) {
            try {
                userList = JSON.parse(new TextDecoder().decode(remoteData));
            } catch (e) {
                console.warn('[Sync] Global user registry corrupted. Resetting.');
                userList = [];
            }
        }
        
        if (!userList.find(u => u.userId === myUserId) || userList.find(u => u.userId === myUserId)?.publicKey !== myPublicKey) {
            console.log(`[Sync] Registering/Updating user ${myUserId} in global registry.`);
            const existing = userList.find(u => u.userId === myUserId);
            if (existing) {
                existing.publicKey = myPublicKey;
            } else {
                userList.push({ userId: myUserId, publicKey: myPublicKey });
            }
            const newData = new TextEncoder().encode(JSON.stringify(userList));
            try {
                await this.globalRemote.uploadFile(remotePath, newData);
            } catch (e: any) {
                console.warn(`[Sync] Failed to update global registry: ${e.message}`);
            }
        }
    }

    async follow(userId: string) {
        // Note: For explicit follow we need the public key too. 
        // We'll try to find it in the global registry
        const remotePath = 'users.json';
        const result = await this.globalRemote.downloadFile(remotePath);
        if (result && result.data) {
            const userList: { userId: string, publicKey: string }[] = JSON.parse(new TextDecoder().decode(result.data));
            const user = userList.find(u => u.userId === userId);
            if (user) {
                const startDate = new Date();
                startDate.setUTCDate(startDate.getUTCDate() - 7);
                await this.storage.followUser(userId, SovereignS3nc.getDateStr(startDate), user.publicKey);
                return;
            }
        }
        throw new Error('User not found in registry');
    }

    async unfollow(userId: string) {
        await this.storage.unfollowUser(userId);
    }

    async getFollowing() {
        return this.storage.getFollowing();
    }

    async testPermissions() {
        console.log('[Sovereign] Testing permissions for other user paths...');
        const registry = await this.getPublicRegistry();
        for (const user of registry) {
            if (user.userId === this.config.paths.userId) continue;
            const remote = this.createRemote(user.userId);
            const path = 'public/user.json';
            try {
                const hash = await remote.getFileHash(path);
                console.log(`[Sovereign] Success reading ${user.userId}: Hash=${hash}`);
            } catch (e: any) {
                console.error(`[Sovereign] Permission denied for ${user.userId}: ${e.message}`);
            }
        }
    }

    async getPublicRegistry(): Promise<{userId: string, publicKey: string}[]> {
        console.log('[Sovereign] Fetching public registry...');
        const remotePath = 'users.json';
        const result = await this.globalRemote.downloadFile(remotePath);
        if (!result || !result.data) return [];
        try {
            return JSON.parse(new TextDecoder().decode(result.data));
        } catch (e) {
            return [];
        }
    }

    private async discoverAndFollowUsers(today: string) {
        const remotePath = 'users.json';
        let remoteData: Uint8Array | null = null;
        try {
            const result = await this.globalRemote.downloadFile(remotePath);
            if (result && result.data) remoteData = result.data;
        } catch (e: any) {
            console.warn('[Sync] Failed to download global registry (offline?)', e.message);
            return;
        }
        
        if (!remoteData) return;

        try {
            const userList: { userId: string, publicKey: string }[] = JSON.parse(new TextDecoder().decode(remoteData));
            const following = await this.storage.getFollowing();
            const followingIds = following.map(u => u.userId);

            for (const user of userList) {
                if (user.userId !== this.config.paths.userId && !followingIds.includes(user.userId)) {
                    // New user discovered! Set lastSync to 7 days ago
                    const startDate = new Date();
                    startDate.setUTCDate(startDate.getUTCDate() - 7);
                    const lastSyncStr = SovereignS3nc.getDateStr(startDate);
                    
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
                const dateStr = SovereignS3nc.getDateStr(iter);
                await this.pullUserDay(user.userId, dateStr, user.publicKey);
                
                // Also pull DMs from this user to me
                const myId = this.config.paths.userId;
                const dmPath = `public/dms/${myId}/${dateStr}.db`;
                // Public DM databases are NOT file-level encrypted (their rows are)
                await this.pullUserFile(user.userId, dmPath, user.publicKey, `followed/${user.userId}/dms/${dateStr}.db`, false);
                
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

    private async pullUserFile(userId: string, remotePath: string, publicKey: string, localPath: string, expectEncrypted: boolean = true) {
        try {
            const userRemote = this.createRemote(userId);
            const cachedEtag = await this.storage.getGenericRemoteHashCache(`${userId}:${remotePath}`);
            
            console.log(`[Sync] Downloading ${userId}/${remotePath}...`);
            const result = await userRemote.downloadFile(remotePath, cachedEtag || undefined);
            
            if (result && !result.notModified && result.data) {
                let data = result.data;
                try {
                    if (expectEncrypted) {
                        data = await this.decrypt(data, publicKey);
                    }
                    await this.storage.saveFile(localPath, data);
                    if (result.etag) await this.storage.setGenericRemoteHashCache(`${userId}:${remotePath}`, result.etag);
                } catch (e: any) {
                    console.warn(`[Sync] Failed to process ${remotePath} from ${userId}: ${e.message}`);
                }
            }
        } catch (e: any) {
            console.warn(`[Sync] pullUserFile failed for ${userId}/${remotePath}: ${e.message}`);
        }
    }

    private async pullUserDay(userId: string, date: string, publicKey: string) {
        try {
            // Create a temporary remote for this specific user's public store
            const userRemote = this.createRemote(userId);
            const filePath = `public/${date}.db`;
            const cachedEtag = await this.storage.getRemoteHashCache(`${userId}:${date}`, 'followed' as any);

            console.log(`[Sync] Downloading ${userId}/${date}...`);
            const result = await userRemote.downloadFile(filePath, cachedEtag || undefined);

            if (result && !result.notModified && result.data) {
                let data = result.data;
                try {
                    data = await this.decrypt(data, publicKey);
                    await this.storage.saveDailyDb(`${userId}/${date}`, 'followed' as any, data);
                    if (result.etag) await this.storage.setRemoteHashCache(`${userId}:${date}`, 'followed' as any, result.etag);
                    console.log(`[Sync] Pulled followed content for ${userId}: ${filePath}`);
                } catch (e: any) {
                    console.warn(`[Sync] Failed to decrypt followed content from ${userId} (${date}). Error: ${e.message}`);
                }
            } else if (result?.notModified) {
                console.log(`[Sync] Skipping download for ${userId}/${date}, etags match.`);
            }
        } catch (e: any) {
            console.warn(`[Sync] pullUserDay failed for ${userId}/${date}: ${e.message}`);
        }
    }

    public static getDateStr(date: Date): string {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private async syncDay(date: string, type: 'private' | 'public', localPublicKey?: string, remoteOverride?: IRemoteAdapter) {
        try {
            const remotePath = `${type}/${date}.db`;
            const activeRemote = remoteOverride || this.remote;
            
            let localData = await this.storage.getDailyDb(date, type);
            // Use provided public key if it's a followed user sync, otherwise use config
            const currentKey = type === 'private' ? this.config.encryptionKey : (localPublicKey || this.config.publicEncryptionKey);
            const cachedEtag = await this.storage.getRemoteHashCache(date, type);

            if (!localData) {
                console.log(`[Sync] Downloading ${remotePath}`);
                const result = await activeRemote.downloadFile(remotePath);
                if (result && result.data) {
                    let data = result.data;
                    if (currentKey) {
                        data = await this.decrypt(data, currentKey);
                    }
                    await this.storage.saveDailyDb(date, type, data);
                    if (result.etag) await this.storage.setRemoteHashCache(date, type, result.etag);
                }
            } else {
                // Calculate hash including the key to force re-upload if key changes
                const localHash = this.calculateHashedContent(localData, currentKey);
                const remoteHash = await activeRemote.getFileHash(remotePath);
                
                if (localHash === remoteHash) {
                    if (!cachedEtag) {
                        const remoteEtag = await activeRemote.getFileEtag(remotePath);
                        if (remoteEtag) await this.storage.setRemoteHashCache(date, type, remoteEtag);
                    }
                    return;
                }

                console.log(`[Sync] Uploading ${remotePath} (Reason: Content or Key change)`);
                let uploadData = localData;
                if (currentKey) {
                    uploadData = await this.encrypt(localData, currentKey);
                }
                const etag = await activeRemote.uploadFile(remotePath, uploadData, localHash);
                if (etag) await this.storage.setRemoteHashCache(date, type, etag);
            }
        } catch (e: any) {
            console.warn(`[Sync] syncDay failed for ${date}/${type}: ${e.message}`);
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
            const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(encrypted), decipher.final()]);
        } catch (e: any) {
            throw new Error(`Decryption failed (key: ${key.substring(0,6)}...): ${e.message}`);
        }
    }
    
    private async syncUserFile() {
        try {
            const remotePath = 'public/user.json';
            const localData = await this.storage.getPublicUserFile();
            const key = this.config.publicEncryptionKey;
            const cachedEtag = await this.storage.getGenericRemoteHashCache(remotePath);

            if (!localData) {
                 const result = await this.publicRemote.downloadFile(remotePath);
                 if (result && result.data) {
                    let data = result.data;
                    if (key) data = await this.decrypt(data, key);
                    await this.storage.savePublicUserFile(data);
                    if (result.etag) await this.storage.setGenericRemoteHashCache(remotePath, result.etag);
                 }
            } else {
                const remoteHash = await this.publicRemote.getFileHash(remotePath);
                const localHash = this.calculateHashedContent(localData, key);
                if (localHash === remoteHash) {
                    if (!cachedEtag) {
                        const remoteEtag = await this.publicRemote.getFileEtag(remotePath);
                        if (remoteEtag) await this.storage.setGenericRemoteHashCache(remotePath, remoteEtag);
                    }
                    return;
                }
                console.log(`[Sync] Uploading ${remotePath}`);
                let uploadData = localData;
                if (key) uploadData = await this.encrypt(localData, key);
                const etag = await this.publicRemote.uploadFile(remotePath, uploadData, localHash);
                if (etag) await this.storage.setGenericRemoteHashCache(remotePath, etag);
            }
        } catch (e: any) {
            console.warn(`[Sync] syncUserFile failed: ${e.message}`);
        }
    }
}
