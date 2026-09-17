import { SovereignConfig, SovereignManifest, SovereignGroup } from '../types';
import { IStorage } from '../interfaces/IStorage';
import { IRemoteAdapter } from '../interfaces/IRemoteAdapter';
import { Logger } from '../utils/Logger';
import { SovereignS3nc } from '../SovereignS3nc';
import { PATHS, DEFAULTS } from '../utils/Constants';
import { SyncError, NetworkError } from '../utils/Errors';

export interface SyncOrchestratorContext {
    config: SovereignConfig;
    storage: IStorage;
    getRemote: () => IRemoteAdapter | undefined;
    getPublicRemote: () => IRemoteAdapter | undefined;
    getGlobalRemote: () => IRemoteAdapter | undefined;
    isSyncing: () => boolean;
    setSyncing: (value: boolean) => void;
    syncWorker?: any;
    
    // Core methods to delegate back or use from other managers
    syncBlacklist: () => Promise<void>;
    syncAdminKey: () => Promise<void>;
    ensureGlobalRegistration: () => Promise<void>;
    updateFollowingPublicKeys: () => Promise<void>;
    discoverUsers: () => Promise<any>;
    autoFollowUsers: (users: any) => Promise<void>;
    processModerationRequests: () => Promise<void>;
    syncManifest: () => Promise<void>;
    generateManifest: () => Promise<SovereignManifest>;
    fetchManifest: (userId: string) => Promise<SovereignManifest | null>;
    syncGroups: (today: string) => Promise<void>;
    
    encrypt: (data: Uint8Array, key: string) => Promise<Uint8Array>;
    decrypt: (data: Uint8Array, key: string) => Promise<Uint8Array>;
    calculateHashedContent: (data: Uint8Array, key?: string) => string;
    handleConflict: (path: string, localData: Uint8Array, remoteData: Uint8Array) => Promise<'local' | 'remote' | 'abort' | { mergedData: Uint8Array }>;
    createRemote: (userId: string) => IRemoteAdapter;
    getModulePath: (moduleName: string, subPath: string, type: 'private' | 'public' | 'followed') => string;
    onModuleUpdate: (moduleName: string, path: string) => void;
    registeredModules: any[];
    /** Emit a sync progress event. Stage describes the current phase; total/done are optional file counts. */
    emitSyncProgress: (stage: string, done?: number, total?: number) => void;
}

export class SyncOrchestrator {
    constructor(private ctx: SyncOrchestratorContext) {}

    async sync(forceSync: boolean = false) {
        if (this.ctx.syncWorker) {
            Logger.info('Sovereign', 'Delegating sync to background worker...');
            return this.ctx.syncWorker.sync(forceSync);
        }

        if (!this.ctx.getRemote() || !this.ctx.getPublicRemote() || !this.ctx.getGlobalRemote()) {
            Logger.info('Sovereign', 'Remote not connected, skipping sync.');
            return;
        }

        if (this.ctx.isSyncing()) {
            Logger.info('Sovereign', 'Sync already in progress, skipping...');
            return;
        }
        this.ctx.setSyncing(true);
        try {
            if (forceSync) {
                Logger.info('Sync', 'FORCE SYNC initiated. Bypassing ETag cache.');
            }

            this.ctx.emitSyncProgress('start');

            let remoteManifest: SovereignManifest | null = null;
            const publicRemote = this.ctx.getPublicRemote();
            if (publicRemote && !forceSync) {
                try {
                    const result = await publicRemote.downloadFile(PATHS.MANIFEST);
                    if (result && result.data) {
                        remoteManifest = JSON.parse(new TextDecoder().decode(result.data));
                        Logger.info('Sync', 'Remote manifest downloaded for diffing.');
                    }
                } catch (e) {
                    Logger.debug('Sync', 'No remote manifest found.');
                }
            }

            const lastSync = forceSync ? null : await this.ctx.storage.getLastSyncDate();
            const today = SovereignS3nc.getDateStr(new Date()); 
            
            let currentDate: Date;
            if (lastSync) {
                currentDate = new Date(lastSync);
            } else {
                currentDate = new Date();
            }

            const end = new Date();
            currentDate.setUTCHours(0, 0, 0, 0);
            end.setUTCHours(0, 0, 0, 0);
            
            const syncDates = new Set<string>();
            syncDates.add(today);

            let iterDate = new Date(currentDate);
            while (iterDate <= end) {
                syncDates.add(SovereignS3nc.getDateStr(iterDate));
                iterDate.setUTCDate(iterDate.getUTCDate() + 1);
            }
            
            const sortedDates = Array.from(syncDates).sort();
            const dateTasks = sortedDates.flatMap(dateStr => [
                () => this.syncDay(dateStr, 'private', undefined, this.ctx.getRemote(), remoteManifest),
                () => this.syncDay(dateStr, 'public', undefined, this.ctx.getPublicRemote(), remoteManifest)
            ]);
            this.ctx.emitSyncProgress('syncing_own_data', 0, dateTasks.length);
            await this.runBatched(dateTasks, DEFAULTS.SYNC_BATCH_SIZE);

            this.ctx.emitSyncProgress('registering');
            await this.syncUserFile(remoteManifest);
            await this.ctx.ensureGlobalRegistration();
            await this.ctx.updateFollowingPublicKeys();
            
            if (this.ctx.config.autoFollowDiscoveredUsers !== false) {
                this.ctx.emitSyncProgress('discovering_users');
                const userList = await this.ctx.discoverUsers();
                if (userList) {
                    await this.ctx.autoFollowUsers(userList);
                }
            }

            this.ctx.emitSyncProgress('syncing_followed');
            await this.syncFollowedUsers(today);
            await this.ctx.syncGroups(today);

            const localManifest = await this.ctx.generateManifest();
            const allFilePaths = new Set([
                ...localManifest.blobs,
                ...(remoteManifest && remoteManifest.files ? Object.keys(remoteManifest.files) : [])
            ]);

            const blobTasks = Array.from(allFilePaths).map(filePath => {
                if (filePath.includes(PATHS.USER_PROFILE) || filePath.includes(PATHS.MANIFEST) || 
                    filePath.includes(PATHS.KEYS) || filePath.includes(PATHS.SENTINEL) ||
                    filePath.includes('.probe')) {
                    return null;
                }
                
                const parts = filePath.split('/');
                if (parts.length === 2 && filePath.endsWith(PATHS.DB_EXT)) {
                    return null;
                }

                const type = filePath.startsWith(PATHS.PUBLIC_PREFIX) ? 'public' : 'private';
                const relativePath = filePath.substring(type.length + 1);
                return () => this.syncGenericFile(relativePath, type, remoteManifest);
            }).filter(t => t !== null) as (() => Promise<void>)[];

            this.ctx.emitSyncProgress('syncing_blobs', 0, blobTasks.length);
            await this.runBatched(blobTasks, DEFAULTS.SYNC_BATCH_SIZE);

            await this.ctx.processModerationRequests();
            await this.ctx.syncManifest();
            await this.applyRetentionPolicy();
            await this.ctx.storage.setLastSyncDate(today);
            this.ctx.emitSyncProgress('complete');
        } finally {
            this.ctx.setSyncing(false);
        }
    }

    /**
     * Enforces local data retention policy by pruning date-partitioned files
     * that exceed the configured age limits (maxDaysOwnData, maxDaysFollowedData).
     * Returns the count of deleted files.
     */
    public async applyRetentionPolicy(): Promise<number> {
        const policy = this.ctx.config.retentionPolicy;
        if (!policy) return 0;

        let prunedCount = 0;
        const now = new Date();

        const getCutoff = (days: number): string => {
            const d = new Date(now);
            d.setUTCDate(d.getUTCDate() - days);
            return SovereignS3nc.getDateStr(d);
        };

        const allFiles = await this.ctx.storage.listFiles('');
        const dateRegex = /\b(\d{4}-\d{2}-\d{2})\b/;

        for (const file of allFiles) {
            const match = file.match(dateRegex);
            if (!match) continue;
            const fileDate = match[1];

            if (policy.maxDaysFollowedData !== undefined && file.startsWith(PATHS.FOLLOWED_PREFIX)) {
                const cutoff = getCutoff(policy.maxDaysFollowedData);
                if (fileDate < cutoff) {
                    await this.ctx.storage.deleteFile(file);
                    prunedCount++;
                    Logger.debug('Retention', `Pruned old followed file: ${file}`);
                }
            } else if (policy.maxDaysOwnData !== undefined && !file.startsWith(PATHS.FOLLOWED_PREFIX)) {
                const cutoff = getCutoff(policy.maxDaysOwnData);
                if (fileDate < cutoff) {
                    await this.ctx.storage.deleteFile(file);
                    prunedCount++;
                    Logger.debug('Retention', `Pruned old own file: ${file}`);
                }
            }
        }

        if (prunedCount > 0) {
            Logger.info('Retention', `Applied retention policy: pruned ${prunedCount} old files.`);
        }
        return prunedCount;
    }

    public async syncDay(date: string, type: 'private' | 'public', localPublicKey?: string, remoteOverride?: IRemoteAdapter, remoteManifest?: SovereignManifest | null) {
        try {
            const remotePath = `${type}/${date}${PATHS.DB_EXT}`;
            const activeRemote = remoteOverride || this.ctx.getRemote();
            if (!activeRemote) return;
            
            let localData = await this.ctx.storage.getDailyDb(date, type);
            const currentKey = type === 'private' ? this.ctx.config.encryptionKey : undefined;
            const cachedEtag = await this.ctx.storage.getRemoteHashCache(date, type);
            const cachedSyncHash = await this.ctx.storage.getGenericRemoteHashCache(`sync_hash:${remotePath}`);

            if (!localData) {
                const hasOnRemote = remoteManifest?.files?.[remotePath] !== undefined;
                if (hasOnRemote || !remoteManifest) {
                    Logger.info('Sync', `Downloading ${remotePath}`);
                    const result = await activeRemote.downloadFile(remotePath);
                    if (result && result.data) {
                        let data = result.data;
                        let remoteHash: string | null | undefined = remoteManifest?.files?.[remotePath]?.hash;
                        if (remoteHash === undefined) {
                            remoteHash = await activeRemote.getFileHash(remotePath);
                        }
                        if (currentKey) {
                            data = await this.ctx.decrypt(data, currentKey);
                        }
                        await this.ctx.storage.saveDailyDb(date, type, data);
                        if (result.etag) await this.ctx.storage.setRemoteHashCache(date, type, result.etag);
                        if (remoteHash) await this.ctx.storage.setGenericRemoteHashCache(`sync_hash:${remotePath}`, remoteHash);
                    }
                }
            } else {
                const localHash = this.ctx.calculateHashedContent(localData, currentKey);
                
                let remoteHash: string | null | undefined = remoteManifest?.files?.[remotePath]?.hash;
                if (remoteHash === undefined) {
                    remoteHash = await activeRemote.getFileHash(remotePath);
                }
                
                if (localHash === remoteHash) {
                    if (!cachedEtag || !cachedSyncHash) {
                        const remoteEtag = await activeRemote.getFileEtag(remotePath);
                        if (remoteEtag) await this.ctx.storage.setRemoteHashCache(date, type, remoteEtag);
                        if (remoteHash) await this.ctx.storage.setGenericRemoteHashCache(`sync_hash:${remotePath}`, remoteHash);
                    }
                    return;
                }

                if (cachedSyncHash && remoteHash !== cachedSyncHash && localHash !== cachedSyncHash) {
                    Logger.warn('Sync', `Conflict detected for ${remotePath}`);
                    const result = await activeRemote.downloadFile(remotePath);
                    if (result && result.data) {
                        let remoteData = result.data;
                        if (currentKey) {
                            try {
                                remoteData = await this.ctx.decrypt(remoteData, currentKey);
                            } catch (e: any) {
                                Logger.error('Sync', `Failed to decrypt remote conflict file: ${e.message}`);
                            }
                        }
                        
                        const choice = await this.ctx.handleConflict(remotePath, localData, remoteData);
                        if (choice === 'remote') {
                            localData = remoteData;
                            await this.ctx.storage.saveDailyDb(date, type, localData);
                            if (result.etag) await this.ctx.storage.setRemoteHashCache(date, type, result.etag);
                            if (remoteHash) await this.ctx.storage.setGenericRemoteHashCache(`sync_hash:${remotePath}`, remoteHash);
                            return;
                        } else if (typeof choice === 'object' && choice.mergedData) {
                            localData = choice.mergedData;
                            await this.ctx.storage.saveDailyDb(date, type, localData);
                            // We don't have an ETag for merged data yet, so we'll upload it next
                        } else if (choice === 'abort') {
                            Logger.info('Sync', `Conflict for ${remotePath} skipped by user.`);
                            return;
                        }
                    }
                }

                Logger.info('Sync', `Uploading ${remotePath}`);
                let uploadData = localData;
                if (currentKey) {
                    uploadData = await this.ctx.encrypt(localData, currentKey);
                }
                const etag = await activeRemote.uploadFile(remotePath, uploadData, localHash);
                if (etag) await this.ctx.storage.setRemoteHashCache(date, type, etag);
                await this.ctx.storage.setGenericRemoteHashCache(`sync_hash:${remotePath}`, localHash);
            }
        } catch (e: any) {
            Logger.warn('Sync', `syncDay failed for ${date}/${type}: ${e.message}`);
            if (e.message.includes('Sync aborted')) throw e;
        }
    }

    public async syncFollowedUsers(today: string) {
        const following = await this.ctx.storage.getFollowing();
        const usersToSync = [...following];

        if (this.ctx.config.adminPublicKey && !usersToSync.find(u => u.userId === 'admin')) {
            const startDate = new Date();
            startDate.setUTCDate(startDate.getUTCDate() - 7);
            usersToSync.push({
                userId: 'admin',
                publicKey: this.ctx.config.adminPublicKey,
                lastSync: SovereignS3nc.getDateStr(startDate)
            });
        }

        const blacklist = this.ctx.config.blacklist || [];

        for (const user of usersToSync) {
            if (blacklist.includes(user.userId)) {
                Logger.info('Sync', `Skipping blacklisted user ${user.userId}`);
                continue;
            }
            const manifest = await this.ctx.fetchManifest(user.userId);
            
            if (manifest) {
                Logger.info('Sync', `Using manifest for ${user.userId}`);
                if (manifest.modules['core']) {
                    for (const dateStr of manifest.modules['core']) {
                        await this.pullUserDay(user.userId, dateStr, user.publicKey);
                    }
                }

                for (const [moduleName, dates] of Object.entries(manifest.modules)) {
                    if (moduleName === 'core') continue;
                    for (const dateStr of dates) {
                        const remotePath = this.ctx.getModulePath(moduleName, `${dateStr}.db`, 'public');
                        const localPath = this.ctx.getModulePath(moduleName, `${user.userId}/${dateStr}.db`, 'followed');
                        const changed = await this.pullUserFile(user.userId, remotePath, user.publicKey, localPath, false);
                        if (changed) this.ctx.onModuleUpdate(moduleName, localPath);
                    }
                }

                const myId = this.ctx.config.paths.userId;
                if (manifest.dms[myId]) {
                    for (const dateStr of manifest.dms[myId]) {
                        for (const moduleDef of this.ctx.registeredModules) {
                            const moduleName = moduleDef.name;
                            const dmPath = this.ctx.getModulePath(moduleName, `dms/${myId}/${dateStr}.db`, 'public');
                            const localPath = this.ctx.getModulePath(moduleName, `${user.userId}/dms/${myId}/${dateStr}.db`, 'followed');
                            const changed = await this.pullUserFile(user.userId, dmPath, user.publicKey, localPath, false);
                            if (changed) this.ctx.onModuleUpdate(moduleName, localPath);
                        }
                    }
                }
            } else {
                const startDate = new Date(user.lastSync);
                const endDate = new Date(today);
                
                let iter = new Date(startDate);
                iter.setUTCHours(0, 0, 0, 0);
                endDate.setUTCHours(0, 0, 0, 0);

                while (iter <= endDate) {
                    const dateStr = SovereignS3nc.getDateStr(iter);
                    await this.pullUserDay(user.userId, dateStr, user.publicKey);
                    
                    for (const moduleDef of this.ctx.registeredModules) {
                        const moduleName = moduleDef.name;
                        const remotePath = this.ctx.getModulePath(moduleName, `${dateStr}.db`, 'public');
                        const localPath = this.ctx.getModulePath(moduleName, `${user.userId}/${dateStr}.db`, 'followed');
                        await this.pullUserFile(user.userId, remotePath, user.publicKey, localPath, false);

                        const myId = this.ctx.config.paths.userId;
                        const dmPath = this.ctx.getModulePath(moduleName, `dms/${myId}/${dateStr}.db`, 'public'); 
                        const dmLocalPath = this.ctx.getModulePath(moduleName, `${user.userId}/dms/${myId}/${dateStr}.db`, 'followed');
                        await this.pullUserFile(user.userId, dmPath, user.publicKey, dmLocalPath, false);
                    }

                    iter.setUTCDate(iter.getUTCDate() + 1);
                }
            }
            
            await this.ctx.storage.updateFollowedUserSync(user.userId, today);
        }
    }

    public async pullUserFile(userId: string, remotePath: string, publicKey: string, localPath: string, expectEncrypted: boolean = true): Promise<boolean> {
        try {
            const userRemote = this.ctx.createRemote(userId);
            const cachedEtag = await this.ctx.storage.getGenericRemoteHashCache(`${userId}:${remotePath}`);
            
            const result = await userRemote.downloadFile(remotePath, cachedEtag || undefined);
            
            if (result && !result.notModified && result.data) {
                let data = result.data;
                try {
                    if (expectEncrypted) {
                        data = await this.ctx.decrypt(data, publicKey);
                    }
                    await this.ctx.storage.saveFile(localPath, data);
                    if (result.etag) await this.ctx.storage.setGenericRemoteHashCache(`${userId}:${remotePath}`, result.etag);
                    return true;
                } catch (e: any) {
                    Logger.warn('Sync', `Failed to process ${remotePath} from ${userId}: ${e.message}`);
                }
            } else if (!result) {
                await this.ctx.storage.deleteFile(localPath);
                await this.ctx.storage.setGenericRemoteHashCache(`${userId}:${remotePath}`, '');
                return true;
            }
        } catch (e: any) {
            Logger.warn('Sync', `pullUserFile failed for ${userId}/${remotePath}: ${e.message}`);
        }
        return false;
    }

    public async pullUserDay(userId: string, date: string, publicKey: string) {
        try {
            const userRemote = this.ctx.createRemote(userId);
            const filePath = `${PATHS.PUBLIC_PREFIX}${date}${PATHS.DB_EXT}`;
            const cachedEtag = await this.ctx.storage.getRemoteHashCache(`${userId}:${date}`, 'followed' as any);

            const result = await userRemote.downloadFile(filePath, cachedEtag || undefined);

            if (result && !result.notModified && result.data) {
                let data = result.data;
                await this.ctx.storage.saveDailyDb(`${userId}/${date}`, 'followed' as any, data);
                if (result.etag) await this.ctx.storage.setRemoteHashCache(`${userId}:${date}`, 'followed' as any, result.etag);
            } else if (!result) {
                await this.ctx.storage.deleteDailyDb(`${userId}/${date}`, 'followed' as any);
                await this.ctx.storage.setRemoteHashCache(`${userId}:${date}`, 'followed' as any, '');
            }
        } catch (e: any) {
            Logger.warn('Sync', `pullUserDay failed for ${userId}/${date}: ${e.message}`);
        }
    }

    public async syncUserFile(remoteManifest?: SovereignManifest | null) {
        try {
            const publicRemote = this.ctx.getPublicRemote();
            if (!publicRemote) return;
            const remotePath = PATHS.USER_PROFILE;
            let localData = await this.ctx.storage.getPublicUserFile();
            const key = this.ctx.config.publicEncryptionKey;
            const cachedEtag = await this.ctx.storage.getGenericRemoteHashCache(remotePath);

            const result = await publicRemote.downloadFile(remotePath, cachedEtag || undefined);
            
            if (result && !result.notModified && result.data) {
                let remoteDecrypted = result.data;
                
                try {
                    JSON.parse(new TextDecoder().decode(result.data));
                } catch (e) {
                    try {
                        if (key) remoteDecrypted = await this.ctx.decrypt(result.data, key);
                    } catch (de) {
                        Logger.warn('Sync', 'Failed to decrypt remote user.json. Overwriting with local if possible.');
                    }
                }

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
                    await this.ctx.storage.savePublicUserFile(localData);
                    if (result.etag) await this.ctx.storage.setGenericRemoteHashCache(remotePath, result.etag);
                }
            }

            if (localData) {
                let remoteHash: string | null | undefined = remoteManifest?.files?.[remotePath]?.hash;
                if (remoteHash === undefined) {
                    remoteHash = await publicRemote.getFileHash(remotePath);
                }
                const localHash = this.ctx.calculateHashedContent(localData, key);
                
                if (localHash !== remoteHash) {
                    Logger.info('Sync', `Uploading ${remotePath}`);
                    let uploadData = localData;
                    if (key) uploadData = await this.ctx.encrypt(localData, key);
                    const etag = await publicRemote.uploadFile(remotePath, uploadData, localHash);
                    if (etag) await this.ctx.storage.setGenericRemoteHashCache(remotePath, etag);
                } else if (!cachedEtag && remoteHash) {
                    const remoteEtag = await publicRemote.getFileEtag(remotePath);
                    if (remoteEtag) await this.ctx.storage.setGenericRemoteHashCache(remotePath, remoteEtag);
                }
            }
        } catch (e: any) {
            Logger.warn('Sync', `syncUserFile failed: ${e.message}`);
        }
    }

    public async syncGenericFile(relativePath: string, type: 'private' | 'public', remoteManifest?: SovereignManifest | null) {
        try {
            const activeRemote = type === 'public' ? this.ctx.getPublicRemote() : this.ctx.getRemote();
            if (!activeRemote) return;
            const key = type === 'private' ? this.ctx.config.encryptionKey : undefined;
            
            const fullPath = relativePath.startsWith(`${type}/`) ? relativePath : `${type}/${relativePath}`;
            const s3Path = fullPath;

            let localData = await this.ctx.storage.getFile(fullPath);
            const cachedSyncHash = await this.ctx.storage.getGenericRemoteHashCache(`sync_hash:${fullPath}`);
            
            let remoteHash: string | null | undefined = remoteManifest?.files?.[fullPath]?.hash;
            if (remoteHash === undefined) {
                remoteHash = await activeRemote.getFileHash(s3Path);
            }

            if (!localData) {
                if (remoteHash) {
                    Logger.info('Sync', `Downloading generic file: ${fullPath}`);
                    const result = await activeRemote.downloadFile(s3Path);
                    if (result && result.data) {
                        let data = result.data;
                        if (key) data = await this.ctx.decrypt(data, key);
                        await this.ctx.storage.saveFile(fullPath, data);
                        if (result.etag) await this.ctx.storage.setGenericRemoteHashCache(fullPath, result.etag);
                        if (remoteHash) await this.ctx.storage.setGenericRemoteHashCache(`sync_hash:${fullPath}`, remoteHash);
                    }
                }
            } else {
                const localHash = this.ctx.calculateHashedContent(localData, key);

                if (localHash === remoteHash) {
                    const cachedEtag = await this.ctx.storage.getGenericRemoteHashCache(fullPath);
                    if (!cachedEtag || !cachedSyncHash) {
                        const remoteEtag = await activeRemote.getFileEtag(s3Path);
                        if (remoteEtag) await this.ctx.storage.setGenericRemoteHashCache(fullPath, remoteEtag);
                        if (remoteHash) await this.ctx.storage.setGenericRemoteHashCache(`sync_hash:${fullPath}`, remoteHash);
                    }
                    return;
                }

                if (cachedSyncHash && remoteHash !== cachedSyncHash && localHash !== cachedSyncHash) {
                    Logger.warn('Sync', `Conflict detected for ${fullPath}`);
                    const result = await activeRemote.downloadFile(s3Path);
                    if (result && result.data) {
                        let remoteData = result.data;
                        if (key) {
                            try {
                                remoteData = await this.ctx.decrypt(remoteData, key);
                            } catch (e: any) {
                                Logger.error('Sync', `Failed to decrypt remote conflict file: ${e.message}`);
                            }
                        }
                        
                        const choice = await this.ctx.handleConflict(fullPath, localData, remoteData);
                        if (choice === 'remote') {
                            localData = remoteData;
                            await this.ctx.storage.saveFile(fullPath, localData);
                            if (result.etag) await this.ctx.storage.setGenericRemoteHashCache(fullPath, result.etag);
                            if (remoteHash) await this.ctx.storage.setGenericRemoteHashCache(`sync_hash:${fullPath}`, remoteHash);
                            return;
                        } else if (typeof choice === 'object' && choice.mergedData) {
                            localData = choice.mergedData;
                            await this.ctx.storage.saveFile(fullPath, localData);
                            // Upload merged version next
                        } else if (choice === 'abort') {
                            Logger.info('Sync', `Conflict for ${fullPath} skipped by user.`);
                            return;
                        }
                    }
                }

                Logger.info('Sync', `Uploading generic file: ${fullPath}`);
                let uploadData = localData;
                if (key) uploadData = await this.ctx.encrypt(localData, key);
                const etag = await activeRemote.uploadFile(s3Path, uploadData, localHash);
                if (etag) await this.ctx.storage.setGenericRemoteHashCache(fullPath, etag);
                await this.ctx.storage.setGenericRemoteHashCache(`sync_hash:${fullPath}`, localHash);
            }
        } catch (e: any) {
            Logger.warn('Sync', `syncGenericFile failed for ${relativePath}: ${e.message}`);
            if (e.message?.includes('Sync aborted')) throw e;
        }
    }

    private async runBatched<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
        const results: T[] = new Array(tasks.length);
        let currentIndex = 0;
        const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
            while (currentIndex < tasks.length) {
                const index = currentIndex++;
                results[index] = await tasks[index]();
            }
        });
        await Promise.all(workers);
        return results;
    }
}
