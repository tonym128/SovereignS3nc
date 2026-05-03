import { SovereignManifest } from '../types';
import { IStorage } from '../interfaces/IStorage';
import { IRemoteAdapter } from '../interfaces/IRemoteAdapter';
import { Logger } from '../utils/Logger';
import { PATHS } from '../utils/Constants';
import { SyncError } from '../utils/Errors';

export interface ManifestManagerContext {
    userId: string;
    getEncryptionKey: () => string | undefined;
    storage: IStorage;
    getPublicRemote: () => IRemoteAdapter | undefined;
    createRemote: (userId: string) => IRemoteAdapter;
    calculateHashedContent: (data: Uint8Array, key?: string) => string;
}

export class ManifestManager {
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
        const allFiles = await this.ctx.storage.listFiles('');
        Logger.debug('Sync', `generateManifest: Scanning ${allFiles.length} files`);
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
            if (file.includes('.probe')) continue;
            if (file.startsWith(PATHS.FOLLOWED_PREFIX)) continue; 
            
            const parts = file.split('/');
            const fileName = parts[parts.length - 1];

            const data = await this.ctx.storage.getFile(file);
            if (data) {
                const type = file.startsWith(PATHS.PUBLIC_PREFIX) ? 'public' : 'private';
                const key = type === 'private' ? this.ctx.getEncryptionKey() : undefined;
                const hash = this.ctx.calculateHashedContent(data, key);
                const updatedAt = await this.ctx.storage.getFileTimestamp(file) || Date.now();
                manifest.files![file] = { hash, updatedAt };
            }
            
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
        return manifest;
    }

    public async fetchManifest(userId: string): Promise<SovereignManifest | null> {
        try {
            const userRemote = this.ctx.createRemote(userId);
            const result = await userRemote.downloadFile(PATHS.MANIFEST);
            if (result && result.data) {
                return JSON.parse(new TextDecoder().decode(result.data));
            }
        } catch (e) {
            Logger.debug('Sync', `Manifest not found for user ${userId}`);
        }
        return null;
    }
}
