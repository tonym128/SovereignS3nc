import { SovereignS3nc } from '../SovereignS3nc';
import { StoragePersistenceInfo } from '../interfaces/IStorage';
import { SovereignManifest } from '../types';
import { WebRTCRemoteAdapter } from '../adapters/WebRTCRemoteAdapter';

export interface StoragePartitionNode {
    name: string;
    path: string;
    size: number;
    timestamp?: number | null;
    type: 'file' | 'directory';
    children?: StoragePartitionNode[];
}

export interface StorageDiskFootprint {
    totalBytes: number;
    fileCount: number;
    byCategory: {
        public: number;
        private: number;
        followed: number;
        blobs: number;
        databases: number;
        other: number;
    };
    quotaInfo?: StoragePersistenceInfo;
}

export interface RemoteSyncSnapshot {
    isSyncing: boolean;
    lastSyncDate: string | null;
    syncMode: 's3' | 'webrtc' | 'offline';
    etagCache: Record<string, string>;
    manifest?: SovereignManifest | null;
}

export interface WebRTCMeshSnapshot {
    enabled: boolean;
    peerId: string | null;
    peerCount: number;
    peers: {
        peerId: string;
        latencyMs?: number;
        connected: boolean;
    }[];
    stats: {
        packetsSent: number;
        packetsReceived: number;
        packetsDropped: number;
        seenMessagesCount: number;
    };
}

export interface SemanticConflictDiff {
    id: string;
    path: string;
    timestamp: number;
    localSize: number;
    remoteSize: number;
    isBinary: boolean;
    preview: {
        localTextSnippet?: string;
        remoteTextSnippet?: string;
        diffType: 'sqlite_db' | 'json' | 'binary' | 'text';
    };
}

export interface DebugSnapshot {
    timestamp: number;
    appId: string;
    userId: string;
    storage: {
        tree: StoragePartitionNode[];
        footprint: StorageDiskFootprint;
    };
    remoteSync: RemoteSyncSnapshot;
    mesh: WebRTCMeshSnapshot;
    conflicts: SemanticConflictDiff[];
}

export class Inspector {
    /**
     * Collects and compiles an exhaustive debug snapshot of local storage,
     * remote sync status, WebRTC mesh network metrics, and active conflicts.
     */
    public static async getSnapshot(sov: SovereignS3nc): Promise<DebugSnapshot> {
        const config = sov.getConfig();
        const appId = config.paths.appId;
        const userId = config.paths.userId;
        const storage = sov.getStorage();

        // 1. Storage tree and footprint
        const allPaths = await storage.listFiles('').catch(() => []);
        const fileEntries: { path: string; size: number; timestamp: number | null }[] = [];

        let totalBytes = 0;
        const byCategory = {
            public: 0,
            private: 0,
            followed: 0,
            blobs: 0,
            databases: 0,
            other: 0
        };

        for (const p of allPaths) {
            const data = await storage.getFile(p).catch(() => null);
            const size = data ? data.byteLength : 0;
            const timestamp = await storage.getFileTimestamp(p).catch(() => null);

            fileEntries.push({ path: p, size, timestamp });
            totalBytes += size;

            if (p.includes('/blobs/') || p.startsWith('blobs/')) {
                byCategory.blobs += size;
            } else if (p.endsWith('.db')) {
                byCategory.databases += size;
            }

            if (p.startsWith('public/')) {
                byCategory.public += size;
            } else if (p.startsWith('private/')) {
                byCategory.private += size;
            } else if (p.startsWith('followed/')) {
                byCategory.followed += size;
            } else {
                byCategory.other += size;
            }
        }

        const tree = Inspector.buildPartitionTree(fileEntries);
        const quotaInfo = await sov.checkStoragePersistence().catch(() => ({ persisted: false }));

        const footprint: StorageDiskFootprint = {
            totalBytes,
            fileCount: fileEntries.length,
            byCategory,
            quotaInfo
        };

        // 2. Remote sync status and ETag cache
        const isSyncing = sov.isSyncing();
        const lastSyncDate = await storage.getLastSyncDate().catch(() => null);
        const syncMode: 's3' | 'webrtc' | 'offline' = config.offline
            ? 'offline'
            : (sov.getRemoteAdapter() instanceof WebRTCRemoteAdapter ? 'webrtc' : 's3');

        // Extract cached ETags and hashes for relevant files
        const etagCache: Record<string, string> = {};
        for (const entry of fileEntries) {
            const cachedEtag = await storage.getGenericRemoteHashCache(entry.path).catch(() => null);
            if (cachedEtag) {
                etagCache[entry.path] = cachedEtag;
            }
        }

        let manifest: SovereignManifest | null = null;
        try {
            const manifestBytes = await storage.getFile('public/manifest.json');
            if (manifestBytes) {
                manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
            }
        } catch {}

        const remoteSync: RemoteSyncSnapshot = {
            isSyncing,
            lastSyncDate,
            syncMode,
            etagCache,
            manifest
        };

        // 3. WebRTC mesh metrics
        const adapter = sov.getRemoteAdapter();
        const publicAdapter = sov.getPublicRemoteAdapter();
        const webrtc = (adapter instanceof WebRTCRemoteAdapter ? adapter : null) ||
                       (publicAdapter instanceof WebRTCRemoteAdapter ? publicAdapter : null);

        let mesh: WebRTCMeshSnapshot;
        if (webrtc) {
            const stats = webrtc.getMeshStats();
            mesh = {
                enabled: true,
                peerId: stats.peerId,
                peerCount: stats.peerCount,
                peers: stats.activePeers.map(p => ({
                    peerId: p,
                    latencyMs: stats.latencies[p],
                    connected: true
                })),
                stats: {
                    packetsSent: stats.packetsSent,
                    packetsReceived: stats.packetsReceived,
                    packetsDropped: stats.packetsDropped,
                    seenMessagesCount: stats.seenMessagesCount
                }
            };
        } else {
            mesh = {
                enabled: false,
                peerId: null,
                peerCount: 0,
                peers: [],
                stats: {
                    packetsSent: 0,
                    packetsReceived: 0,
                    packetsDropped: 0,
                    seenMessagesCount: 0
                }
            };
        }

        // 4. Unresolved conflicts
        const rawConflicts = sov.getUnresolvedConflicts();
        const conflicts: SemanticConflictDiff[] = rawConflicts.map(c => {
            const preview = Inspector.computeDiffSummary(c.localData, c.remoteData, c.path);
            return {
                id: c.id,
                path: c.path,
                timestamp: c.timestamp,
                localSize: c.localData.byteLength,
                remoteSize: c.remoteData.byteLength,
                isBinary: preview.diffType === 'binary' || preview.diffType === 'sqlite_db',
                preview
            };
        });

        return {
            timestamp: Date.now(),
            appId,
            userId,
            storage: {
                tree,
                footprint
            },
            remoteSync,
            mesh,
            conflicts
        };
    }

    /**
     * Builds a nested folder tree from flat file paths.
     */
    public static buildPartitionTree(
        files: { path: string; size: number; timestamp?: number | null }[]
    ): StoragePartitionNode[] {
        const rootNodes: StoragePartitionNode[] = [];

        for (const file of files) {
            const parts = file.path.split('/').filter(Boolean);
            let currentLevel = rootNodes;
            let currentPath = '';

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                const isFile = i === parts.length - 1;

                let existingNode = currentLevel.find(n => n.name === part);

                if (!existingNode) {
                    existingNode = {
                        name: part,
                        path: currentPath,
                        size: file.size,
                        timestamp: isFile ? file.timestamp : null,
                        type: isFile ? 'file' : 'directory',
                        children: isFile ? undefined : []
                    };
                    currentLevel.push(existingNode);
                } else if (!isFile) {
                    existingNode.size += file.size;
                }

                if (!isFile && existingNode.children) {
                    currentLevel = existingNode.children;
                }
            }
        }

        // Sort directories first, then alphabetically
        const sortNodes = (nodes: StoragePartitionNode[]) => {
            nodes.sort((a, b) => {
                if (a.type !== b.type) {
                    return a.type === 'directory' ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });
            for (const n of nodes) {
                if (n.children) {
                    sortNodes(n.children);
                }
            }
        };

        sortNodes(rootNodes);
        return rootNodes;
    }

    /**
     * Generates a semantic diff preview between local and remote versions of a conflicted file.
     */
    public static computeDiffSummary(
        localData: Uint8Array,
        remoteData: Uint8Array,
        path: string
    ): SemanticConflictDiff['preview'] {
        if (path.endsWith('.db')) {
            const isLocalSqlite = localData.byteLength >= 16 &&
                new TextDecoder().decode(localData.subarray(0, 15)).startsWith('SQLite format 3');
            const isRemoteSqlite = remoteData.byteLength >= 16 &&
                new TextDecoder().decode(remoteData.subarray(0, 15)).startsWith('SQLite format 3');

            return {
                diffType: 'sqlite_db',
                localTextSnippet: `SQLite 3 Database (${localData.byteLength.toLocaleString()} bytes, valid=${isLocalSqlite})`,
                remoteTextSnippet: `SQLite 3 Database (${remoteData.byteLength.toLocaleString()} bytes, valid=${isRemoteSqlite})`
            };
        }

        try {
            const localText = new TextDecoder('utf-8', { fatal: true }).decode(localData);
            const remoteText = new TextDecoder('utf-8', { fatal: true }).decode(remoteData);

            let diffType: 'json' | 'text' = 'text';
            try {
                JSON.parse(localText);
                diffType = 'json';
            } catch {}

            return {
                diffType,
                localTextSnippet: localText.length > 500 ? localText.substring(0, 500) + '...' : localText,
                remoteTextSnippet: remoteText.length > 500 ? remoteText.substring(0, 500) + '...' : remoteText
            };
        } catch {
            return {
                diffType: 'binary',
                localTextSnippet: `Binary Payload (${localData.byteLength.toLocaleString()} bytes)`,
                remoteTextSnippet: `Binary Payload (${remoteData.byteLength.toLocaleString()} bytes)`
            };
        }
    }
}
