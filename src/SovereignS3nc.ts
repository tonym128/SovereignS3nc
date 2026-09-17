import * as nacl from 'tweetnacl';
import { SovereignConfig, SovereignManifest, ModuleDefinition, ModuleMigration, SovereignGroup, GroupMember } from './types';
import { IStorage } from './interfaces/IStorage';
import { IRemoteAdapter } from './interfaces/IRemoteAdapter';
import { S3RemoteAdapter } from './adapters/S3RemoteAdapter';
import { WebRTCRemoteAdapter } from './adapters/WebRTCRemoteAdapter';
import { NativeWebRTCTransport } from './adapters/NativeWebRTCTransport';
import { IndexedDBStorage } from './adapters/IndexedDBStorage';
import { Logger, LogLevel } from './utils/Logger';
import { EventEmitter } from 'events';
import { SyncWorkerProxy } from './worker/SyncWorkerProxy';
import { env } from './utils/Environment';
import { PATHS } from './utils/Constants';
import { SovereignError, StorageError, ModuleError, AuthError, SyncError } from './utils/Errors';

// Core Managers
import { KeyManager } from './core/KeyManager';
import { SyncOrchestrator } from './core/SyncOrchestrator';
import { ManifestManager } from './core/ManifestManager';
import { GroupManager } from './core/GroupManager';
import { ModerationEngine } from './core/ModerationEngine';
import { GlobalRegistry } from './discovery/GlobalRegistry';
import { BlacklistManager } from './discovery/BlacklistManager';

export class SovereignS3nc extends EventEmitter {
    public static readonly VERSION = '3.1.1';
    private storage: IStorage;
    private remote?: IRemoteAdapter; 
    private publicRemote?: IRemoteAdapter;
    private globalRemote?: IRemoteAdapter;
    public adminRemote?: IRemoteAdapter; 
    public rootRemote?: IRemoteAdapter; 
    private config: SovereignConfig;
    private remoteFactory?: (userId: string) => IRemoteAdapter;
    private registeredModules: ModuleDefinition[] = [];
    private _isSyncing: boolean = false;
    private syncWorker?: SyncWorkerProxy;
    private pendingConflicts: Map<string, (choice: 'local' | 'remote' | 'abort' | { mergedData: Uint8Array }) => void> = new Map();

    // Manager instances
    private keyManager: KeyManager;
    private syncOrchestrator: SyncOrchestrator;
    private manifestManager: ManifestManager;
    private groupManager: GroupManager;
    private moderationEngine: ModerationEngine;
    private globalRegistry: GlobalRegistry;
    private blacklistManager: BlacklistManager;

    public static async create(
        config: SovereignConfig, 
        remote?: IRemoteAdapter, 
        remoteFactory?: (userId: string) => IRemoteAdapter,
        keys?: { privateKey: string, publicKey: string },
        storage?: IStorage
    ): Promise<SovereignS3nc> {
        const instance = new SovereignS3nc(config, remote, remoteFactory, keys, storage);
        await instance.init();
        return instance;
    }

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

        Logger.setLevel(config.debug ? LogLevel.DEBUG : LogLevel.WARN);
        Logger.setPrefix(`[Sovereign:${config.paths.userId}]`);
        
        if (keys) {
            this.config.encryptionKey = keys.privateKey;
            this.config.publicEncryptionKey = keys.publicKey;
        }

        this.storage = storage || (null as any);
        
        // Initialize Managers
        this.keyManager = new KeyManager({
            config: this.config,
            storage: this.storage,
            getRemote: () => this.remote,
            setRemote: (r) => this.remote = r,
            getPublicRemote: () => this.publicRemote,
            getAdminRemote: () => this.adminRemote,
            remoteFactory: this.remoteFactory,
            createRemote: (uid, isPrivate) => this.createRemote(uid, isPrivate)
        });

        if (remote) {
            this.remote = remote;
            this.publicRemote = remote;
            this.globalRemote = remoteFactory ? remoteFactory('global') : remote; 
            this.adminRemote = remoteFactory ? remoteFactory('admin') : remote;
            this.rootRemote = remoteFactory ? remoteFactory('root') : remote;

            if ((this.remote as any).storage === undefined) {
                (this.remote as any).storage = this.storage;
            }
        } else if (config.s3) {
            this.initializeS3Remotes(config.s3);
        } else if (remoteFactory) {
            this.publicRemote = remoteFactory(this.getHashedUserId(this.config.paths.userId, false));
            this.globalRemote = remoteFactory('global');
            this.adminRemote = remoteFactory('admin');
            this.rootRemote = remoteFactory('root');
        } else if (!config.offline) {
            this.config.offline = true;
        }

        this.manifestManager = new ManifestManager({
            userId: this.config.paths.userId,
            getEncryptionKey: () => this.config.encryptionKey,
            storage: this.storage,
            getPublicRemote: () => this.publicRemote,
            createRemote: (uid) => this.createRemote(uid),
            calculateHashedContent: (d, k) => this.calculateHashedContent(d, k)
        });

        this.groupManager = new GroupManager({
            userId: this.config.paths.userId,
            storage: this.storage,
            getPublicRemote: () => this.publicRemote,
            pullUserFile: (uid, rp, pk, lp, ee) => this.syncOrchestrator.pullUserFile(uid, rp, pk, lp, ee),
            fetchManifest: (uid) => this.manifestManager.fetchManifest(uid),
            encrypt: (d, k) => this.encrypt(d, k),
            decrypt: (d, k) => this.decrypt(d, k),
            onGroupUpdate: (gid, uid, ds) => this.emit(`group:${gid}:update`, { userId: uid, dateStr: ds }),
            onGroupMetadataUpdate: (gid, g) => this.emit('group:update_metadata', { groupId: gid, group: g })
        });

        this.moderationEngine = new ModerationEngine({
            getAdminPublicKey: () => this.config.adminPublicKey,
            storage: this.storage,
            getPublicRemote: () => this.publicRemote,
            deriveSharedSecret: (pk) => this.deriveSharedSecret(pk),
            decrypt: (d, k) => this.decrypt(d, k),
            syncGenericFile: (rp, t, rm) => this.syncOrchestrator.syncGenericFile(rp, t, rm),
            getModulePath: (mn, sp, t) => this.getModulePath(mn, sp, t)
        });

        this.globalRegistry = new GlobalRegistry({
            config: this.config,
            storage: this.storage,
            getGlobalRemote: () => this.globalRemote,
            sign: (data) => this.keyManager.sign(data),
            verify: (data, sig, pk) => this.keyManager.verify(data, sig, pk),
        });

        this.blacklistManager = new BlacklistManager({
            config: this.config,
            getGlobalRemote: () => this.globalRemote
        });

        this.syncOrchestrator = new SyncOrchestrator({
            config: this.config,
            storage: this.storage,
            getRemote: () => this.remote,
            getPublicRemote: () => this.publicRemote,
            getGlobalRemote: () => this.globalRemote,
            isSyncing: () => this._isSyncing,
            setSyncing: (v) => this._isSyncing = v,
            syncWorker: this.syncWorker,
            syncBlacklist: () => this.blacklistManager.syncBlacklist(),
            syncAdminKey: () => this.keyManager.syncAdminKey(),
            ensureGlobalRegistration: () => this.globalRegistry.ensureGlobalRegistration(),
            updateFollowingPublicKeys: () => this.globalRegistry.updateFollowingPublicKeys(),
            discoverUsers: () => this.globalRegistry.discoverUsers(),
            autoFollowUsers: (u) => this.globalRegistry.autoFollowUsers(u),
            processModerationRequests: () => this.moderationEngine.processModerationRequests(),
            syncManifest: () => this.manifestManager.syncManifest(),
            generateManifest: () => this.manifestManager.generateManifest(),
            fetchManifest: (uid) => this.manifestManager.fetchManifest(uid),
            syncGroups: (today) => this.groupManager.syncGroups(today),
            encrypt: (d, k) => this.encrypt(d, k),
            decrypt: (d, k) => this.decrypt(d, k),
            calculateHashedContent: (d, k) => this.calculateHashedContent(d, k),
            handleConflict: (p, ld, rd) => this.handleConflict(p, ld, rd),
            createRemote: (uid) => this.createRemote(uid),
            getModulePath: (mn, sp, t) => this.getModulePath(mn, sp, t),
            onModuleUpdate: (mn, p) => this.onModuleUpdate(mn, p),
            registeredModules: this.registeredModules,
            emitSyncProgress: (stage, done, total) => {
                this.emit('sync:progress', { stage, done, total });
                Logger.debug('Sync', `Progress: ${stage}${total !== undefined ? ` (${done ?? 0}/${total})` : ''}`);
            }
        });
    }

    private initializeS3Remotes(s3: any, privateUserId?: string) {
        this.publicRemote = new S3RemoteAdapter(s3, {
            appId: this.config.paths.appId,
            userId: this.getHashedUserId(this.config.paths.userId, false),
            storeId: this.config.paths.storeId
        });
        this.globalRemote = new S3RemoteAdapter(s3, {
            appId: this.config.paths.appId,
            userId: 'global',
            storeId: 'users'
        });
        this.adminRemote = new S3RemoteAdapter(s3, {
            appId: this.config.paths.appId,
            userId: 'admin',
            storeId: ''
        });
        this.rootRemote = new S3RemoteAdapter(s3, {
            appId: this.config.paths.appId,
            userId: '',
            storeId: ''
        });
        this.remote = new S3RemoteAdapter(s3, {
            appId: this.config.paths.appId,
            userId: privateUserId || this.getHashedUserId(this.config.paths.userId, true),
            storeId: this.config.paths.storeId
        });
    }

    public getStorage(): IStorage {
        if (!this.storage) throw new StorageError('Storage not initialized. Call init() first.');
        return this.storage;
    }

    public getConfig(): SovereignConfig {
        return this.config;
    }

    public getModulePath(moduleName: string, subPath: string, type: 'private' | 'public' | 'followed'): string {
        if (!/^[a-z0-9_-]+$/i.test(moduleName)) {
            throw new ModuleError(moduleName, `Invalid module name: "${moduleName}". Only alphanumeric, underscore, and hyphen are allowed.`);
        }
        const cleanModule = moduleName.toLowerCase();
        if (type === 'followed') {
            const parts = subPath.split('/');
            const userId = parts.shift();
            return `${PATHS.FOLLOWED_PREFIX}${userId}/${PATHS.MODULES_DIR}${cleanModule}/${parts.join('/')}`;
        }
        return `${type}/${PATHS.MODULES_DIR}${cleanModule}/${subPath}`;
    }

    public registerModule(definition: ModuleDefinition) {
        const existing = this.registeredModules.find(m => m.name === definition.name);
        if (existing) {
            throw new ModuleError(
                definition.name,
                `Module name collision: a module named "${definition.name}" is already registered. ` +
                `Each module must have a unique name to avoid path conflicts.`
            );
        }
        this.registeredModules.push(definition);

        if (this.syncWorker) {
            this.syncWorker.registerModule(definition).catch((e: any) => Logger.warn('Sovereign', 'Failed to register module in worker', e));
        }
    }

    public connectNativeRTC(transport: NativeWebRTCTransport) {
        if (this.config.enableP2PPairing === false) {
            Logger.warn('Sovereign', 'P2P Pairing is disabled in config. Connection rejected.');
            return;
        }

        if (this.publicRemote instanceof WebRTCRemoteAdapter) {
            this.publicRemote.connectNativeTransport(transport);
        } else if (this.remote instanceof WebRTCRemoteAdapter) {
            this.remote.connectNativeTransport(transport);
        } else {
            Logger.warn('Sovereign', 'Cannot connect native RTC: Active remote is not a WebRTCRemoteAdapter');
        }
    }

    public onModuleUpdate(moduleName: string, path: string) {
        this.emit(`${moduleName}:update`, { moduleName, path });
        this.emit('update', { moduleName, path });
    }

    public applyModuleSchema(db: any, moduleName: string) {
        const module = this.registeredModules.find(m => m.name === moduleName);
        if (!module) return;

        for (const table of module.tables) {
            db.exec(`CREATE TABLE IF NOT EXISTS ${table.name} (${table.schema});`);
        }

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
                Logger.info('Schema', `Applying migration v${migration.version} to ${moduleName}`);
                for (const sql of migration.sql) {
                    try {
                        db.exec(sql);
                    } catch (e: any) {
                        Logger.warn('Schema', `Migration v${migration.version} sql failed (likely already applied): ${e.message}`);
                    }
                }
                db.exec(`PRAGMA user_version = ${migration.version};`);
                currentVersion = migration.version;
            }
        }
    }

    public async getGroupStore(groupId: string, schema: string, date: string, sharedKey?: string): Promise<any> {
        const dbPath = `${PATHS.PUBLIC_PREFIX}${PATHS.GROUPS_DIR}${groupId}/${date}${PATHS.DB_EXT}`;
        let data = await this.getStorage().getFile(dbPath);

        if (data && sharedKey) {
            try {
                data = await this.decrypt(data, sharedKey);
            } catch (e: any) {
                Logger.warn('Sovereign', `Failed to decrypt group DB: ${e.message}`);
                data = null; 
            }
        }

        const initSqlJs = env.getSqlJs();
        if (!initSqlJs) throw new ModuleError(schema, 'sql.js not found');
        const sqliteInstance = await initSqlJs(env.getSqlConfig() || {});
        
        let db: any;
        try {
            db = new sqliteInstance.Database(data || undefined);
        } catch (e: any) {
            if (e.message?.includes('malformed') || e.message?.includes('not a database')) {
                Logger.error('Sovereign', `Group database corruption detected at ${dbPath}. Deleting.`);
                await this.getStorage().deleteFile(dbPath);
                db = new sqliteInstance.Database();
            } else {
                throw e;
            }
        }

        this.applyModuleSchema(db, schema);
        return db;
    }

    async init() {
        if (!this.storage) {
            const isBrowser = env.isBrowser() && typeof env.getIndexedDB() !== 'undefined';
            if (isBrowser) {
                const dbName = `sov_${this.config.paths.appId}_${this.config.paths.userId}`;
                this.storage = new IndexedDBStorage(dbName);
            } else {
                try {
                    const { NodeStorage } = await import('./adapters/NodeStorage');
                    const path = await import('path');
                    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
                    const baseDir = this.config.localPersistencePath || 
                                   path.join(homeDir, '.sovereigns3nc', this.config.paths.appId, this.config.paths.userId);
                    this.storage = new NodeStorage(baseDir);
                } catch (e: any) {
                    throw new StorageError(`Failed to load NodeStorage: ${e.message}. If you are in a browser, ensure indexedDB is available.`);
                }
            }
        }

        Logger.info('Sovereign', `v${SovereignS3nc.VERSION} Initializing storage...`);
        await this.storage.init();

        // Pass storage to managers if they were initialized with null (this happens if storage was not provided in constructor)
        // Actually, we should re-initialize managers if storage was set here.
        // Better: Make managers take a context that can return the storage.
        // I already did this for KeyManager etc. (well, mostly).
        // Let's ensure the context uses the current storage.
        (this.keyManager as any).ctx.storage = this.storage;
        (this.manifestManager as any).ctx.storage = this.storage;
        (this.groupManager as any).ctx.storage = this.storage;
        (this.moderationEngine as any).ctx.storage = this.storage;
        (this.globalRegistry as any).ctx.storage = this.storage;
        (this.syncOrchestrator as any).ctx.storage = this.storage;

        [this.remote, this.publicRemote, this.globalRemote].forEach(r => {
            if (r instanceof WebRTCRemoteAdapter) {
                r.storage = this.storage;
                (r as any).sign = (data: Uint8Array) => this.keyManager.sign(data);
                (r as any).verify = (data: Uint8Array, sig: Uint8Array, pk: string) => this.keyManager.verify(data, sig, pk);
                (r as any).signingPublicKey = (this.config as any).signingPublicKey;
                (r as any).getPublicKey = async (userId: string) => {
                    const registry = await this.getPublicRegistry();
                    const user = registry.find(u => u.userId === userId);
                    return (user as any)?.signingPublicKey || null;
                };
            }
        });

        if (this.config.useWorker && this.config.workerUrl) {
            const isCustom = !!this.remoteFactory || (!!this.remote && !(this.remote instanceof S3RemoteAdapter));
            
            if (isCustom) {
                Logger.warn('Sovereign', 'Custom remote adapters are not supported in background worker yet. Sync will fallback to main thread.');
                this.config.useWorker = false;
            } else {
                try {
                    Logger.info('Sovereign', `Initializing background sync worker: ${this.config.workerUrl}`);
                    this.syncWorker = new SyncWorkerProxy(this.config.workerUrl);
                    
                    this.syncWorker.on('error', (err) => {
                        Logger.warn('Sovereign', 'Background worker error, disabling worker:', err);
                        this.syncWorker = undefined;
                        this.config.useWorker = false;
                    });

                    this.syncWorker.on('update', (data) => {
                        this.emit('update', data);
                        if (data.moduleName) {
                            this.emit(`${data.moduleName}:update`, data);
                        }
                    });
                    this.syncWorker.on('conflict', (data) => {
                        this.emit('conflict', data);
                    });
                    await this.syncWorker.init(this.config);
                    (this.syncOrchestrator as any).ctx.syncWorker = this.syncWorker;
                } catch (e: any) {
                    Logger.warn('Sovereign', `Failed to initialize background worker, falling back to main thread: ${e.message}`);
                    this.syncWorker = undefined;
                    this.config.useWorker = false;
                }
            }
        }

        if (this.config.password && (!this.config.encryptionKey || !this.config.publicEncryptionKey)) {
            Logger.info('Sovereign', 'Initializing keys...');
            await this.initKeys();
        }
        
        if (this.config.publicEncryptionKey) {
            await this.ensureGlobalRegistration();
        }

        await this.blacklistManager.syncBlacklist();
        await this.keyManager.syncAdminKey();

        if (this.config.enablePeerExchange) {
            const adapters = [this.remote, this.publicRemote].filter(a => a instanceof WebRTCRemoteAdapter) as WebRTCRemoteAdapter[];
            for (const adapter of adapters) {
                adapter.enablePEX = true;
                
                adapter.on('signal_relay', async (from: string, signal: any) => {
                    Logger.info('Sovereign', `Processing relayed signal from ${from}`);
                    const transport = new NativeWebRTCTransport(this.config.paths.userId);
                    
                    if (signal.type === 'offer') {
                        const answer = await transport.handleOffer(signal.sdp);
                        adapter.relaySignal(from, answer);
                        
                        transport.onConnected = () => {
                            this.connectNativeRTC(transport);
                            Logger.info('Sovereign', `Auto-connected to peer ${from} via PEX relay`);
                        };
                    } else if (signal.type === 'answer') {
                        this.emit('pex:signal', { from, signal });
                    }
                });

                adapter.on('pex:peers', async (data: { from: string, peers: string[] }) => {
                    const myId = this.config.paths.userId;
                    const following = (await this.storage.getFollowing()).map(u => u.userId);
                    
                    for (const peerId of data.peers) {
                        if (peerId !== myId && following.includes(peerId)) {
                            Logger.info('Sovereign', `Attempting PEX handshake with ${peerId} via ${data.from}`);
                            const transport = new NativeWebRTCTransport(myId);
                            const offer = await transport.createOffer();
                            adapter.relaySignal(peerId, offer);

                            const signalHandler = (sigData: any) => {
                                if (sigData.from === peerId && sigData.signal.type === 'answer') {
                                    transport.handleAnswer(sigData.signal.sdp);
                                    this.off('pex:signal', signalHandler);
                                }
                            };
                            this.on('pex:signal', signalHandler);

                            transport.onConnected = () => {
                                this.connectNativeRTC(transport);
                                Logger.info('Sovereign', `Direct connection established with ${peerId} via PEX introduction`);
                            };
                        }
                    }
                });
            }

            setInterval(() => {
                const adapters = [this.remote, this.publicRemote].filter(a => a instanceof WebRTCRemoteAdapter) as WebRTCRemoteAdapter[];
                adapters.forEach(a => a.exchangePeers());
            }, 60000);
        }

        Logger.info('Sovereign', 'Initialization complete.');
    }

    public async connectRemote(remote: any) {
        Logger.info('Sovereign', 'Connecting to remote...');
        
        if (remote.region && remote.bucketName) {
            this.config.s3 = remote;
            
            let privateId: string | undefined;
            if (this.config.password) {
                const crypto = await import('crypto');
                privateId = crypto.pbkdf2Sync(this.config.password, this.config.paths.userId + '-private-id', 1000, 32, 'sha256').toString('hex');
            }
            
            this.initializeS3Remotes(remote, privateId);
        } else {
            this.remote = remote;
            this.publicRemote = remote;
            this.globalRemote = remote;
        }

        if (this.config.password && this.config.encryptionKey) {
            await this.keyManager.ensureKeysAreRemote();
        }

        if (this.config.publicEncryptionKey) {
            await this.ensureGlobalRegistration();
        }

        await this.sync();
        Logger.info('Sovereign', 'Remote connection and initial sync complete.');
    }

    public async initKeys() { return this.keyManager.initKeys(); }
    public async changePassword(old: string, newP: string) { return this.keyManager.changePassword(old, newP); }
    public async encrypt(d: Uint8Array, k: string) { return this.keyManager.encrypt(d, k); }
    public async decrypt(d: Uint8Array, k: string) { return this.keyManager.decrypt(d, k); }
    public deriveSharedSecret(pk: string, context?: string) { return this.keyManager.deriveSharedSecret(pk, context); }

    public calculateHashedContent(d: Uint8Array, k?: string) { return this.keyManager.calculateHashedContent(d, k); }
    private getHashedUserId(uid: string, ip: boolean) { return this.keyManager.getHashedUserId(uid, ip); }

    public async sync(force: boolean = false) { return this.syncOrchestrator.sync(force); }

    public async createGroup(n: string, m: GroupMember[]) { return this.groupManager.createGroup(n, m); }
    public async updateGroup(g: SovereignGroup) { return this.groupManager.updateGroup(g); }
    public async joinGroup(g: SovereignGroup) { return this.groupManager.joinGroup(g); }
    public async respondToGroup(gid: string, s: any) { return this.groupManager.respondToGroup(gid, s); }
    public async leaveGroup(gid: string) { return this.groupManager.leaveGroup(gid); }
    public async getGroupMembersWithStatus(gid: string) { return this.groupManager.getGroupMembersWithStatus(gid); }
    public async getGroups() { return this.groupManager.getGroups(); }

    public async ensureGlobalRegistration() { return this.globalRegistry.ensureGlobalRegistration(); }
    public async discoverUsers() { return this.globalRegistry.discoverUsers(); }
    public async autoFollowUsers(ul: any) { return this.globalRegistry.autoFollowUsers(ul); }
    public async getPublicRegistry() { return this.globalRegistry.getPublicRegistry(); }

    public async syncManifest() { return this.manifestManager.syncManifest(); }

    public async saveBlob(data: Uint8Array, isPublic: boolean = true): Promise<string> {
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
                const activeRemote = path.startsWith('public/') ? this.publicRemote : this.remote;
                if (!activeRemote) return null;
                const key = path.startsWith('public/') ? undefined : this.config.encryptionKey;
                const result = await activeRemote.downloadFile(path);
                if (result && result.data) {
                    data = result.data;
                    if (key) {
                        data = await this.decrypt(data, key);
                    }

                    // Verify hash
                    const expectedHash = path.split('/').pop();
                    const actualHash = this.calculateHashedContent(data);
                    if (expectedHash !== actualHash) {
                        Logger.error('Sovereign', `Hash mismatch for own blob ${path}. Expected ${expectedHash}, got ${actualHash}`);
                        throw new SyncError(`Blob corruption detected for ${path}`);
                    }

                    await this.storage.saveFile(path, data);
                }
            }
            return data;
        }

        if (!path.startsWith('public/')) {
            throw new SyncError('Only public blobs can be fetched from other users');
        }

        const userRemote = this.createRemote(userId);
        const result = await userRemote.downloadFile(path);
        if (result && result.data) {
            const data = result.data;
            const expectedHash = path.split('/').pop();
            const actualHash = this.calculateHashedContent(data);
            if (expectedHash !== actualHash) {
                Logger.error('Sovereign', `Hash mismatch for blob ${path}. Expected ${expectedHash}, got ${actualHash}`);
                throw new SyncError(`Blob corruption detected for ${path}`);
            }

            await this.storage.saveFile(`${PATHS.FOLLOWED_PREFIX}${userId}/${path}`, data);
            return data;
            }
            return null;
            }

    public async follow(userId: string) {
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
        await this.storage.followUser(userId, SovereignS3nc.getDateStr(startDate), publicKey);
        Logger.info('Sovereign', `Followed ${userId}.`);
    }

    async unfollow(userId: string) { await this.storage.unfollowUser(userId); }
    async getFollowing() { return this.storage.getFollowing(); }

    public createRemote(userId: string, isPrivate: boolean = false): IRemoteAdapter {
        if (this.remoteFactory) {
            return this.remoteFactory(userId);
        }
        
        if (this.config.s3) {
            return new S3RemoteAdapter(this.config.s3, {
                appId: this.config.paths.appId,
                userId: isPrivate ? userId : this.getHashedUserId(userId, false),
                storeId: this.config.paths.storeId
            });
        }
        throw new SovereignError('CONFIG_ERROR', 'Remote configuration missing');
    }

    public static getDateStr(date: Date): string {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    public resolveConflict(conflictId: string, choice: 'local' | 'remote' | 'abort' | { mergedData: Uint8Array }) {
        const resolve = this.pendingConflicts.get(conflictId);
        if (resolve) {
            this.pendingConflicts.delete(conflictId);
            resolve(choice);
        }
    }

    private async handleConflict(path: string, localData: Uint8Array, remoteData: Uint8Array): Promise<'local' | 'remote' | 'abort' | { mergedData: Uint8Array }> {
        return new Promise((resolve) => {
            const conflictId = env.generateId(12);
            this.pendingConflicts.set(conflictId, resolve);
            this.emit('conflict', { id: conflictId, path, localData, remoteData });
        });
    }

    public async sendEncryptedPayload(recipientId: string, payload: any, namespace: string) {
        const following = await this.storage.getFollowing();
        const recipient = following.find(f => f.userId === recipientId);
        let recipientPublicKey = recipient?.publicKey;

        if (!recipientPublicKey) {
            const registry = await this.getPublicRegistry();
            const found = registry.find(u => u.userId === recipientId);
            if (found) recipientPublicKey = found.publicKey;
        }

        if (!recipientPublicKey) throw new AuthError(`Recipient public key not found for ${recipientId}`);

        const sharedSecret = this.deriveSharedSecret(recipientPublicKey);
        const jsonData = JSON.stringify(payload);
        const dataBuffer = new TextEncoder().encode(jsonData);
        const encryptedData = await this.encrypt(dataBuffer, sharedSecret);

        const timestamp = Date.now();
        await this.storage.saveFile(`${PATHS.OUTBOX_DIR}${recipientId}/${namespace}/${timestamp}${PATHS.JSON_EXT}`, dataBuffer);
        await this.storage.saveFile(`${PATHS.DMS_DIR}${recipientId}/${namespace}/${timestamp}${PATHS.ENC_EXT}`, encryptedData);

        Logger.info('Sovereign', `Encrypted payload sent to ${recipientId} in namespace ${namespace}`);
    }

    public getMeshStats() {
        const adapters = [this.remote, this.publicRemote, this.globalRemote]
            .filter(a => a instanceof WebRTCRemoteAdapter) as WebRTCRemoteAdapter[];
        
        const uniquePeers = new Set<string>();
        let totalChannels = 0;

        adapters.forEach(a => {
            const stats = (a as any).getStats?.() || { connectedPeers: 0, peerIds: [] };
            stats.peerIds.forEach((id: string) => uniquePeers.add(id));
            totalChannels += stats.connectedPeers;
        });
        
        return {
            connectedPeers: Math.max(uniquePeers.size, totalChannels),
            peerIds: Array.from(uniquePeers)
        };
    }
}
