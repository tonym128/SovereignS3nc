import { SovereignManifest, SubManifest, SubManifestRef } from '../types';
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

    public computeMerkleRoot(subManifests: Record<string, { hash: string }>): string {
        const keys = Object.keys(subManifests).sort();
        if (keys.length === 0) {
            return this.ctx.calculateHashedContent(new TextEncoder().encode(''));
        }
        const combined = keys.map(k => `${k}:${subManifests[k].hash}`).join('|');
        return this.ctx.calculateHashedContent(new TextEncoder().encode(combined));
    }

    public async syncManifest() {
        const publicRemote = this.ctx.getPublicRemote();
        if (!publicRemote) return;
        try {
            Logger.info('Sync', 'Generating and uploading hierarchical manifest...');
            const { rootManifest, subManifests } = await this.generateHierarchicalManifest();

            // Upload sub-manifests whose hash changed
            for (const [key, sub] of Object.entries(subManifests)) {
                const subPath = sub.ref.path;
                const cachedHash = await this.ctx.storage.getGenericRemoteHashCache(`submanifest:${subPath}`);
                if (cachedHash !== sub.ref.hash) {
                    const data = new TextEncoder().encode(JSON.stringify(sub.data));
                    await publicRemote.uploadFile(subPath, data, sub.ref.hash);
                    await this.ctx.storage.setGenericRemoteHashCache(`submanifest:${subPath}`, sub.ref.hash);
                    Logger.debug('Sync', `Uploaded sub-manifest ${subPath} (hash: ${sub.ref.hash.substring(0, 8)})`);
                }
            }

            // Upload top-level manifest
            const rootData = new TextEncoder().encode(JSON.stringify(rootManifest));
            await publicRemote.uploadFile(PATHS.MANIFEST, rootData);
            Logger.info('Sync', `Hierarchical manifest uploaded successfully (merkleRoot: ${rootManifest.merkleRoot?.substring(0, 8)}).`);
        } catch (e: any) {
            Logger.warn('Sync', `Failed to sync manifest: ${e.message}`);
        }
    }

    public async generateHierarchicalManifest(): Promise<{
        rootManifest: SovereignManifest;
        subManifests: Record<string, { ref: SubManifestRef; data: SubManifest }>;
    }> {
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

        const rootManifest: SovereignManifest = {
            updatedAt: Date.now(),
            userId: this.ctx.userId,
            modules: {},
            dms: {},
            groups: {},
            receipts: {},
            blobs: [],
            files: {},
            subManifests: {}
        };

        const profileData = await this.ctx.storage.getPublicUserFile();
        if (profileData) {
            rootManifest.profileHash = this.ctx.calculateHashedContent(profileData);
        }

        const subManifestDataMap: Record<string, SubManifest> = {};

        const getOrCreatePartition = (key: string): SubManifest => {
            if (!subManifestDataMap[key]) {
                subManifestDataMap[key] = {
                    partitionKey: key,
                    updatedAt: 0,
                    userId: this.ctx.userId,
                    modules: {},
                    dms: {},
                    groups: {},
                    receipts: {},
                    blobs: key === 'blobs' ? [] : undefined,
                    files: {}
                };
            }
            return subManifestDataMap[key];
        };

        for (const file of allFiles) {
            if (file.includes(PATHS.MANIFEST)) continue;
            if (file.includes(PATHS.KEYS)) continue;
            if (file.includes(PATHS.SENTINEL)) continue;
            if (file.includes(PATHS.MANIFEST_CACHE)) continue;
            if (file.includes('.probe')) continue;
            if (file.startsWith(PATHS.FOLLOWED_PREFIX)) continue;
            if (file.startsWith('manifests/')) continue;

            const parts = file.split('/');
            const fileName = parts[parts.length - 1];

            const updatedAt = await this.ctx.storage.getFileTimestamp(file) || Date.now();
            let hash: string | undefined;

            if (cachedManifest && cachedManifest.files && cachedManifest.files[file] && cachedManifest.files[file].updatedAt >= updatedAt) {
                hash = cachedManifest.files[file].hash;
            } else {
                const data = await this.ctx.storage.getFile(file);
                if (data) {
                    const type = file.startsWith(PATHS.PUBLIC_PREFIX) ? 'public' : 'private';
                    const key = type === 'private' ? this.ctx.getEncryptionKey() : undefined;
                    hash = this.ctx.calculateHashedContent(data, key);
                }
            }

            if (hash) {
                rootManifest.files![file] = { hash, updatedAt };

                let partitionKey = 'misc';
                let dateStr: string | null = null;

                if (parts.length === 2 && fileName.endsWith(PATHS.DB_EXT)) {
                    dateStr = fileName.replace(PATHS.DB_EXT, '');
                    if (!rootManifest.modules['core']) rootManifest.modules['core'] = [];
                    if (!rootManifest.modules['core'].includes(dateStr)) rootManifest.modules['core'].push(dateStr);
                } else if (file.includes(`/${PATHS.MODULES_DIR}`) && fileName.endsWith(PATHS.DB_EXT)) {
                    const moduleName = parts[2];
                    if (parts.length === 4) {
                        dateStr = fileName.replace(PATHS.DB_EXT, '');
                        if (!rootManifest.modules[moduleName]) rootManifest.modules[moduleName] = [];
                        if (!rootManifest.modules[moduleName].includes(dateStr)) rootManifest.modules[moduleName].push(dateStr);
                    } else if (parts.length === 6 && parts[3] === 'dms') {
                        const recipientId = parts[4];
                        dateStr = fileName.replace(PATHS.DB_EXT, '');
                        if (!rootManifest.dms[recipientId]) rootManifest.dms[recipientId] = [];
                        if (!rootManifest.dms[recipientId].includes(dateStr)) rootManifest.dms[recipientId].push(dateStr);
                    } else if (parts.length === 6 && parts[3] === 'receipts') {
                        // Read receipt DB: public/modules/{module}/receipts/{senderId}/{date}.db
                        // These are tracked so the original sender can pull them on syncFollowedUser.
                        const senderId = parts[4];
                        dateStr = fileName.replace(PATHS.DB_EXT, '');
                        if (!rootManifest.receipts) rootManifest.receipts = {};
                        if (!rootManifest.receipts[senderId]) rootManifest.receipts[senderId] = [];
                        if (!rootManifest.receipts[senderId].includes(dateStr)) rootManifest.receipts[senderId].push(dateStr);
                    }
                } else if (file.includes(`/${PATHS.GROUPS_DIR}`) && fileName.endsWith(PATHS.DB_EXT)) {
                    const groupId = parts[2];
                    dateStr = fileName.replace(PATHS.DB_EXT, '');
                    if (!rootManifest.groups[groupId]) rootManifest.groups[groupId] = [];
                    if (!rootManifest.groups[groupId].includes(dateStr)) rootManifest.groups[groupId].push(dateStr);
                } else if (file.includes('blobs/') || file.startsWith('blobs/')) {
                    partitionKey = 'blobs';
                }

                if (dateStr && dateStr.length >= 4) {
                    const year = dateStr.substring(0, 4);
                    if (/^\d{4}$/.test(year)) {
                        partitionKey = year;
                    }
                }

                rootManifest.blobs.push(file);

                const partition = getOrCreatePartition(partitionKey);
                partition.files![file] = { hash, updatedAt };
                if (updatedAt > partition.updatedAt) partition.updatedAt = updatedAt;

                if (dateStr) {
                    if (parts.length === 2) {
                        if (!partition.modules!['core']) partition.modules!['core'] = [];
                        if (!partition.modules!['core'].includes(dateStr)) partition.modules!['core'].push(dateStr);
                    } else if (file.includes(`/${PATHS.MODULES_DIR}`)) {
                        const moduleName = parts[2];
                        if (parts.length === 4) {
                            if (!partition.modules![moduleName]) partition.modules![moduleName] = [];
                            if (!partition.modules![moduleName].includes(dateStr)) partition.modules![moduleName].push(dateStr);
                        } else if (parts.length === 6 && parts[3] === 'dms') {
                            const recipientId = parts[4];
                            if (!partition.dms![recipientId]) partition.dms![recipientId] = [];
                            if (!partition.dms![recipientId].includes(dateStr)) partition.dms![recipientId].push(dateStr);
                        } else if (parts.length === 6 && parts[3] === 'receipts') {
                            const senderId = parts[4];
                            if (!partition.receipts) partition.receipts = {};
                            if (!partition.receipts[senderId]) partition.receipts[senderId] = [];
                            if (!partition.receipts[senderId].includes(dateStr)) partition.receipts[senderId].push(dateStr);
                        }
                    } else if (file.includes(`/${PATHS.GROUPS_DIR}`)) {
                        const groupId = parts[2];
                        if (!partition.groups![groupId]) partition.groups![groupId] = [];
                        if (!partition.groups![groupId].includes(dateStr)) partition.groups![groupId].push(dateStr);
                    }
                }
                if (partitionKey === 'blobs' && partition.blobs) {
                    partition.blobs.push(file);
                }
            }
        }

        const subManifestsResult: Record<string, { ref: SubManifestRef; data: SubManifest }> = {};
        const subManifestRefs: Record<string, SubManifestRef> = {};

        for (const [key, data] of Object.entries(subManifestDataMap)) {
            const encoded = new TextEncoder().encode(JSON.stringify(data));
            const subHash = this.ctx.calculateHashedContent(encoded);
            const ref: SubManifestRef = {
                path: `manifests/${key}.json`,
                hash: subHash,
                count: Object.keys(data.files || {}).length,
                updatedAt: data.updatedAt || Date.now()
            };
            subManifestRefs[key] = ref;
            subManifestsResult[key] = { ref, data };
        }

        rootManifest.subManifests = subManifestRefs;
        rootManifest.merkleRoot = this.computeMerkleRoot(subManifestRefs);

        // Save root manifest to local cache
        await this.ctx.storage.saveFile(cachePath, new TextEncoder().encode(JSON.stringify(rootManifest)));

        return { rootManifest, subManifests: subManifestsResult };
    }

    public async generateManifest(): Promise<SovereignManifest> {
        const { rootManifest } = await this.generateHierarchicalManifest();
        return rootManifest;
    }

    public async resolveSubManifest(userId: string, partitionKey: string, ref: SubManifestRef): Promise<SubManifest | null> {
        const localPath = `followed/${userId}/${ref.path}`;
        const cachedHash = await this.ctx.storage.getGenericRemoteHashCache(`submanifest:${userId}:${ref.path}`);

        if (cachedHash === ref.hash) {
            const data = await this.ctx.storage.getFile(localPath);
            if (data) {
                try {
                    return JSON.parse(new TextDecoder().decode(data));
                } catch (e) {}
            }
        }

        try {
            const userRemote = this.ctx.createRemote(userId);
            const result = await userRemote.downloadFile(ref.path);
            if (result && result.data) {
                const subManifest: SubManifest = JSON.parse(new TextDecoder().decode(result.data));
                await this.ctx.storage.saveFile(localPath, result.data);
                await this.ctx.storage.setGenericRemoteHashCache(`submanifest:${userId}:${ref.path}`, ref.hash);
                return subManifest;
            }
        } catch (e: any) {
            Logger.debug('Sync', `Failed to download sub-manifest ${ref.path} for ${userId}: ${e.message}`);
        }
        return null;
    }

    public async resolveFullManifest(userId: string, rootManifest: SovereignManifest): Promise<SovereignManifest> {
        if (!rootManifest.subManifests || Object.keys(rootManifest.subManifests).length === 0) {
            // Flat legacy manifest
            return rootManifest;
        }

        const merged: SovereignManifest = {
            ...rootManifest,
            files: { ...(rootManifest.files || {}) },
            modules: { ...(rootManifest.modules || {}) },
            dms: { ...(rootManifest.dms || {}) },
            groups: { ...(rootManifest.groups || {}) },
            blobs: [...(rootManifest.blobs || [])]
        };

        for (const [key, ref] of Object.entries(rootManifest.subManifests)) {
            const sub = await this.resolveSubManifest(userId, key, ref);
            if (sub && sub.files) {
                Object.assign(merged.files!, sub.files);
            }
        }

        return merged;
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


