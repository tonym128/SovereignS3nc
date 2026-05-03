import { IStorage } from '../interfaces/IStorage';
import { IRemoteAdapter } from '../interfaces/IRemoteAdapter';
import { Logger } from '../utils/Logger';
import { env } from '../utils/Environment';
import { PATHS } from '../utils/Constants';
import { ModuleError } from '../utils/Errors';

export interface ModerationEngineContext {
    getAdminPublicKey: () => string | undefined;
    storage: IStorage;
    getPublicRemote: () => IRemoteAdapter | undefined;
    deriveSharedSecret: (otherPublicKey: string) => string;
    decrypt: (data: Uint8Array, key: string) => Promise<Uint8Array>;
    syncGenericFile: (relativePath: string, type: 'private' | 'public', remoteManifest: any) => Promise<void>;
    getModulePath: (moduleName: string, subPath: string, type: 'private' | 'public' | 'followed') => string;
}

export class ModerationEngine {
    constructor(private ctx: ModerationEngineContext) {}

    public async processModerationRequests() {
        const adminPublicKey = this.ctx.getAdminPublicKey();
        if (!adminPublicKey) {
            Logger.debug('Moderation', 'No admin public key found, skipping request check.');
            return;
        }

        const requestDir = PATHS.MODERATION_REQUESTS;
        const publicRemote = this.ctx.getPublicRemote();

        if (publicRemote && publicRemote.listFiles) {
            try {
                const remoteFiles = await publicRemote.listFiles(requestDir);
                for (const remotePath of remoteFiles) {
                    const localData = await this.ctx.storage.getFile(remotePath);
                    if (!localData) {
                        Logger.info('Moderation', `Downloading remote request: ${remotePath}`);
                        const result = await publicRemote.downloadFile(remotePath);
                        if (result && result.data) {
                            await this.ctx.storage.saveFile(remotePath, result.data);
                        }
                    }
                }
            } catch (e: any) {
                Logger.warn('Moderation', `Failed to discover remote requests: ${e.message}`);
            }
        }

        const files = await this.ctx.storage.listFiles(requestDir);
        
        if (files.length === 0) return;

        Logger.info('Moderation', `Found ${files.length} moderation requests.`);
        const sharedSecret = this.ctx.deriveSharedSecret(adminPublicKey);

        for (const file of files) {
            if (!file.endsWith(PATHS.ENC_EXT)) continue;

            try {
                const encryptedData = await this.ctx.storage.getFile(file);
                if (!encryptedData) continue;

                const decrypted = await this.ctx.decrypt(encryptedData, sharedSecret);
                const request = JSON.parse(new TextDecoder().decode(decrypted));

                if (request.action === 'delete_post') {
                    Logger.warn('Moderation', `ADMIN REQUEST: Deleting post ${request.postId} from date ${request.date}`);
                    
                    const modified = await this.surgicalDeletePost(request.postId, request.date);
                    
                    await this.ctx.storage.deleteFile(file);
                    if (publicRemote && (publicRemote as any).deleteFile) {
                        try {
                            await (publicRemote as any).deleteFile(file);
                        } catch (e) {}
                    }
                    
                    if (modified) {
                        for (const type of ['public', 'private'] as const) {
                            const relativePath = `${PATHS.MODULES_DIR}feed/${request.date}${PATHS.DB_EXT}`;
                            await this.ctx.syncGenericFile(relativePath, type, null);
                        }
                    }
                }
            } catch (e: any) {
                Logger.warn('Moderation', `Failed to process request ${file}: ${e.message}`);
            }
        }
    }

    public async surgicalDeletePost(postId: string, date: string): Promise<boolean> {
        let anyModified = false;
        const types: ('public' | 'private')[] = ['public', 'private'];
        
        for (const type of types) {
            const dbPath = this.ctx.getModulePath('feed', `${date}${PATHS.DB_EXT}`, type);
            const data = await this.ctx.storage.getFile(dbPath);
            if (!data) continue;

            try {
                const initSqlJs = env.getSqlJs();
                if (!initSqlJs) throw new ModuleError('moderation', 'sql.js not found');
                const sqliteInstance = await initSqlJs(env.getSqlConfig() || {});
                const db = new sqliteInstance.Database(data);
                
                const tableCheck = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='posts'");
                if (tableCheck.length > 0) {
                    db.run('DELETE FROM posts WHERE id = ?', [postId]);
                    if (db.getRowsModified() > 0) {
                        const binary = db.export();
                        await this.ctx.storage.saveFile(dbPath, binary);
                        anyModified = true;
                        Logger.info('Moderation', `Deleted post ${postId} from ${dbPath}`);
                    }
                }
                db.close();
            } catch (e: any) {
                Logger.warn('Moderation', `Failed to surgically delete post from ${dbPath}: ${e.message}`);
            }
        }
        return anyModified;
    }
}
