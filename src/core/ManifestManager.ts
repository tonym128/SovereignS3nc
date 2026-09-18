import { SovereignManifest } from '../types';
import { IStorage } from '../interfaces/IStorage';
import { IRemoteAdapter } from '../interfaces/IRemoteAdapter';
import { Logger } from '../utils/Logger';
import { PATHS } from '../utils/Constants';
import { SyncError } from '../utils/Errors';

export interface ManifestFetchResult {
    manifest: SovereignManifest | null;
    etag: string | null;
    unchanged: boolean;
    fromCache: boolean;
}

export interface ManifestManagerContext {
    userId: string;
    getEncryptionKey: () => string | undefined;
    storage: IStorage;
    getPublicRemote: () => IRemoteAdapter | undefined;
    createRemote: (userId: string) => IRemoteAdapter;
    calculateHashedContent: (data: Uint8Array, key?: string) => string;
    followManifestCacheTtlMs?: number;
}

export class ManifestManager {
    private followManifestCache = new Map<string, {
        etag: string | null;
        manifest: SovereignManifest;
        timestamp: number;
    }>();

    constructor(private ctx: ManifestManagerContext) {}

    public async syncManifest() {
        const publicRemote = this.ctx.getPublicRemote();
        if (!publicRemote) return;
        try {
            Logger.info('Sync', 'Generating and uploading manifest...');
            const manifest = await this.generateManifest();
            const data = new TextEncoder().encode(JSON.stringify(manifest));
            await publicRemote.uploadFile(PATHS.MANIFEST, data);
            Logger.info('Sync', 'Manifest uploaded successfully.');
        } catch (e: any) {
            Logger.warn('Sync', `Failed to sync manifest: ${e.message}`);
        }
    }

    public async generateManifest(): Promise<SovereignManifest> {
        const cachePath = PATHS.MANIFEST_CACHE;
        let cachedManifest: SovereignManifest | null = null;
        try {
            const cacheData = await this.ctx.storage.getFile(cachePath);
            if (cacheData) {
                cachedManifest = JSON.parse(new TextDecoder().decode(cacheData));
            }
        } catch (e) {}

        const allFiles = await this.ctx.storage.listFiles('');
        Logger.debug('Sync', `generateManifest: Scanning ${allFiles.length} files (Incremental)`);
        
        const manifest: SovereignManifest = {
            updatedAt: Date.now(),
            userId: this.ctx.userId,
            modules: {},
            dms: {},
            groups: {},
            blobs: [],
            files: {}
        };

        const profileData = await this.ctx.storage.getPublicUserFile();
        if (profileData) {
            manifest.profileHash = this.ctx.calculateHashedContent(profileData);
        }

        for (const file of allFiles) {
            if (file.includes(PATHS.MANIFEST)) continue;
            if (file.includes(PATHS.KEYS)) continue;
            if (file.includes(PATHS.SENTINEL)) continue;
            if (file.includes(PATHS.MANIFEST_CACHE)) continue;
            if (file.includes('.probe')) continue;
            if (file.startsWith(PATHS.FOLLOWED_PREFIX)) continue; 
            
            const parts = file.split('/');
            const fileName = parts[parts.length - 1];

            const updatedAt = await this.ctx.storage.getFileTimestamp(file) || Date.now();
            let hash: string | undefined;

            // Use cache if file hasn't changed
            if (cachedManifest && cachedManifest.files![file] && cachedManifest.files![file].updatedAt >= updatedAt) {
                hash = cachedManifest.files![file].hash;
            } else {
                const data = await this.ctx.storage.getFile(file);
                if (data) {
                    const type = file.startsWith(PATHS.PUBLIC_PREFIX) ? 'public' : 'private';
                    const key = type === 'private' ? this.ctx.getEncryptionKey() : undefined;
                    hash = this.ctx.calculateHashedContent(data, key);
                }
            }

            if (hash) {
                manifest.files![file] = { hash, updatedAt };
                
                if (parts.length === 2 && fileName.endsWith(PATHS.DB_EXT)) {
                    const dateStr = fileName.replace(PATHS.DB_EXT, '');
                    if (!manifest.modules['core']) manifest.modules['core'] = [];
                    if (!manifest.modules['core'].includes(dateStr)) manifest.modules['core'].push(dateStr);
                }
                else if (file.includes(`/${PATHS.MODULES_DIR}`) && fileName.endsWith(PATHS.DB_EXT)) {
                    const moduleName = parts[2];
                    if (parts.length === 4) {
                        const dateStr = fileName.replace(PATHS.DB_EXT, '');
                        if (!manifest.modules[moduleName]) manifest.modules[moduleName] = [];
                        if (!manifest.modules[moduleName].includes(dateStr)) manifest.modules[moduleName].push(dateStr);
                    } 
                    else if (parts.length === 6 && parts[3] === 'dms') {
                        const recipientId = parts[4];
                        const dateStr = fileName.replace(PATHS.DB_EXT, '');
                        if (!manifest.dms[recipientId]) manifest.dms[recipientId] = [];
                        if (!manifest.dms[recipientId].includes(dateStr)) manifest.dms[recipientId].push(dateStr);
                    }
                }
                else if (file.includes(`/${PATHS.GROUPS_DIR}`) && fileName.endsWith(PATHS.DB_EXT)) {
                    const groupId = parts[2];
                    const dateStr = fileName.replace(PATHS.DB_EXT, '');
                    if (!manifest.groups[groupId]) manifest.groups[groupId] = [];
                    if (!manifest.groups[groupId].includes(dateStr)) manifest.groups[groupId].push(dateStr);
                }

                manifest.blobs.push(file);
            }
        }

        // Save to local cache
        await this.ctx.storage.saveFile(cachePath, new TextEncoder().encode(JSON.stringify(manifest)));

        return manifest;
    }

    public async fetchManifestWithMeta(
        userId: string,
        options?: { forceRefresh?: boolean; ttlMs?: number }
    ): Promise<ManifestFetchResult> {
        const ttl = options?.ttlMs ?? this.ctx.followManifestCacheTtlMs ?? 60000;
        let cached = this.followManifestCache.get(userId);

        if (!cached) {
            try {
                const stored = await this.ctx.storage.getFile(`followed/${userId}/manifest.json`);
                const storedEtag = await this.ctx.storage.getGenericRemoteHashCache(`manifest_etag:${userId}`);
                if (stored && storedEtag) {
                    const manifest: SovereignManifest = JSON.parse(new TextDecoder().decode(stored));
                    cached = {
                        etag: storedEtag,
                        manifest,
                        timestamp: 0 // Expired TTL initially, forcing conditional check
                    };
                    this.followManifestCache.set(userId, cached);
                }
            } catch (e) {}
        }

        if (!options?.forceRefresh && cached && (Date.now() - cached.timestamp < ttl)) {
            Logger.debug('Sync', `Serving cached manifest for ${userId} (TTL valid, etag: ${cached.etag})`);
            return {
                manifest: cached.manifest,
                etag: cached.etag,
                unchanged: true,
                fromCache: true
            };
        }

        try {
            const userRemote = this.ctx.createRemote(userId);
            const ifNoneMatch = (!options?.forceRefresh && cached?.etag) ? cached.etag : undefined;
            const result = await userRemote.downloadFile(PATHS.MANIFEST, ifNoneMatch);

            if (result) {
                if (result.notModified && cached) {
                    cached.timestamp = Date.now();
                    Logger.debug('Sync', `Manifest for ${userId} 304 Not Modified (etag: ${cached.etag})`);
                    return {
                        manifest: cached.manifest,
                        etag: cached.etag,
                        unchanged: true,
                        fromCache: false
                    };
                }

                if (result.data) {
                    const manifest: SovereignManifest = JSON.parse(new TextDecoder().decode(result.data));
                    const etag = result.etag || null;
                    this.followManifestCache.set(userId, {
                        etag,
                        manifest,
                        timestamp: Date.now()
                    });
                    if (etag) {
                        await this.ctx.storage.saveFile(`followed/${userId}/manifest.json`, result.data);
                        await this.ctx.storage.setGenericRemoteHashCache(`manifest_etag:${userId}`, etag);
                    }
                    Logger.debug('Sync', `Downloaded fresh manifest for ${userId} (etag: ${etag})`);
                    return {
                        manifest,
                        etag,
                        unchanged: false,
                        fromCache: false
                    };
                }
            }
        } catch (e: any) {
            Logger.debug('Sync', `Manifest not found or error for user ${userId}: ${e.message}`);
        }

        return {
            manifest: null,
            etag: null,
            unchanged: false,
            fromCache: false
        };
    }

    public async fetchManifest(userId: string): Promise<SovereignManifest | null> {
        const res = await this.fetchManifestWithMeta(userId);
        return res.manifest;
    }

    public clearFollowManifestCache(userId?: string) {
        if (userId) {
            this.followManifestCache.delete(userId);
        } else {
            this.followManifestCache.clear();
        }
    }

    public expireFollowManifestCache(userId?: string) {
        if (userId) {
            const entry = this.followManifestCache.get(userId);
            if (entry) entry.timestamp = 0;
        } else {
            for (const entry of this.followManifestCache.values()) {
                entry.timestamp = 0;
            }
        }
    }

    public getFollowManifestCache(userId: string) {
        return this.followManifestCache.get(userId);
    }
}


