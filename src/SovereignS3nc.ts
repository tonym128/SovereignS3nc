import * as nacl from 'tweetnacl';
import { SovereignConfig, SovereignManifest, ModuleDefinition, ModuleMigration, SovereignGroup, GroupMember } from './types';
import { IStorage } from './interfaces/IStorage';
import { IRemoteAdapter } from './interfaces/IRemoteAdapter';
import { S3RemoteAdapter } from './adapters/S3RemoteAdapter';
import { IndexedDBStorage } from './adapters/IndexedDBStorage';
import { Logger, LogLevel } from './utils/Logger';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { SyncWorkerProxy } from './worker/SyncWorkerProxy';

export class SovereignS3nc extends EventEmitter {
    public static readonly VERSION = '3.0.0';
    private storage: IStorage;
    private remote?: IRemoteAdapter; // Private Remote (Optional for local-only)
    private publicRemote?: IRemoteAdapter;
    private globalRemote?: IRemoteAdapter;
    public adminRemote?: IRemoteAdapter; // Access to appId/admin/
    public rootRemote?: IRemoteAdapter; // Access to appId/ (Requires root/admin credentials)
    private config: SovereignConfig;
    private remoteFactory?: (userId: string) => IRemoteAdapter;
    private registeredModules: ModuleDefinition[] = [];
    private isSyncing: boolean = false;
    private syncWorker?: SyncWorkerProxy;

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
        
        // Initialize Remotes if available
        if (remote) {
            this.remote = remote;
            this.publicRemote = remote;
            this.globalRemote = remoteFactory ? remoteFactory('global') : remote; 
            this.adminRemote = remoteFactory ? remoteFactory('admin') : remote;
            this.rootRemote = remoteFactory ? remoteFactory('root') : remote;

            // Link storage for purge support if applicable
            if ((this.remote as any).storage === undefined) {
                (this.remote as any).storage = this.storage;
            }
        } else if (config.s3) {
            this.initializeS3Remotes(config.s3);
        } else if (remoteFactory) {
            // New fallback: Initialize public/global/admin remotes using factory even if private ID is not yet known
            this.publicRemote = remoteFactory(this.getHashedUserId(this.config.paths.userId, false));
            this.globalRemote = remoteFactory('global');
            this.adminRemote = remoteFactory('admin');
            this.rootRemote = remoteFactory('root');
        } else if (!config.offline) {
            Logger.warn('[Sovereign] No S3 configuration provided and offline flag not set. Operating in local-only mode until connectRemote() is called.');
        }
    }

    private initializeS3Remotes(s3: any, privateUserId?: string) {
        // Public Remote uses a non-salted hash of the userId (publicly discoverable if userId is known)
        this.publicRemote = new S3RemoteAdapter(s3, {
            appId: this.config.paths.appId,
            userId: this.getHashedUserId(this.config.paths.userId, false),
            storeId: this.config.paths.storeId
        });

        // Global Remote - Simplified path
        this.globalRemote = new S3RemoteAdapter(s3, {
            appId: this.config.paths.appId,
            userId: 'global',
            storeId: 'users'
        });

        // Admin Remote - Access to appId/admin/
        this.adminRemote = new S3RemoteAdapter(s3, {
            appId: this.config.paths.appId,
            userId: 'admin',
            storeId: ''
        });

        // Root Remote - Access to appId/ (Strictly appId only)
        this.rootRemote = new S3RemoteAdapter(s3, {
            appId: this.config.paths.appId,
            userId: '',
            storeId: ''
        });

        // Private Remote uses a salted hash (unfindable without password/serverSecret)
        this.remote = new S3RemoteAdapter(s3, {
            appId: this.config.paths.appId,
            userId: privateUserId || this.getHashedUserId(this.config.paths.userId, true),
            storeId: this.config.paths.storeId
        });
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

    /**
     * Unified orchestration for group databases.
     * Fetches, decrypts, and applies the given module schema to a group's daily database.
     */
    public async getGroupStore(groupId: string, schema: string, date: string, sharedKey?: string): Promise<any> {
        const dbPath = `public/groups/${groupId}/${date}.db`;
        let data = await this.getStorage().getFile(dbPath);

        // Handle Group Decryption
        if (data && sharedKey) {
            try {
                data = await this.decrypt(data, sharedKey);
            } catch (e: any) {
                Logger.warn(`[SovereignS3nc] Failed to decrypt group DB: ${e.message}`);
                data = null; 
            }
        }

        // @ts-ignore
        const initSqlJs = (globalThis as any).initSqlJs;
        const sqliteInstance = await initSqlJs((globalThis as any).SQL_CONFIG || {});
        const db = new sqliteInstance.Database(data || undefined);

        // Use Core Schema Management
        this.applyModuleSchema(db, schema);

        return db;
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

        // Initialize Background Worker if enabled
        if (this.config.useWorker && this.config.workerUrl) {
            Logger.info(`[Sovereign] Initializing background sync worker: ${this.config.workerUrl}`);
            this.syncWorker = new SyncWorkerProxy(this.config.workerUrl);
            this.syncWorker.on('update', (data) => {
                this.emit('update', data);
                if (data.moduleName) {
                    this.emit(`${data.moduleName}:update`, data);
                }
            });
            await this.syncWorker.init(this.config);
        }

        if (this.config.password && (!this.config.encryptionKey || !this.config.publicEncryptionKey)) {
            Logger.info('[Sovereign] Initializing keys...');
            await this.initKeys();
        }
        
        // Ensure we are in the global registry even before the first sync
        if (this.config.publicEncryptionKey) {
            await this.ensureGlobalRegistration();
        }

        // Fetch blacklist and admin key immediately on startup
        await this.syncBlacklist();
        await this.syncAdminKey();

        Logger.info('[Sovereign] Initialization complete.');
    }

    /**
     * Downloads the global blacklist and updates local config.
     */
    public async syncBlacklist() {
        if (!this.globalRemote) return;
        const path = 'blacklist.json';
        try {
            const result = await this.globalRemote.downloadFile(path);
            if (result && result.data) {
                const list = JSON.parse(new TextDecoder().decode(result.data));
                this.config.blacklist = list;
                Logger.info(`[Sync] Updated blacklist: ${list.length} users.`);
            }
        } catch (e) {
            // No blacklist found, which is fine
        }
    }

    /**
     * Downloads the admin's public key for E2EE reports.
     */
    public async syncAdminKey() {
        if (!this.adminRemote) return;
        try {
            const result = await this.adminRemote.downloadFile('public_key.json');
            if (result && result.data) {
                const data = JSON.parse(new TextDecoder().decode(result.data));
                this.config.adminPublicKey = data.publicKey;
                Logger.info('[Sync] Discovered Admin Public Key.');
            }
        } catch (e) {
            // No admin key found, which is fine
        }
    }

    /**
     * Connects a remote storage backend to an instance that was started in local-only mode.
     * This will initialize remotes, upload local keys if missing from remote, and trigger a sync.
     */
    public async connectRemote(remote: any) {
        Logger.info('[Sovereign] Connecting to remote...');
        
        if (remote.region && remote.bucketName) {
            // It's an S3Config
            this.config.s3 = remote;
            
            // If keys were already derived, we need the Private ID for the remote path
            let privateId: string | undefined;
            if (this.config.password) {
                privateId = crypto.pbkdf2Sync(this.config.password, this.config.paths.userId + '-private-id', 1000, 32, 'sha256').toString('hex');
            }
            
            this.initializeS3Remotes(remote, privateId);
        } else {
            // It's an IRemoteAdapter (e.g. WebRTC)
            this.remote = remote;
            this.publicRemote = remote;
            this.globalRemote = remote;
        }

        // 1. Ensure keys are synced to the new remote
        if (this.config.password && this.config.encryptionKey) {
            await this.ensureKeysAreRemote();
        }

        // 2. Register in global registry
        if (this.config.publicEncryptionKey) {
            await this.ensureGlobalRegistration();
        }

        // 3. Trigger initial sync
        await this.sync();
        Logger.info('[Sovereign] Remote connection and initial sync complete.');
    }

    private async ensureKeysAreRemote() {
        if (!this.remote || !this.config.password || !this.config.encryptionKey) return;

        const publicUserId = this.config.paths.userId;
        const masterKey = crypto.pbkdf2Sync(this.config.password, publicUserId + '-master', 1000, 32, 'sha256').toString('hex');
        
        try {
            const check = await this.remote.downloadFile('_keys.json');
            if (!check || !check.data) {
                Logger.info('[Keys] Keys missing from remote. Uploading local keys...');
                const keyInfo = { 
                    privateKey: this.config.encryptionKey, 
                    publicKey: this.config.publicEncryptionKey 
                };
                const encrypted = await this.encrypt(Buffer.from(JSON.stringify(keyInfo)), masterKey);
                await this.remote.uploadFile('_keys.json', encrypted);
                Logger.info('[Keys] Local keys uploaded to remote.');
            }
        } catch (e: any) {
            Logger.warn(`[Keys] Failed to ensure keys are remote: ${e.message}`);
        }
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

        // 2. Initialize the Private Remote with the secret GUID (if config exists)
        if (!this.remote && (this.config.s3 || this.remoteFactory)) {
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
                // We don't throw here to allow local-only initialization even if remote setup fails
            }
        }

        // 3. Password Verification (Local or Remote Sentinel)
        const sentinelPath = 'private/sentinel.enc';
        let sentinelData = await this.storage.getFile(sentinelPath);
        let verified = false;

        if (sentinelData) {
            try {
                const decrypted = await this.decrypt(sentinelData, masterKey);
                if (new TextDecoder().decode(decrypted) !== 'SovereignSentinel') {
                    throw new Error('Sentinel content mismatch');
                }
                Logger.info('[Keys] Password verified against local sentinel.');
                verified = true;
            } catch (e: any) {
                Logger.error('[Keys] Password verification failed. Incorrect password?');
                throw new Error('Incorrect password. Access denied.');
            }
        }

        // If not verified locally, try remote sentinel (New Device case)
        if (!verified && this.remote) {
            Logger.info('[Keys] Local sentinel missing. Checking remote sentinel for cross-device verification...');
            try {
                const result = await this.remote.downloadFile('sentinel.enc');
                if (result && result.data) {
                    const decrypted = await this.decrypt(result.data, masterKey);
                    if (new TextDecoder().decode(decrypted) !== 'SovereignSentinel') {
                        throw new Error('Remote sentinel content mismatch');
                    }
                    Logger.info('[Keys] Password verified against remote sentinel.');
                    // Save locally for future offline verification
                    await this.storage.saveFile(sentinelPath, result.data);
                    sentinelData = result.data;
                    verified = true;
                } else {
                    Logger.info('[Keys] No remote sentinel found. Proceeding (may be a new account).');
                }
            } catch (e: any) {
                if (e.message === 'Network Error' || e.message.includes('offline')) {
                    Logger.warn('[Keys] Remote unreachable for sentinel check, continuing.');
                } else {
                    Logger.error('[Keys] Remote sentinel verification failed. Incorrect password?');
                    throw new Error('Incorrect password. Access denied.');
                }
            }
        }

        // 4. Try to load keys from local private storage
        Logger.info('[Keys] Step 4: Checking local storage for keys...');
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

        // 5. If not found locally, try remote (at the Private GUID path)
        if (!keyInfo && this.remote) {
            Logger.info('[Keys] Step 5: Trying to download keys from remote...');
            try {
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
            } catch (e: any) {
                if (e.message === 'Network Error' || e.message.includes('offline')) {
                    Logger.warn('[Keys] Remote unreachable, continuing in offline mode.');
                } else {
                    throw e;
                }
            }
        }

        // 6. Generate new keys if still not found
        if (!keyInfo) {
            Logger.info('[Keys] Step 6: Generating new persistent E2EE key pair.');
            const pair = nacl.box.keyPair();
            keyInfo = { 
                privateKey: Buffer.from(pair.secretKey).toString('hex'), 
                publicKey: Buffer.from(pair.publicKey).toString('hex') 
            };

            Logger.info('[Keys] Encrypting new keys for storage...');
            const encrypted = await this.encrypt(Buffer.from(JSON.stringify(keyInfo)), masterKey);
            await this.storage.saveDailyDb('_keys', 'private', encrypted);
            
            if (this.remote) {
                try {
                    Logger.info('[Keys] Uploading new keys to remote...');
                    await this.remote.uploadFile('_keys.json', encrypted);
                    Logger.info('[Keys] New keys uploaded.');
                } catch (e: any) {
                    Logger.warn(`[Keys] Failed to upload new keys to remote: ${e.message}. Continuing in offline mode.`);
                }
            } else {
                Logger.info('[Keys] New keys generated and saved locally (no remote connected).');
            }
        }

        this.config.encryptionKey = keyInfo.privateKey;
        this.config.publicEncryptionKey = keyInfo.publicKey;

        // 7. Ensure sentinel exists locally and remotely
        if (!sentinelData) {
            const sentinelContent = new TextEncoder().encode('SovereignSentinel');
            const encryptedSentinel = await this.encrypt(sentinelContent, masterKey);
            await this.storage.saveFile(sentinelPath, encryptedSentinel);
            sentinelData = encryptedSentinel;
            Logger.info('[Keys] Local sentinel created for future offline verification.');
        }

        if (this.remote) {
            try {
                const remoteCheck = await this.remote.getFileHash('sentinel.enc');
                if (!remoteCheck) {
                    Logger.info('[Keys] Uploading sentinel to remote...');
                    await this.remote.uploadFile('sentinel.enc', sentinelData);
                    Logger.info('[Keys] Remote sentinel uploaded.');
                }
            } catch (e: any) {
                Logger.warn(`[Keys] Failed to ensure remote sentinel: ${e.message}`);
            }
        }
    }

    public async changePassword(oldPassword: string, newPassword: string): Promise<void> {
        if (!this.config.password || this.config.password !== oldPassword) {
            throw new Error('Incorrect old password.');
        }

        Logger.info('[ChangePassword] Starting password change procedure...');
        const publicUserId = this.config.paths.userId;

        // 1. Derive NEW secrets
        const newMasterKey = crypto.pbkdf2Sync(newPassword, publicUserId + '-master', 1000, 32, 'sha256').toString('hex');
        const newPrivateId = crypto.pbkdf2Sync(newPassword, publicUserId + '-private-id', 1000, 32, 'sha256').toString('hex');

        // 2. Re-encrypt local sentinel
        const sentinelPath = 'private/sentinel.enc';
        const sentinelContent = new TextEncoder().encode('SovereignSentinel');
        const encryptedSentinel = await this.encrypt(sentinelContent, newMasterKey);
        await this.storage.saveFile(sentinelPath, encryptedSentinel);

        // 3. Re-encrypt keys
        if (!this.config.encryptionKey || !this.config.publicEncryptionKey) {
            throw new Error('Identity keys are not loaded in memory.');
        }
        const keyInfo = { 
            privateKey: this.config.encryptionKey, 
            publicKey: this.config.publicEncryptionKey 
        };
        const encryptedKeys = await this.encrypt(Buffer.from(JSON.stringify(keyInfo)), newMasterKey);
        await this.storage.saveDailyDb('_keys', 'private', encryptedKeys);

        // 4. Migrate Remote Data
        if (this.remote) {
            Logger.info('[ChangePassword] Migrating remote data to new private prefix...');
            
            let newRemote: IRemoteAdapter | undefined;
            if (this.remoteFactory) {
                newRemote = this.remoteFactory(newPrivateId);
            } else if (this.config.s3) {
                // S3RemoteAdapter requires s3 config
                // Wait, S3RemoteAdapter is imported from adapters
                // Actually, initializeS3Remotes has a factory-like way or we can just instantiate it
                const S3RemoteAdapterClass = this.remote.constructor as any;
                try {
                    newRemote = new S3RemoteAdapterClass(this.config.s3, {
                        appId: this.config.paths.appId,
                        userId: newPrivateId,
                        storeId: this.config.paths.storeId
                    });
                } catch (e: any) {
                    Logger.warn(`[ChangePassword] Failed to dynamically create new S3RemoteAdapter: ${e.message}`);
                }
            }

            if (newRemote) {
                // Upload new keys
                await newRemote.uploadFile('_keys.json', encryptedKeys);

                if (this.remote.listFiles) {
                    const files = await this.remote.listFiles('');
                    for (const file of files) {
                        if (file === '_keys.json') continue; // Handled
                        
                        const result = await this.remote.downloadFile(file);
                        if (result && result.data) {
                            await newRemote.uploadFile(file, result.data);
                        }
                    }
                    
                    // Cleanup old remote
                    if (this.remote.purge) {
                        await this.remote.purge();
                    } else if ((this.remote as any).deleteFile) {
                        for (const file of files) {
                            await (this.remote as any).deleteFile(file);
                        }
                    }
                } else {
                    Logger.warn('[ChangePassword] Remote adapter lacks listFiles capability. Data not migrated automatically.');
                }
                
                this.remote = newRemote;
            } else {
                throw new Error('Failed to create new remote adapter for migration.');
            }
        }

        // 5. Update config
        this.config.password = newPassword;
        Logger.info('[ChangePassword] Password changed successfully.');
    }

    async sync(forceSync: boolean = false) {
        if (this.syncWorker) {
            Logger.info('[Sovereign] Delegating sync to background worker...');
            return this.syncWorker.sync(forceSync);
        }

        if (!this.remote || !this.publicRemote || !this.globalRemote) {
            Logger.info('[Sovereign] Remote not connected, skipping sync.');
            return;
        }

        if (this.isSyncing) {
            Logger.info('[Sovereign] Sync already in progress, skipping...');
            return;
        }
        this.isSyncing = true;
        try {
            if (forceSync) {
                Logger.info('[Sync] FORCE SYNC initiated. Bypassing ETag cache.');
            }

            // 1. Sync My Data (Private & Public)
            const lastSync = forceSync ? null : await this.storage.getLastSyncDate();
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
                // Core data
                await this.syncDay(dateStr, 'private', undefined, this.remote);
                await this.syncDay(dateStr, 'public', undefined, this.publicRemote);
            }

            // 2. Sync User Profile and Global Registry
            await this.syncUserFile();
            await this.ensureGlobalRegistration();
            await this.updateFollowingPublicKeys();
            
            if (this.config.autoFollowDiscoveredUsers !== false) {
                const userList = await this.discoverUsers();
                if (userList) {
                    await this.autoFollowUsers(userList);
                }
            }

            // 3. Sync Followed Users (Per-User Logic)
            await this.syncFollowedUsers(today);

            // 4. Sync Groups (Multi-writer Logic)
            await this.syncGroups(today);

            // 5. Sync Blobs and generic files from the local manifest
            const manifest = await this.generateManifest();
            for (const blobPath of manifest.blobs) {
                const type = blobPath.startsWith('public/') ? 'public' : 'private';
                const relativePath = blobPath.substring(type.length + 1);
                await this.syncGenericFile(relativePath, type);
            }

            await this.syncManifest();
            await this.storage.setLastSyncDate(today);
        } finally {
            this.isSyncing = false;
        }
    }

    public async syncManifest() {
        if (!this.publicRemote) return;
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
        const allFiles = await this.storage.listFiles('');
        Logger.debug(`[Sync] generateManifest: Scanning ${allFiles.length} files`);
        const manifest: SovereignManifest = {
            updatedAt: Date.now(),
            userId: this.config.paths.userId,
            modules: {},
            dms: {},
            groups: {},
            blobs: []
        };

        const profileData = await this.storage.getPublicUserFile();
        if (profileData) {
            manifest.profileHash = this.calculateHashedContent(profileData);
        }

        for (const file of allFiles) {
            if (file.includes('user.json')) continue;
            if (file.includes('manifest.json')) continue;
            if (file.includes('_keys.json')) continue;
            if (file.includes('sentinel.enc')) continue;
            if (file.includes('.probe')) continue;
            const parts = file.split('/');
            const fileName = parts[parts.length - 1];
            
            // 1. Track in structured manifest sections for PULL discovery
            
            // Base DB: {type}/{date}.db
            if (parts.length === 2 && fileName.endsWith('.db')) {
                const dateStr = fileName.replace('.db', '');
                if (!manifest.modules['core']) manifest.modules['core'] = [];
                if (!manifest.modules['core'].includes(dateStr)) manifest.modules['core'].push(dateStr);
            }

            // Module data: {type}/modules/{moduleName}/{date}.db
            else if (file.includes('/modules/') && fileName.endsWith('.db')) {
                const moduleName = parts[2];
                if (parts.length === 4) {
                    const dateStr = fileName.replace('.db', '');
                    if (!manifest.modules[moduleName]) manifest.modules[moduleName] = [];
                    if (!manifest.modules[moduleName].includes(dateStr)) manifest.modules[moduleName].push(dateStr);
                } 
                // DM file: {type}/modules/{moduleName}/dms/{recipientId}/{date}.db
                else if (parts.length === 6 && parts[3] === 'dms') {
                    const recipientId = parts[4];
                    const dateStr = fileName.replace('.db', '');
                    if (!manifest.dms[recipientId]) manifest.dms[recipientId] = [];
                    if (!manifest.dms[recipientId].includes(dateStr)) manifest.dms[recipientId].push(dateStr);
                }
            }

            // Group data: {type}/groups/{groupId}/{date}.db
            else if (file.includes('/groups/') && fileName.endsWith('.db')) {
                const groupId = parts[2];
                const dateStr = fileName.replace('.db', '');
                if (!manifest.groups[groupId]) manifest.groups[groupId] = [];
                if (!manifest.groups[groupId].includes(dateStr)) manifest.groups[groupId].push(dateStr);
            }

            // 2. ALWAYS add to blobs list for PUSH synchronization
            manifest.blobs.push(file);
        }
        return manifest;
    }

    /**
     * Creates a new multi-writer group.
     */
    public async createGroup(name: string, members: GroupMember[]): Promise<SovereignGroup> {
        const id = Math.random().toString(36).substring(2, 15);
        const sharedKey = crypto.randomBytes(32).toString('hex');
        
        // Owner is joined by default
        members.forEach(m => {
            if (m.userId === this.config.paths.userId) m.status = 'joined';
            else m.status = 'pending';
        });

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
        
        // Also publish my own status
        await this.respondToGroup(id, 'joined');

        Logger.info(`[Group] Created group ${name} (${id})`);
        return group;
    }

    /**
     * Updates an existing group's metadata (members, name, etc.)
     */
    public async updateGroup(group: SovereignGroup) {
        const groupData = new TextEncoder().encode(JSON.stringify(group));
        await this.storage.saveFile(`private/groups/${group.id}/info.json`, groupData);
        
        // Notify all members of the change
        for (const member of group.members) {
            if (member.userId !== this.config.paths.userId) {
                // We send an update message. Modules can detect this and refresh.
                // In Social Demo, we'll reuse the INVITE_GROUP prefix which also updates metadata.
                this.emit('group:update_metadata', { groupId: group.id, group });
            }
        }
        
        Logger.info(`[Group] Updated group ${group.name} (${group.id})`);
    }

    public async joinGroup(group: SovereignGroup) {
        // Set all members to pending initially if status is missing
        group.members.forEach(m => {
            if (!m.status) m.status = 'pending';
        });

        // CRITICAL: We must save the info.json so we can find it in getGroups()
        const groupData = new TextEncoder().encode(JSON.stringify(group));
        await this.storage.saveFile(`private/groups/${group.id}/info.json`, groupData);
        
        Logger.info(`[Group] Received and saved metadata for group ${group.name} (${group.id})`);
    }

    public async respondToGroup(groupId: string, status: 'joined' | 'declined') {
        const statusData = new TextEncoder().encode(JSON.stringify({ status, updatedAt: Date.now() }));
        const path = `public/groups/${groupId}/status.json`;
        await this.storage.saveFile(path, statusData);
        
        // Also update local group info if exists
        const infoPath = `private/groups/${groupId}/info.json`;
        const localInfo = await this.storage.getFile(infoPath);
        if (localInfo) {
            const group: SovereignGroup = JSON.parse(new TextDecoder().decode(localInfo));
            const me = group.members.find(m => m.userId === this.config.paths.userId);
            if (me) {
                me.status = status;
                await this.storage.saveFile(infoPath, new TextEncoder().encode(JSON.stringify(group)));
            }
        }

        Logger.info(`[Group] Responded to group ${groupId} with ${status}`);
    }

    public async leaveGroup(groupId: string) {
        // 1. Publish 'left' status
        const statusData = new TextEncoder().encode(JSON.stringify({ status: 'left', updatedAt: Date.now() }));
        const path = `public/groups/${groupId}/status.json`;
        await this.storage.saveFile(path, statusData);

        // 2. Delete local group info
        const infoPath = `private/groups/${groupId}/info.json`;
        await this.storage.deleteFile(infoPath);

        Logger.info(`[Group] Left group ${groupId}`);
    }

    public async getGroupMembersWithStatus(groupId: string): Promise<GroupMember[]> {
        const infoPath = `private/groups/${groupId}/info.json`;
        const localInfo = await this.storage.getFile(infoPath);
        if (!localInfo) return [];

        const group: SovereignGroup = JSON.parse(new TextDecoder().decode(localInfo));
        const myUserId = this.config.paths.userId;
        
        // Update statuses from local cache (pulled during syncGroups)
        for (const member of group.members) {
            let statusPath: string;
            if (member.userId === myUserId) {
                // Check my own published status
                statusPath = `public/groups/${groupId}/status.json`;
            } else {
                // Check other members' cached statuses
                statusPath = `followed/${member.userId}/groups/${groupId}/status.json`;
            }

            const statusData = await this.storage.getFile(statusPath);
            if (statusData) {
                try {
                    const { status } = JSON.parse(new TextDecoder().decode(statusData));
                    member.status = status;
                } catch(e) {}
            }
        }

        return group.members;
    }

    public async getGroups(): Promise<SovereignGroup[]> {
        const files = await this.storage.listFiles('private/groups/');
        const groups: SovereignGroup[] = [];
        for (const file of files) {
            if (file.endsWith('info.json')) {
                const data = await this.storage.getFile(file);
                if (data) {
                    const group = JSON.parse(new TextDecoder().decode(data));
                    // Enrich with statuses
                    group.members = await this.getGroupMembersWithStatus(group.id);
                    groups.push(group);
                }
            }
        }
        return groups;
    }

    public async syncGroups(today: string) {
        const files = await this.storage.listFiles('private/groups/');
        const groups: SovereignGroup[] = [];
        for (const file of files) {
            if (file.endsWith('info.json')) {
                const data = await this.storage.getFile(file);
                if (data) groups.push(JSON.parse(new TextDecoder().decode(data)));
            }
        }

        for (const group of groups) {
            Logger.info(`[Sync] Syncing group ${group.name} (${group.id})`);
            
            // 1. Ensure my status is uploaded
            const myStatusPath = `public/groups/${group.id}/status.json`;
            const myStatusData = await this.storage.getFile(myStatusPath);
            if (myStatusData) {
                // syncGenericFiles handles public/groups/ prefix if added to sync()
            }

            // 2. Pull from other members
            for (const member of group.members) {
                if (member.userId === this.config.paths.userId) continue;

                // Pull Status FIRST
                const remoteStatusPath = `public/groups/${group.id}/status.json`;
                const localStatusPath = `followed/${member.userId}/groups/${group.id}/status.json`;
                await this.pullUserFile(member.userId, remoteStatusPath, '', localStatusPath, false); // Status is public/unencrypted

                // Refresh member status from newly pulled file
                const statusData = await this.storage.getFile(localStatusPath);
                if (statusData) {
                    try {
                        const { status } = JSON.parse(new TextDecoder().decode(statusData));
                        member.status = status;
                    } catch(e) {}
                }

                // Pull Data (Only if joined)
                if (member.status === 'joined') {
                    const manifest = await this.fetchManifest(member.userId);
                    if (manifest && manifest.groups[group.id]) {
                        for (const dateStr of manifest.groups[group.id]) {
                            const remotePath = `public/groups/${group.id}/${dateStr}.db`;
                            const localPath = `followed/${member.userId}/groups/${group.id}/${dateStr}.db`;
                            
                            Logger.debug(`[Sync] Group Pull: member=${member.userId}, remotePath=${remotePath}, localPath=${localPath}`);

                            // Download but DON'T decrypt here - FeedModule handles Group Decryption with sharedKey
                            const changed = await this.pullUserFile(member.userId, remotePath, group.sharedKey, localPath, false);
                            if (changed) {
                                this.emit(`group:${group.id}:update`, { userId: member.userId, dateStr });
                            }
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
                if (!activeRemote) return null;
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

    private async syncGenericFile(relativePath: string, type: 'private' | 'public') {
        try {
            const activeRemote = type === 'public' ? this.publicRemote : this.remote;
            if (!activeRemote) return;
            const key = type === 'private' ? this.config.encryptionKey : undefined;
            
            // Ensure fullPath reflects the storage path (public/...)
            const fullPath = relativePath.startsWith(`${type}/`) ? relativePath : `${type}/${relativePath}`;
            const s3Path = fullPath;

            const localData = await this.storage.getFile(fullPath);
            if (!localData) return;

            const localHash = this.calculateHashedContent(localData, key);
            const cachedEtag = await this.storage.getGenericRemoteHashCache(fullPath);
            const remoteHash = await activeRemote.getFileHash(s3Path);

            if (localHash !== remoteHash || remoteHash === null) {
                Logger.info(`[Sync] Uploading generic file: ${fullPath}`);
                let uploadData = localData;
                if (key) uploadData = await this.encrypt(localData, key);
                const etag = await activeRemote.uploadFile(s3Path, uploadData, localHash);
                if (etag) await this.storage.setGenericRemoteHashCache(fullPath, etag);
            } else if (!cachedEtag && remoteHash) {
                const remoteEtag = await activeRemote.getFileEtag(s3Path);
                if (remoteEtag) await this.storage.setGenericRemoteHashCache(fullPath, remoteEtag);
            }
        } catch (e: any) {
            Logger.warn(`[Sync] syncGenericFile failed for ${relativePath}: ${e.message}`);
        }
    }

    private async syncGenericFiles(prefix: string) {
        try {
            const isPublic = prefix.startsWith('public/');
            const activeRemote = isPublic ? this.publicRemote : this.remote;
            if (!activeRemote) return;
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
        if (!this.globalRemote) return;
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

    private async updateFollowingPublicKeys() {
        try {
            const registry = await this.getPublicRegistry();
            const following = await this.storage.getFollowing();
            
            for (const user of registry) {
                const existing = following.find(f => f.userId === user.userId);
                if (existing && existing.publicKey !== user.publicKey) {
                    Logger.info(`[Sync] Updating public key for followed user ${user.userId}`);
                    await this.storage.followUser(user.userId, existing.lastSync, user.publicKey);
                }
            }
        } catch (e: any) {
            Logger.warn(`[Sync] Failed to update following public keys: ${e.message}`);
        }
    }

    async follow(userId: string) {
        // We'll try to find their public key in the global registry first
        const remotePath = 'users.json';
        let publicKey = '';
        try {
            const result = await this.globalRemote?.downloadFile(remotePath);
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
        if (!this.globalRemote) return [];
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

    public async discoverUsers(): Promise<{ userId: string, publicKey: string }[] | null> {
        if (!this.globalRemote) return null;
        const remotePath = 'users.json';
        let remoteData: Uint8Array | null = null;
        try {
            const result = await this.globalRemote.downloadFile(remotePath, undefined, 30000);
            if (result && result.data) remoteData = result.data;
        } catch (e: any) {
            Logger.warn('[Sync] Failed to download global registry (offline?)', e.message);
            return null;
        }
        
        if (!remoteData) return null;

        try {
            const users: { userId: string, publicKey: string }[] = JSON.parse(new TextDecoder().decode(remoteData));
            const blacklist = this.config.blacklist || [];
            return users.filter(u => !blacklist.includes(u.userId));
        } catch (e) {
            Logger.warn('[Sync] Failed to parse global registry', e);
            return null;
        }
    }

    public async autoFollowUsers(userList: { userId: string, publicKey: string }[]) {
        try {
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
            Logger.warn('[Sync] autoFollowUsers failed', e);
        }
    }

    private async syncFollowedUsers(today: string) {
        const following = await this.storage.getFollowing();
        const blacklist = this.config.blacklist || [];

        for (const user of following) {
            if (blacklist.includes(user.userId)) {
                Logger.info(`[Sync] Skipping blacklisted user ${user.userId}`);
                continue;
            }
            const manifest = await this.fetchManifest(user.userId);
            Logger.debug(`[Sync] Followed user ${user.userId} manifest: ${!!manifest}`);
            
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
                    Logger.debug(`[Sync] Found ${manifest.dms[myId].length} DMs for ${myId} from ${user.userId}`);
                    for (const dateStr of manifest.dms[myId]) {
                        // Check ALL registered modules for DMs
                        for (const moduleDef of this.registeredModules) {
                            const moduleName = moduleDef.name;
                            const dmPath = this.getModulePath(moduleName, `dms/${myId}/${dateStr}.db`, 'public');
                            const localPath = this.getModulePath(moduleName, `${user.userId}/dms/${myId}/${dateStr}.db`, 'followed');
                            const changed = await this.pullUserFile(user.userId, dmPath, user.publicKey, localPath, false);
                            if (changed) this.onModuleUpdate(moduleName, localPath);
                        }
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
                    
                    // Pull Module Data
                    for (const moduleDef of this.registeredModules) {
                        const moduleName = moduleDef.name;
                        
                        // Check for regular module DB
                        const remotePath = this.getModulePath(moduleName, `${dateStr}.db`, 'public');
                        const localPath = this.getModulePath(moduleName, `${user.userId}/${dateStr}.db`, 'followed');
                        await this.pullUserFile(user.userId, remotePath, user.publicKey, localPath, false);

                        // Also check for DMs in this module
                        const myId = this.config.paths.userId;
                        const dmPath = this.getModulePath(moduleName, `dms/${myId}/${dateStr}.db`, 'public'); 
                        const dmLocalPath = this.getModulePath(moduleName, `${user.userId}/dms/${myId}/${dateStr}.db`, 'followed');
                        await this.pullUserFile(user.userId, dmPath, user.publicKey, dmLocalPath, false);
                    }

                    iter.setUTCDate(iter.getUTCDate() + 1);
                }
            }
            
            await this.storage.updateFollowedUserSync(user.userId, today);
        }
    }

    public createRemote(userId: string): IRemoteAdapter {
        if (this.remoteFactory) {
            Logger.info(`[Sync] Creating remote for ${userId} using factory.`);
            return this.remoteFactory(userId);
        }
        
        if (this.config.s3) {
            return new S3RemoteAdapter(this.config.s3, {
                appId: this.config.paths.appId,
                userId: this.getHashedUserId(userId, false),
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
            } else if (!result) {
                // File deleted on remote! Clear local copy.
                Logger.info(`[Sync] File ${remotePath} missing on remote for ${userId}. Deleting local copy.`);
                await this.storage.deleteFile(localPath);
                await this.storage.setGenericRemoteHashCache(`${userId}:${remotePath}`, '');
                return true; // Content changed (deleted)
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
            } else if (!result) {
                // File deleted on remote (Moderated)
                Logger.info(`[Sync] Followed file ${userId}/${date} missing on remote. Deleting local copy.`);
                await this.storage.deleteDailyDb(`${userId}/${date}`, 'followed' as any);
                await this.storage.setRemoteHashCache(`${userId}:${date}`, 'followed' as any, '');
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
            // Important: We need the hashed path for the remote check
            const hashedUserId = this.getHashedUserId(this.config.paths.userId, type === 'private');
            Logger.debug(`[Sync] syncDay: literalUserId=${this.config.paths.userId}, type=${type}, hashedUserId=${hashedUserId}`);
            const remotePath = `${type}/${date}.db`;
            const activeRemote = remoteOverride || this.remote;
            if (!activeRemote) return;
            
            let localData = await this.storage.getDailyDb(date, type);
            // ONLY encrypt/decrypt private data. Public data is open for sharing.
            const currentKey = type === 'private' ? this.config.encryptionKey : undefined;
            const cachedEtag = await this.storage.getRemoteHashCache(date, type);

            if (!localData) {
                Logger.info(`[Sync] Downloading ${remotePath} for ${this.config.paths.userId} (Hashed: ${hashedUserId})`);
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
        
        if (theirPublicKey.length !== 32) {
            throw new Error(`Invalid public key size: expected 32 bytes, got ${theirPublicKey.length}. Key: ${otherPublicKey.substring(0, 10)}...`);
        }

        const shared = nacl.box.before(theirPublicKey, mySecretKey);
        return Buffer.from(shared).toString('hex');
    }

    /**
     * Sends an encrypted payload to a recipient by placing it in their public DM inbox.
     * Also saves a copy in the sender's private outbox.
     * 
     * @param recipientId The user ID of the recipient.
     * @param payload The JSON payload to encrypt and send.
     * @param namespace A namespace for the DM (e.g. 'messaging', 'social').
     */
    public async sendEncryptedPayload(recipientId: string, payload: any, namespace: string) {
        // 1. Get recipient public key
        const following = await this.storage.getFollowing();
        const recipient = following.find(f => f.userId === recipientId);
        let recipientPublicKey = recipient?.publicKey;

        if (!recipientPublicKey) {
            // Try global registry
            const registry = await this.getPublicRegistry();
            const found = registry.find(u => u.userId === recipientId);
            if (found) {
                recipientPublicKey = found.publicKey;
            }
        }

        if (!recipientPublicKey) {
            throw new Error(`Recipient public key not found for ${recipientId}`);
        }

        // 2. Derive shared secret
        const sharedSecret = this.deriveSharedSecret(recipientPublicKey);

        // 3. Encrypt payload
        const jsonData = JSON.stringify(payload);
        const dataBuffer = new TextEncoder().encode(jsonData);
        const encryptedData = await this.encrypt(dataBuffer, sharedSecret);

        const timestamp = Date.now();
        
        // 4. Save to private outbox: private/outbox/{recipientId}/{namespace}/{timestamp}.json
        const outboxPath = `private/outbox/${recipientId}/${namespace}/${timestamp}.json`;
        await this.storage.saveFile(outboxPath, dataBuffer);

        // 5. Place in recipient's public inbox: public/dms/{recipientId}/{namespace}/{timestamp}.enc
        const dmPath = `public/dms/${recipientId}/${namespace}/${timestamp}.enc`;
        await this.storage.saveFile(dmPath, encryptedData);

        Logger.info(`[Sovereign] Encrypted payload sent to ${recipientId} in namespace ${namespace}`);
    }
    
    private async syncUserFile() {
        try {
            if (!this.publicRemote) return;
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

    private getHashedUserId(userId: string, isPrivate: boolean): string {
        if (!isPrivate || userId === 'global' || userId === 'admin' || userId === '' || userId === 'root') {
            return userId; // Public and special system paths remain literal for discovery/admin access
        }
        
        // Private paths are obscured using a salted hash
        const appId = this.config.paths.appId;
        const secret = this.config.auth?.serverSecret || this.config.password || '';
        
        if (!secret) {
            return userId; // Fallback to literal if no secret is available yet (e.g. before init)
        }

        const hasher = crypto.createHash('sha256');
        hasher.update(userId);
        hasher.update(appId);
        hasher.update(secret);
        
        return hasher.digest('hex');
    }
}
