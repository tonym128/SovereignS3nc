import { SovereignS3nc } from '../SovereignS3nc';
import { env } from '../utils/Environment';
import { ModuleError } from '../utils/Errors';
import { Logger } from '../utils/Logger';
import { IStorage } from '../interfaces/IStorage';

export interface DatabaseSession {
    db: any;
    save: () => Promise<void>;
    close: () => void;
}

export interface WithDatabaseOptions {
    /** Whether to export and persist changes back to storage after the callback completes. Default: false */
    save?: boolean;
    /** Whether to emit a module update event after saving. Default: false */
    emitUpdate?: boolean;
    /** Whether to apply registered module schema migrations. Default: true */
    applySchema?: boolean;
    /** Optional decryption key if database blob is symmetrically encrypted */
    decryptKey?: string;
    /** Optional encryption key for saving symmetrically encrypted database blob */
    encryptKey?: string;
}

/**
 * DailyDatabase encapsulates the SQLite (sql.js) lifecycle:
 * - sql.js initialization and instance caching
 * - Fetching/decrypting binary blobs from storage
 * - Database corruption recovery
 * - Schema/migration application
 * - Transactional execution via withDatabase(...)
 * - Binary export, encryption, storage persistence, and change notification
 */
export class DailyDatabase {
    private static cachedSqliteInstance: any = null;
    private static sqliteInitPromise: Promise<any> | null = null;

    constructor(
        private sov: SovereignS3nc,
        private defaultModuleName?: string
    ) {}

    /**
     * Retrieves or initializes the shared sql.js WebAssembly instance.
     * Caches the instance across calls to avoid redundant re-initialization.
     */
    public static async getSqliteInstance(): Promise<any> {
        if (DailyDatabase.cachedSqliteInstance) {
            return DailyDatabase.cachedSqliteInstance;
        }
        if (!DailyDatabase.sqliteInitPromise) {
            DailyDatabase.sqliteInitPromise = (async () => {
                const initSqlJs = env.getSqlJs();
                if (!initSqlJs) {
                    throw new ModuleError('DailyDatabase', 'sql.js not loaded in current environment');
                }
                const instance = await initSqlJs(env.getSqlConfig() || {});
                DailyDatabase.cachedSqliteInstance = instance;
                return instance;
            })();
        }
        return DailyDatabase.sqliteInitPromise;
    }

    /**
     * Resets the cached SQLite instance (primarily for testing environments).
     */
    public static resetInstanceCache(): void {
        DailyDatabase.cachedSqliteInstance = null;
        DailyDatabase.sqliteInitPromise = null;
    }

    /**
     * Opens a database session at a given storage path.
     * Callers must ensure `session.close()` is invoked (or use `withDatabase`).
     */
    public async openDatabase(
        storagePath: string,
        options?: WithDatabaseOptions & { moduleName?: string }
    ): Promise<DatabaseSession> {
        const storage: IStorage = this.sov.getStorage();
        let rawData = await storage.getFile(storagePath);

        if (rawData && options?.decryptKey) {
            try {
                rawData = await this.sov.decrypt(rawData, options.decryptKey);
            } catch (e: any) {
                Logger.warn('DailyDatabase', `Failed to decrypt database at ${storagePath}: ${e.message}`);
                rawData = null;
            }
        }

        const sqliteInstance = await DailyDatabase.getSqliteInstance();
        let db: any;
        try {
            db = new sqliteInstance.Database(rawData || undefined);
        } catch (e: any) {
            if (e.message?.includes('malformed') || e.message?.includes('not a database')) {
                Logger.error('DailyDatabase', `Database corruption detected at ${storagePath}. Deleting corrupted file.`);
                try {
                    await storage.deleteFile(storagePath);
                } catch (delErr: any) {
                    Logger.warn('DailyDatabase', `Failed to delete corrupted file at ${storagePath}: ${delErr.message}`);
                }
                db = new sqliteInstance.Database();
            } else {
                throw e;
            }
        }

        const moduleName = options?.moduleName || this.defaultModuleName;
        const applySchema = options?.applySchema !== false;
        if (moduleName && applySchema) {
            try {
                this.sov.applyModuleSchema(db, moduleName);
            } catch (e: any) {
                if (e.message?.includes('malformed') || e.message?.includes('not a database')) {
                    Logger.error('DailyDatabase', `Database corruption detected during schema application at ${storagePath}. Deleting corrupted file.`);
                    try {
                        await storage.deleteFile(storagePath);
                    } catch (delErr: any) {
                        Logger.warn('DailyDatabase', `Failed to delete corrupted file at ${storagePath}: ${delErr.message}`);
                    }
                    db = new sqliteInstance.Database();
                    this.sov.applyModuleSchema(db, moduleName);
                } else {
                    throw e;
                }
            }
        }

        let isClosed = false;

        const save = async () => {
            if (isClosed) {
                throw new ModuleError('DailyDatabase', `Cannot save closed database at ${storagePath}`);
            }
            let binary: Uint8Array = db.export();
            if (options?.encryptKey) {
                binary = await this.sov.encrypt(binary, options.encryptKey);
            }
            await storage.saveFile(storagePath, binary);
            if (options?.emitUpdate && moduleName) {
                this.sov.emit(`${moduleName}:update`, { path: storagePath });
            }
        };

        const close = () => {
            if (!isClosed) {
                isClosed = true;
                db.close();
            }
        };

        return { db, save, close };
    }

    /**
     * Executes a callback within a managed SQLite database session.
     * Automatically handles opening, schema migration, exporting, saving, and guaranteed closing.
     */
    public async withDatabase<T>(
        storagePath: string,
        callback: (db: any) => Promise<T> | T,
        options?: WithDatabaseOptions & { moduleName?: string }
    ): Promise<T> {
        const session = await this.openDatabase(storagePath, options);
        try {
            const result = await callback(session.db);
            if (options?.save) {
                await session.save();
            }
            return result;
        } finally {
            session.close();
        }
    }

    /**
     * Resolves the full storage path for a module's daily database file and executes the callback.
     */
    public async withDailyDatabase<T>(
        dateOrRelative: string,
        type: 'public' | 'private' | 'followed',
        callback: (db: any) => Promise<T> | T,
        options?: WithDatabaseOptions & { moduleName?: string; userId?: string }
    ): Promise<T> {
        const moduleName = options?.moduleName || this.defaultModuleName;
        if (!moduleName) {
            throw new ModuleError('DailyDatabase', 'Module name required to resolve daily database path');
        }

        let dbPath: string;
        const filename = dateOrRelative.endsWith('.db') ? dateOrRelative : `${dateOrRelative}.db`;

        if (type === 'followed') {
            if (!options?.userId) {
                dbPath = this.sov.getModulePath(moduleName, filename, 'followed');
            } else {
                dbPath = this.sov.getModulePath(moduleName, `${options.userId}/${filename}`, 'followed');
            }
        } else {
            dbPath = this.sov.getModulePath(moduleName, filename, type);
        }

        return this.withDatabase(dbPath, callback, { ...options, moduleName });
    }
}
