import * as nacl from 'tweetnacl';
import { SovereignConfig, SovereignManifest, ModuleDefinition, ModuleMigration, SovereignGroup, GroupMember } from './types';
import { IStorage } from './interfaces/IStorage';
import { IRemoteAdapter } from './interfaces/IRemoteAdapter';
import { S3RemoteAdapter } from './adapters/S3RemoteAdapter';
import { IndexedDBStorage } from './adapters/IndexedDBStorage';
import { Logger, LogLevel } from './utils/Logger';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';

export class SovereignS3nc extends EventEmitter {
    public static readonly VERSION = '1.1.0';
    private storage: IStorage;
    private remote: IRemoteAdapter; // Private Remote
    private publicRemote: IRemoteAdapter;
    private globalRemote: IRemoteAdapter;
    private config: SovereignConfig;
    private remoteFactory?: (userId: string) => IRemoteAdapter;
    private registeredModules: ModuleDefinition[] = [];
    private isSyncing: boolean = false;

    constructor(
        config: SovereignConfig, 
        remote?: IRemoteAdapter, 
        remoteFactory?: (userId: string) => IRemoteAdapter,
        keys?: { privateKey: string, publicKey: string },
        storage?: IStorage
    ) {
        super();
        this.config = config;
        this.remoteFactory = remoteFactory;

        // Initialize Logger
        Logger.setLevel(config.debug ? LogLevel.DEBUG : LogLevel.WARN);
        Logger.setPrefix(`[Sovereign:${config.paths.userId}]`);
        
        if (keys) {
            this.config.encryptionKey = keys.privateKey;
            this.config.publicEncryptionKey = keys.publicKey;
        }

        // We will initialize storage in init() because NodeStorage requires dynamic import
        // which is async. For now we set a dummy.
        this.storage = storage || (null as any);
        
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

    public getStorage(): IStorage {
        if (!this.storage) throw new Error('Storage not initialized. Call init() first.');
        return this.storage;
    }

    public getConfig(): SovereignConfig {
        return this.config;
    }

    /**
     * Helper to ensure modules use namespaced paths to avoid collisions with core files.
     * returns a path like "public/modules/social/my-file.db"
     */
    public getModulePath(moduleName: string, subPath: string, type: 'private' | 'public' | 'followed'): string {
        const cleanModule = moduleName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (type === 'followed') {
            // Path is expected to be "userId/subPath"
            const parts = subPath.split('/');
            const userId = parts.shift();
            return `followed/${userId}/modules/${cleanModule}/${parts.join('/')}`;
        }
        return `${type}/modules/${cleanModule}/${subPath}`;
    }

    public registerModule(definition: ModuleDefinition) {
        if (!this.registeredModules.find(m => m.name === definition.name)) {
            this.registeredModules.push(definition);
        }
    }

    /**
     * Emits a change event for a specific module and path.
     * Useful for UI components to subscribe to updates.
     */
    public onModuleUpdate(moduleName: string, path: string) {
        this.emit(`${moduleName}:update`, { moduleName, path });
        this.emit('update', { moduleName, path });
    }

    /**
     * Core utility to apply schema and migrations to a SQLite database.
     */
    public applyModuleSchema(db: any, moduleName: string) {
        const module = this.registeredModules.find(m => m.name === moduleName);
        if (!module) return;

        // 1. Initial Table Creation
        for (const table of module.tables) {
            db.exec(`CREATE TABLE IF NOT EXISTS ${table.name} (${table.schema});`);
        }

        // 2. Handle Migrations
        if (module.migrations && module.migrations.length > 0) {
            const res = db.exec('PRAGMA user_version;');
            let currentVersion = 0;
            if (res && res.length > 0 && res[0].values.length > 0) {
                currentVersion = res[0].values[0][0];
            }

            const pending = module.migrations
                .filter((m: ModuleMigration) => m.version > currentVersion)
                .sort((a: ModuleMigration, b: ModuleMigration) => a.version - b.version);

            for (const migration of pending) {
                Logger.info(`[Schema] Applying migration v${migration.version} to ${moduleName}`);
                for (const sql of migration.sql) {
                    try {
                        db.exec(sql);
                    } catch (e: any) {
                        Logger.warn(`[Schema] Migration v${migration.version} sql failed (likely already applied): ${e.message}`);
                    }
                }
                db.exec(`PRAGMA user_version = ${migration.version};`);
                currentVersion = migration.version;
            }
        }
    }

    async init() {
        if (!this.storage) {
            const isBrowser = typeof globalThis !== 'undefined' && typeof (globalThis as any).indexedDB !== 'undefined';
            if (isBrowser) {
                const dbName = `sov_${this.config.paths.appId}_${this.config.paths.userId}`;
                this.storage = new IndexedDBStorage(dbName);
            } else {
                // Default to NodeStorage in Node environment if no storage provided
                try {
                    const { NodeStorage } = await import('./adapters/NodeStorage');
                    const path = await import('path');
                    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
                    const baseDir = path.join(homeDir, '.sovereigns3nc', this.config.paths.appId, this.config.paths.userId);
                    this.storage = new NodeStorage(baseDir);
                } catch (e: any) {
                    throw new Error(`Failed to load NodeStorage: ${e.message}. If you are in a browser, ensure indexedDB is available.`);
                }
            }
        }

        Logger.info(`[Sovereign] v${SovereignS3nc.VERSION} Initializing storage...`);
        await this.storage.init();
        if (this.config.password && (!this.config.encryptionKey || !this.config.publicEncryptionKey)) {
            Logger.info('[Sovereign] Initializing keys...');
            await this.initKeys();
        }
        
        // Ensure we are in the global registry even before the first sync
        if (this.config.publicEncryptionKey) {
            await this.ensureGlobalRegistration();
        }

        Logger.info('[Sovereign] Initialization complete.');
    }

    private async initKeys() {
        const password = this.config.password!;
        const publicUserId = this.config.paths.userId;
        const appId = this.config.paths.appId;
        
        Logger.info('[Keys] Step 1: Deriving secrets from password...');
        // 1. Derive Deterministic Secrets from password
        // Master Key for encrypting the key-file
        let masterKey: string;
        let privateId: string;
        
        try {
            masterKey = crypto.pbkdf2Sync(password, publicUserId + '-master', 1000, 32, 'sha256').toString('hex');
            privateId = crypto.pbkdf2Sync(password, publicUserId + '-private-id', 1000, 32, 'sha256').toString('hex');
        } catch (e: any) {
            Logger.error('[Keys] PBKDF2 failed. This usually means crypto-browserify is not working correctly.');
            throw new Error(`Secret derivation failed: ${e.message}`);
        }
        
        Logger.info(`[Keys] Derived Private GUID for ${publicUserId}: ${privateId.substring(0,8)}...`);

        // 2. Initialize the Private Remote with the secret GUID
        Logger.info('[Keys] Step 2: Initializing Private Remote...');
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
            Logger.error('[Keys] Remote initialization failed:', e.message);
            throw e;
        }

        // 3. Try to load keys from local private storage
        Logger.info('[Keys] Step 3: Checking local storage for keys...');
        let keyInfo: { privateKey: string, publicKey: string } | null = null;
        let localKeyData: Uint8Array | null = null;
        try {
            localKeyData = await this.storage.getDailyDb('_keys', 'private'); 
            Logger.info(`[Keys] Local key data search complete. Found: ${!!localKeyData}`);
        } catch (e: any) {
            Logger.error(`[Keys] Error reading local keys: ${e.message}`);
        }
        
        if (localKeyData) {
            Logger.info('[Keys] Decrypting local keys...');
            try {
                const decrypted = await this.decrypt(localKeyData, masterKey);
                keyInfo = JSON.parse(decrypted.toString());
                Logger.info('[Keys] Local keys decrypted successfully.');
            } catch (e: any) {
                Logger.warn(`[Keys] Failed to decrypt local keys: ${e.message}`);
            }
        }

        // 4. If not found locally, try remote (at the Private GUID path)
        if (!keyInfo) {
            Logger.info('[Keys] Step 4: Trying to download keys from remote...');
            const result = await this.remote.downloadFile('_keys.json');
            Logger.info(`[Keys] Remote key data download complete. Found: ${!!result?.data}`);
            if (result && result.data) {
                try {
                    Logger.info('[Keys] Decrypting remote keys...');
                    const decrypted = await this.decrypt(result.data, masterKey);
                    keyInfo = JSON.parse(decrypted.toString());
                    await this.storage.saveDailyDb('_keys', 'private', result.data);
                    Logger.info('[Keys] Remote keys decrypted and saved locally.');
                } catch (e: any) {
                    throw new Error(`Failed to decrypt remote keys: ${e.message}. Incorrect password?`);
                }
            } else {
                Logger.info('[Keys] No remote keys found.');
            }
        }

        // 5. Generate new keys if still not found
        if (!keyInfo) {
            Logger.info('[Keys] Step 5: Generating new persistent E2EE key pair.');
            const pair = nacl.box.keyPair();
            keyInfo = { 
                privateKey: Buffer.from(pair.secretKey).toString('hex'), 
                publicKey: Buffer.from(pair.publicKey).toString('hex') 
            };

            Logger.info('[Keys] Encrypting new keys for storage...');
            const encrypted = await this.encrypt(Buffer.from(JSON.stringify(keyInfo)), masterKey);
            await this.storage.saveDailyDb('_keys', 'private', encrypted);
            Logger.info('[Keys] Uploading new keys to remote...');
            await this.remote.uploadFile('_keys.json', encrypted);
            Logger.info('[Keys] New keys generated, saved and uploaded.');
        }

        this.config.encryptionKey = keyInfo.privateKey;
        this.config.publicEncryptionKey = keyInfo.publicKey;
    }

    async sync() {
        if (this.isSyncing) {
            Logger.info('[Sovereign] Sync already in progress, skipping...');
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

            // 4. Sync Groups (Multi-writer Logic)
            await this.syncGroups(today);

            // 5. Sync Blobs and other files
            await this.syncGenericFiles('public/blobs/');
            await this.syncGenericFiles('public/dms/');
            await this.syncGenericFiles('public/modules/');
            await this.syncGenericFiles('public/groups/');
            await this.syncGenericFiles('private/blobs/');
            await this.syncGenericFiles('private/dms/');
            await this.syncGenericFiles('private/modules/');
            await this.syncGenericFiles('private/groups/');

            await this.syncManifest();
            await this.storage.setLastSyncDate(today);
        } finally {
            this.isSyncing = false;
        }
    }

    public async syncManifest() {
        try {
            Logger.info('[Sync] Generating and uploading manifest...');
            const manifest = await this.generateManifest();
            const data = new TextEncoder().encode(JSON.stringify(manifest));
            await this.publicRemote.uploadFile('manifest.json', data);
            Logger.info('[Sync] Manifest uploaded successfully.');
        } catch (e: any) {
            Logger.warn(`[Sync] Failed to sync manifest: ${e.message}`);
        }
    }

    private async generateManifest(): Promise<SovereignManifest> {
        const publicFiles = await this.storage.listFiles('public/');
        const manifest: SovereignManifest = {
            updatedAt: Date.now(),
            userId: this.config.paths.userId,
            modules: {},
            dms: {},
            groups: {}
        };

        const profileData = await this.storage.getPublicUserFile();
        if (profileData) {
            manifest.profileHash = this.calculateHashedContent(profileData);
        }

        for (const file of publicFiles) {
            if (file === 'public/user.json') continue;
            if (file === 'public/manifest.json') continue;

            const parts = file.split('/');
            
            // Base public DB: public/{date}.db
            if (parts.length === 2 && file.endsWith('.db')) {
                const dateStr = parts[1].replace('.db', '');
                if (!manifest.modules['core']) manifest.modules['core'] = [];
                manifest.modules['core'].push(dateStr);
                continue;
            }

            if (file.startsWith('public/modules/')) {
                // Module file: public/modules/{moduleName}/{date}.db
                if (parts.length === 4) {
                    const moduleName = parts[2];
                    const fileName = parts[3];
                    if (fileName.endsWith('.db')) {
                        const dateStr = fileName.replace('.db', '');
                        if (!manifest.modules[moduleName]) manifest.modules[moduleName] = [];
                        manifest.modules[moduleName].push(dateStr);
                    }
                } 
                // DM file: public/modules/social/dms/{recipientId}/{date}.db
                else if (parts.length === 6 && parts[3] === 'dms') {
                    const recipientId = parts[4];
                    const fileName = parts[5];
                    if (fileName.endsWith('.db')) {
                        const dateStr = fileName.replace('.db', '');
                        if (!manifest.dms[recipientId]) manifest.dms[recipientId] = [];
                        manifest.dms[recipientId].push(dateStr);
                    }
                }
            }

            // Group data: public/groups/{groupId}/{date}.db
            if (file.startsWith('public/groups/') && parts.length === 4) {
                const groupId = parts[2];
                const fileName = parts[3];
                if (fileName.endsWith('.db')) {
                    const dateStr = fileName.replace('.db', '');
                    if (!manifest.groups[groupId]) manifest.groups[groupId] = [];
                    manifest.groups[groupId].push(dateStr);
                }
            }
        }
        return manifest;
    }

    /**
     * Creates a new multi-writer group.
     */
    public async createGroup(name: string, members: GroupMember[]): Promise<SovereignGroup> {
        const id = Math.random().toString(36).substring(2, 15);
        const sharedKey = crypto.randomBytes(32).toString('hex');
        const group: SovereignGroup = {
            id,
            name,
            members,
            sharedKey,
            createdAt: Date.now()
        };

        // Save group info privately
        const groupData = new TextEncoder().encode(JSON.stringify(group));
        await this.storage.saveFile(`private/groups/${id}/info.json`, groupData);
        
        Logger.info(`[Group] Created group ${name} (${id})`);
        return group;
    }

    /**
     * Joins an existing group using a shared key and participant list.
     */
    public async joinGroup(group: SovereignGroup) {
        const groupData = new TextEncoder().encode(JSON.stringify(group));
        await this.storage.saveFile(`private/groups/${group.id}/info.json`, groupData);
        Logger.info(`[Group] Joined group ${group.name} (${group.id})`);
    }

    public async getGroups(): Promise<SovereignGroup[]> {
        const files = await this.storage.listFiles('private/groups/');
        const groups: SovereignGroup[] = [];
        for (const file of files) {
            if (file.endsWith('info.json')) {
                const data = await this.storage.getFile(file);
                if (data) {
                    groups.push(JSON.parse(new TextDecoder().decode(data)));
                }
            }
        }
        return groups;
    }

    public async syncGroups(today: string) {
        const groups = await this.getGroups();
        for (const group of groups) {
            Logger.info(`[Sync] Syncing group ${group.name} (${group.id})`);
            
            // 1. Upload my own group data (Public namespace)
            // The actual data is written by modules to public/groups/${groupId}/{date}.db
            // which is handled by syncGenericFiles if we use the right prefix.
            
            // 2. Pull from other members
            for (const member of group.members) {
                if (member.userId === this.config.paths.userId) continue;

                const manifest = await this.fetchManifest(member.userId);
                if (manifest && manifest.groups[group.id]) {
                    for (const dateStr of manifest.groups[group.id]) {
                        const remotePath = `public/groups/${group.id}/${dateStr}.db`;
                        const localPath = `followed/${member.userId}/groups/${group.id}/${dateStr}.db`;
                        
                        // Download and decrypt with Group Shared Key
                        const changed = await this.pullUserFile(member.userId, remotePath, group.sharedKey, localPath, true);
                        if (changed) {
                            this.emit(`group:${group.id}:update`, { userId: member.userId, dateStr });
                        }
                    }
                }
            }
        }
    }

    private async fetchManifest(userId: string): Promise<SovereignManifest | null> {
        try {
            const userRemote = this.createRemote(userId);
            const result = await userRemote.downloadFile('manifest.json');
            if (result && result.data) {
                return JSON.parse(new TextDecoder().decode(result.data));
            }
        } catch (e) {
            Logger.debug(`[Sync] Manifest not found for user ${userId}`);
        }
        return null;
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
                Logger.warn(`[Blob] Hash mismatch for ${path}. Expected ${expectedHash}, got ${actualHash}`);
            }

            await this.storage.saveFile(`followed/${userId}/${path}`, data);
            return data;
        }
        return null;
    }

    private async syncGenericFiles(prefix: string) {
        try {
            const isPublic = prefix.startsWith('public/');
            const activeRemote = isPublic ? this.publicRemote : this.remote;
            const key = isPublic ? undefined : this.config.encryptionKey;

            // 1. Sync Local -> Remote (Upload new files)
            const localFiles = await this.storage.listFiles(prefix);
            for (const filePath of localFiles) {
                const localData = await this.storage.getFile(filePath);
                if (!localData) continue;

                const localHash = this.calculateHashedContent(localData, key);
                const cachedEtag = await this.storage.getGenericRemoteHashCache(filePath);
                const remoteHash = await activeRemote.getFileHash(filePath);

                if (localHash !== remoteHash) {
                    Logger.info(`[Sync] Uploading generic file: ${filePath}`);
                    let uploadData = localData;
                    if (key) uploadData = await this.encrypt(localData, key);
                    const etag = await activeRemote.uploadFile(filePath, uploadData, localHash);
                    if (etag) await this.storage.setGenericRemoteHashCache(filePath, etag);
                } else if (!cachedEtag) {
                    const remoteEtag = await activeRemote.getFileEtag(filePath);
                    if (remoteEtag) await this.storage.setGenericRemoteHashCache(filePath, remoteEtag);
                }
            }

            // 2. Sync Remote -> Local (Download missing files)
            // Note: This requires the remote to support listing, or us to have a manifest.
            // S3RemoteAdapter doesn't currently expose listFiles. 
            // For now, Social module handles its own daily DB pulls via syncFollowedUsers.
        } catch (e: any) {
            Logger.warn(`[Sync] syncGenericFiles failed for ${prefix}: ${e.message}`);
        }
    }

    private async ensureGlobalRegistration() {
        const remotePath = 'users.json';
        const myUserId = this.config.paths.userId;
        const myPublicKey = this.config.publicEncryptionKey!;
        
        Logger.info(`[Sync] Checking global registry at ${remotePath}`);
        let userList: { userId: string, publicKey: string }[] = [];
        let remoteData: Uint8Array | null = null;
        
        try {
            const result = await this.globalRemote.downloadFile(remotePath, undefined, 30000);
            if (result && result.data) remoteData = result.data;
        } catch (e: any) {
            Logger.warn(`[Sync] Could not reach global registry (offline?): ${e.message}`);
            return; // We are likely offline, skip registration for now
        }
        
        if (remoteData) {
            try {
                userList = JSON.parse(new TextDecoder().decode(remoteData));
            } catch (e) {
                Logger.warn('[Sync] Global user registry corrupted. Resetting.');
                userList = [];
            }
        }
        
        if (!userList.find(u => u.userId === myUserId) || userList.find(u => u.userId === myUserId)?.publicKey !== myPublicKey) {
            Logger.info(`[Sync] Registering/Updating user ${myUserId} in global registry.`);
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
                Logger.warn(`[Sync] Failed to update global registry: ${e.message}`);
            }
        }
    }

    async follow(userId: string) {
        // We'll try to find their public key in the global registry first
        const remotePath = 'users.json';
        let publicKey = '';
        try {
            const result = await this.globalRemote.downloadFile(remotePath);
            if (result && result.data) {
                const userList: { userId: string, publicKey: string }[] = JSON.parse(new TextDecoder().decode(result.data));
                const user = userList.find(u => u.userId === userId);
                if (user) publicKey = user.publicKey;
            }
        } catch (e) {}

        const startDate = new Date();
        startDate.setUTCDate(startDate.getUTCDate() - 7);
        // We allow following without a public key (it will just fail to decrypt private DMs until the key is synced later)
        await this.storage.followUser(userId, SovereignS3nc.getDateStr(startDate), publicKey);
        Logger.info(`[Sovereign] Followed ${userId}.`);
    }

    async unfollow(userId: string) {
        await this.storage.unfollowUser(userId);
    }

    async getFollowing() {
        return this.storage.getFollowing();
    }

    async testPermissions() {
        Logger.info('[Sovereign] Testing permissions for other user paths...');
        const registry = await this.getPublicRegistry();
        for (const user of registry) {
            if (user.userId === this.config.paths.userId) continue;
            const remote = this.createRemote(user.userId);
            const path = 'public/user.json';
            try {
                const hash = await remote.getFileHash(path);
                Logger.info(`[Sovereign] Success reading ${user.userId}: Hash=${hash}`);
            } catch (e: any) {
                Logger.error(`[Sovereign] Permission denied for ${user.userId}: ${e.message}`);
            }
        }
    }

    async getPublicRegistry(): Promise<{userId: string, publicKey: string}[]> {
        Logger.info('[Sovereign] Fetching public registry...');
        const remotePath = 'users.json';
        const result = await this.globalRemote.downloadFile(remotePath, undefined, 30000);
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
            const result = await this.globalRemote.downloadFile(remotePath, undefined, 30000);
            if (result && result.data) remoteData = result.data;
        } catch (e: any) {
            Logger.warn('[Sync] Failed to download global registry (offline?)', e.message);
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
                    
                    Logger.info(`[Sync] Discovered new user ${user.userId}, starting from ${lastSyncStr}`);
                    await this.storage.followUser(user.userId, lastSyncStr, user.publicKey);
                }
            }
        } catch (e) {
            Logger.warn('[Sync] Failed to discover users', e);
        }
    }

    private async syncFollowedUsers(today: string) {
        const following = await this.storage.getFollowing();
        for (const user of following) {
            const manifest = await this.fetchManifest(user.userId);
            
            if (manifest) {
                Logger.info(`[Sync] Using manifest for ${user.userId}`);
                // 1. Sync Core/Public DBs from manifest
                if (manifest.modules['core']) {
                    for (const dateStr of manifest.modules['core']) {
                        await this.pullUserDay(user.userId, dateStr, user.publicKey);
                    }
                }

                // 2. Sync Modules from manifest
                for (const [moduleName, dates] of Object.entries(manifest.modules)) {
                    if (moduleName === 'core') continue;
                    for (const dateStr of dates) {
                        const remotePath = this.getModulePath(moduleName, `${dateStr}.db`, 'public');
                        const localPath = this.getModulePath(moduleName, `${user.userId}/${dateStr}.db`, 'followed');
                        const changed = await this.pullUserFile(user.userId, remotePath, user.publicKey, localPath, false);
                        if (changed) this.onModuleUpdate(moduleName, localPath);
                    }
                }

                // 3. Sync DMs for ME from manifest
                const myId = this.config.paths.userId;
                if (manifest.dms[myId]) {
                    for (const dateStr of manifest.dms[myId]) {
                        const dmPath = this.getModulePath('social', `dms/${myId}/${dateStr}.db`, 'public');
                        const localPath = this.getModulePath('social', `${user.userId}/dms/${dateStr}.db`, 'followed');
                        const changed = await this.pullUserFile(user.userId, dmPath, user.publicKey, localPath, false);
                        if (changed) this.onModuleUpdate('social', localPath);
                    }
                }
            } else {
                // FALLBACK: Legacy polling-based sync (Iterate dates)
                const startDate = new Date(user.lastSync);
                const endDate = new Date(today);
                
                let iter = new Date(startDate);
                iter.setUTCHours(0, 0, 0, 0);
                endDate.setUTCHours(0, 0, 0, 0);

                while (iter <= endDate) {
                    const dateStr = SovereignS3nc.getDateStr(iter);
                    await this.pullUserDay(user.userId, dateStr, user.publicKey);
                    
                    // Pull namespaced Social DMs
                    const myId = this.config.paths.userId;
                    const dmPath = this.getModulePath('social', `dms/${myId}/${dateStr}.db`, 'public'); 
                    await this.pullUserFile(user.userId, dmPath, user.publicKey, this.getModulePath('social', `${user.userId}/dms/${dateStr}.db`, 'followed'), false);
                    
                    // Pull Module Data
                    for (const moduleDef of this.registeredModules) {
                        const moduleName = moduleDef.name;
                        const remotePath = this.getModulePath(moduleName, `${dateStr}.db`, 'public');
                        const localPath = this.getModulePath(moduleName, `${user.userId}/${dateStr}.db`, 'followed');
                        await this.pullUserFile(user.userId, remotePath, user.publicKey, localPath, false);
                    }

                    iter.setUTCDate(iter.getUTCDate() + 1);
                }
            }
            
            await this.storage.updateFollowedUserSync(user.userId, today);
        }
    }

    private createRemote(userId: string): IRemoteAdapter {
        if (this.remoteFactory) {
            Logger.info(`[Sync] Creating remote for ${userId} using factory.`);
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

    private async pullUserFile(userId: string, remotePath: string, publicKey: string, localPath: string, expectEncrypted: boolean = true): Promise<boolean> {
        try {
            const userRemote = this.createRemote(userId);
            const cachedEtag = await this.storage.getGenericRemoteHashCache(`${userId}:${remotePath}`);
            
            Logger.info(`[Sync] Downloading ${userId}/${remotePath}...`);
            const result = await userRemote.downloadFile(remotePath, cachedEtag || undefined);
            
            if (result && !result.notModified && result.data) {
                let data = result.data;
                try {
                    if (expectEncrypted) {
                        data = await this.decrypt(data, publicKey);
                    }
                    await this.storage.saveFile(localPath, data);
                    if (result.etag) await this.storage.setGenericRemoteHashCache(`${userId}:${remotePath}`, result.etag);
                    return true;
                } catch (e: any) {
                    Logger.warn(`[Sync] Failed to process ${remotePath} from ${userId}: ${e.message}`);
                }
            }
        } catch (e: any) {
            Logger.warn(`[Sync] pullUserFile failed for ${userId}/${remotePath}: ${e.message}`);
        }
        return false;
    }

    private async pullUserDay(userId: string, date: string, publicKey: string) {
        try {
            // Create a temporary remote for this specific user's public store
            const userRemote = this.createRemote(userId);
            const filePath = `public/${date}.db`;
            const cachedEtag = await this.storage.getRemoteHashCache(`${userId}:${date}`, 'followed' as any);

            Logger.info(`[Sync] Downloading ${userId}/${date}...`);
            const result = await userRemote.downloadFile(filePath, cachedEtag || undefined);

            if (result && !result.notModified && result.data) {
                let data = result.data;
                try {
                    data = await this.decrypt(data, publicKey);
                    await this.storage.saveDailyDb(`${userId}/${date}`, 'followed' as any, data);
                    if (result.etag) await this.storage.setRemoteHashCache(`${userId}:${date}`, 'followed' as any, result.etag);
                    Logger.info(`[Sync] Pulled followed content for ${userId}: ${filePath}`);
                } catch (e: any) {
                    Logger.warn(`[Sync] Failed to decrypt followed content from ${userId} (${date}). Error: ${e.message}`);
                }
            } else if (result?.notModified) {
                Logger.info(`[Sync] Skipping download for ${userId}/${date}, etags match.`);
            }
        } catch (e: any) {
            Logger.warn(`[Sync] pullUserDay failed for ${userId}/${date}: ${e.message}`);
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
            // ONLY encrypt/decrypt private data. Public data is open for sharing.
            const currentKey = type === 'private' ? this.config.encryptionKey : undefined;
            const cachedEtag = await this.storage.getRemoteHashCache(date, type);

            if (!localData) {
                Logger.info(`[Sync] Downloading ${remotePath}`);
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

                Logger.info(`[Sync] Uploading ${remotePath} (Reason: Content or Key change)`);
                let uploadData = localData;
                if (currentKey) {
                    uploadData = await this.encrypt(localData, currentKey);
                }
                const etag = await activeRemote.uploadFile(remotePath, uploadData, localHash);
                if (etag) await this.storage.setRemoteHashCache(date, type, etag);
            }
        } catch (e: any) {
            Logger.warn(`[Sync] syncDay failed for ${date}/${type}: ${e.message}`);
        }
    }

    private calculateHashedContent(data: Uint8Array, key?: string): string {
        const hasher = crypto.createHash('sha256').update(data);
        if (key) hasher.update(key); // Salt hash with key
        return hasher.digest('hex');
    }

    public async encrypt(data: Uint8Array, key: string): Promise<Uint8Array> {
        const iv = crypto.randomBytes(12);
        const keyBuffer = Buffer.from(key, 'hex').slice(0, 32);
        const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
        const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, encrypted]);
    }

    public async decrypt(data: Uint8Array, key: string): Promise<Uint8Array> {
        try {
            const iv = data.slice(0, 12);
            const tag = data.slice(12, 28);
            const encrypted = data.slice(28);
            const keyBuffer = Buffer.from(key, 'hex').slice(0, 32);
            const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(encrypted), decipher.final()]);
        } catch (e: any) {
            throw new Error(`Decryption failed (key: ${key.substring(0,6)}...): ${e.message}`);
        }
    }

    /**
     * Derives a shared secret for E2EE DMs between two users.
     */
    public deriveSharedSecret(otherPublicKey: string): string {
        if (!this.config.encryptionKey) throw new Error('Identity key not initialized');
        
        const mySecretKey = Buffer.from(this.config.encryptionKey, 'hex');
        const theirPublicKey = Buffer.from(otherPublicKey, 'hex');
        
        const shared = nacl.box.before(theirPublicKey, mySecretKey);
        return Buffer.from(shared).toString('hex');
    }
    
    private async syncUserFile() {
        try {
            const remotePath = 'public/user.json';
            let localData = await this.storage.getPublicUserFile();
            const key = this.config.publicEncryptionKey;
            const cachedEtag = await this.storage.getGenericRemoteHashCache(remotePath);

            const result = await this.publicRemote.downloadFile(remotePath, cachedEtag || undefined);
            
            if (result && !result.notModified && result.data) {
                // Downloaded a newer or changed remote file
                let remoteDecrypted = result.data;
                
                try {
                    JSON.parse(new TextDecoder().decode(result.data));
                    // It's plain JSON, no decryption needed
                } catch (e) {
                    try {
                        if (key) remoteDecrypted = await this.decrypt(result.data, key);
                    } catch (de) {
                        Logger.warn('[Sync] Failed to decrypt remote user.json. Overwriting with local if possible.');
                    }
                }

                // If we have local data, we should compare timestamps to avoid overwriting a local change
                let shouldKeepLocal = false;
                if (localData) {
                    try {
                        const localObj = JSON.parse(new TextDecoder().decode(localData));
                        const remoteObj = JSON.parse(new TextDecoder().decode(remoteDecrypted));
                        if (localObj.updatedAt && remoteObj.updatedAt && localObj.updatedAt > remoteObj.updatedAt) {
                            shouldKeepLocal = true;
                        }
                    } catch (e) {}
                }

                if (!shouldKeepLocal) {
                    localData = remoteDecrypted;
                    await this.storage.savePublicUserFile(localData);
                    if (result.etag) await this.storage.setGenericRemoteHashCache(remotePath, result.etag);
                }
            }

            // After potentially updating localData, ensure remote matches local if we kept local
            if (localData) {
                const remoteHash = await this.publicRemote.getFileHash(remotePath);
                const localHash = this.calculateHashedContent(localData, key);
                
                if (localHash !== remoteHash) {
                    Logger.info(`[Sync] Uploading ${remotePath}`);
                    let uploadData = localData;
                    if (key) uploadData = await this.encrypt(localData, key);
                    const etag = await this.publicRemote.uploadFile(remotePath, uploadData, localHash);
                    if (etag) await this.storage.setGenericRemoteHashCache(remotePath, etag);
                } else if (!cachedEtag && remoteHash) {
                    const remoteEtag = await this.publicRemote.getFileEtag(remotePath);
                    if (remoteEtag) await this.storage.setGenericRemoteHashCache(remotePath, remoteEtag);
                }
            }
        } catch (e: any) {
            Logger.warn(`[Sync] syncUserFile failed: ${e.message}`);
        }
    }
}
