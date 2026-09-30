import { SovereignS3nc } from '../SovereignS3nc';
import { env } from '../utils/Environment';
import { ModuleError } from '../utils/Errors';
import { Logger } from '../utils/Logger';
import { IStorage } from '../interfaces/IStorage';

export interface DatabaseSession {
    db: any;
    save: (options?: { immediate?: boolean; debounce?: boolean | number }) => Promise<void>;
    flush: () => Promise<void>;
    close: () => void;
}

export interface DailyDatabaseConfig {
    defaultModuleName?: string;
    /** Default debounce delay in ms for save operations. 0 = immediate. Default: 0 */
    debounceMs?: number;
    /** Maximum delay before a dirty database is forcefully exported under write load. Default: 2000ms */
    maxWaitMs?: number;
    /** Idle timeout before an unreferenced, clean database is closed. Default: 10000ms */
    idleTimeoutMs?: number;
}

export interface WithDatabaseOptions<T = any> {
    /** Whether to export and persist changes back to storage after the callback completes. Can be a boolean or a predicate function receiving the callback result. Default: false */
    save?: boolean | ((result: T) => boolean);
    /** Whether to emit a module update event after saving. Default: false */
    emitUpdate?: boolean;
    /** Whether to apply registered module schema migrations. Default: true */
    applySchema?: boolean;
    /** Optional decryption key if database blob is symmetrically encrypted */
    decryptKey?: string;
    /** Optional encryption key for saving symmetrically encrypted database blob */
    encryptKey?: string;
    /**
     * Whether to debounce the export and save to storage.
     * When true (or number in ms), mutations are kept in memory and saved after debounce delay.
     * When false, the database is exported and written to storage immediately.
     */
    debounce?: boolean | number;
    /** Force immediate flush to storage, bypassing any pending debounce. */
    immediate?: boolean;
}

export interface ActiveDatabaseEntry {
    db: any;
    storagePath: string;
    isDirty: boolean;
    moduleName?: string;
    encryptKey?: string;
    decryptKey?: string;
    emitUpdate?: boolean;
    debounceTimer?: any;
    maxWaitTimer?: any;
    firstDirtyAt?: number;
    lastAccessed: number;
    activeSessionCount: number;
    idleEvictionTimer?: any;
    flushPromise?: Promise<void> | null;
}

/**
 * DailyDatabase encapsulates the SQLite (sql.js) lifecycle:
 * - sql.js initialization and instance caching with dynamic reload detection
 * - In-memory connection pooling for open databases
 * - Debounced/batched SQLite binary export with max-wait guarantees
 * - Transactional execution via withDatabase(...)
 * - Database corruption recovery
 * - Schema/migration application
 * - Binary export, encryption, storage persistence, and change notification
 */
export class DailyDatabase {
    private static cachedSqliteInstance: any = null;
    private static sqliteInitPromise: Promise<any> | null = null;
    private static lastInitSqlJs: any = null;

    private pool: Map<string, ActiveDatabaseEntry>;
    private loadingPromises: Map<string, Promise<ActiveDatabaseEntry>>;
    private config: DailyDatabaseConfig;

    constructor(
        private sov: SovereignS3nc,
        private defaultModuleName?: string,
        rootDailyDb?: DailyDatabase,
        config?: DailyDatabaseConfig
    ) {
        if (rootDailyDb) {
            this.pool = rootDailyDb.pool;
            this.loadingPromises = rootDailyDb.loadingPromises;
            this.config = { ...rootDailyDb.config, ...config };
        } else {
            this.pool = new Map<string, ActiveDatabaseEntry>();
            this.loadingPromises = new Map<string, Promise<ActiveDatabaseEntry>>();
            this.config = {
                debounceMs: 0,
                maxWaitMs: 2000,
                idleTimeoutMs: 10000,
                ...config
            };
        }
    }

    /**
     * Retrieves or initializes the shared sql.js WebAssembly instance.
     * Caches the instance across calls to avoid redundant re-initialization,
     * but invalidates cache if env.getSqlJs changes (e.g. in test mocks).
     */
    public static async getSqliteInstance(): Promise<any> {
        const currentInitSqlJs = env.getSqlJs();
        if (DailyDatabase.cachedSqliteInstance && DailyDatabase.lastInitSqlJs === currentInitSqlJs) {
            return DailyDatabase.cachedSqliteInstance;
        }
        if (!currentInitSqlJs) {
            throw new ModuleError('DailyDatabase', 'sql.js not loaded in current environment');
        }
        DailyDatabase.lastInitSqlJs = currentInitSqlJs;
        DailyDatabase.cachedSqliteInstance = await currentInitSqlJs(env.getSqlConfig() || {});
        return DailyDatabase.cachedSqliteInstance;
    }

    /**
     * Resets the cached SQLite instance (primarily for testing environments).
     */
    public static resetInstanceCache(): void {
        DailyDatabase.cachedSqliteInstance = null;
        DailyDatabase.sqliteInitPromise = null;
        DailyDatabase.lastInitSqlJs = null;
    }

    /**
     * Opens a managed database session at a given storage path.
     * Callers must ensure `session.close()` is invoked (or use `withDatabase`).
     */
    public async openDatabase(
        storagePath: string,
        options?: WithDatabaseOptions & { moduleName?: string }
    ): Promise<DatabaseSession> {
        const entry = await this.acquireEntry(storagePath, options);
        entry.activeSessionCount++;
        entry.lastAccessed = Date.now();
        if (entry.idleEvictionTimer) {
            clearTimeout(entry.idleEvictionTimer);
            entry.idleEvictionTimer = null;
        }
        if (options?.encryptKey) {
            entry.encryptKey = options.encryptKey;
        }
        const moduleName = options?.moduleName || this.defaultModuleName;
        if (moduleName) {
            entry.moduleName = moduleName;
        }

        let isClosed = false;

        const save = async (saveOpts?: { immediate?: boolean; debounce?: boolean | number }) => {
            if (isClosed) {
                throw new ModuleError('DailyDatabase', `Cannot save closed database at ${storagePath}`);
            }
            entry.isDirty = true;
            if (options?.emitUpdate) {
                entry.emitUpdate = true;
            }
            if (options?.encryptKey) {
                entry.encryptKey = options.encryptKey;
            }

            const shouldImmediate = saveOpts?.immediate === true || saveOpts?.debounce === false;
            let debounceDelay = 0;

            if (!shouldImmediate) {
                if (typeof saveOpts?.debounce === 'number') {
                    debounceDelay = saveOpts.debounce;
                } else if (saveOpts?.debounce === true) {
                    debounceDelay = this.config.debounceMs || 500;
                } else if (saveOpts?.debounce === undefined && (this.config.debounceMs ?? 0) > 0) {
                    debounceDelay = this.config.debounceMs!;
                }
            }

            if (debounceDelay > 0) {
                this.scheduleDebouncedFlush(entry, debounceDelay);
            } else {
                await this.flushEntry(entry);
            }
        };

        const flush = async () => {
            await this.flushEntry(entry);
        };

        const close = () => {
            if (!isClosed) {
                isClosed = true;
                entry.activeSessionCount = Math.max(0, entry.activeSessionCount - 1);
                entry.lastAccessed = Date.now();
                if (entry.activeSessionCount === 0) {
                    if (!entry.isDirty) {
                        this.scheduleIdleEviction(entry);
                    }
                }
            }
        };

        return { db: entry.db, save, flush, close };
    }

    /**
     * Executes a callback within a managed SQLite database session.
     * Automatically handles opening, schema migration, debounced/immediate exporting,
     * and guaranteed session cleanup.
     */
    public async withDatabase<T>(
        storagePath: string,
        callback: (db: any) => Promise<T> | T,
        options?: WithDatabaseOptions<T> & { moduleName?: string }
    ): Promise<T> {
        const session = await this.openDatabase(storagePath, options);
        try {
            const result = await callback(session.db);
            const shouldSave = typeof options?.save === 'function' ? options.save(result) : options?.save;
            if (shouldSave) {
                await session.save({
                    immediate: options?.immediate,
                    debounce: options?.debounce
                });
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
        options?: WithDatabaseOptions<T> & { moduleName?: string; userId?: string }
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

    private async acquireEntry(
        storagePath: string,
        options?: WithDatabaseOptions & { moduleName?: string }
    ): Promise<ActiveDatabaseEntry> {
        const existing = this.pool.get(storagePath);
        if (existing) {
            return existing;
        }

        const loading = this.loadingPromises.get(storagePath);
        if (loading) {
            return await loading;
        }

        const loadPromise = (async () => {
            try {
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
                    if (rawData && rawData.length > 0) {
                        // Validate that loaded binary is a valid SQLite database
                        db.exec('PRAGMA user_version;');
                    }
                } catch (e: any) {
                    if (e.message?.includes('malformed') || e.message?.includes('not a database') || e.message?.includes('file is not a database')) {
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
                        if (e.message?.includes('malformed') || e.message?.includes('not a database') || e.message?.includes('file is not a database')) {
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

                const entry: ActiveDatabaseEntry = {
                    db,
                    storagePath,
                    isDirty: false,
                    moduleName,
                    encryptKey: options?.encryptKey,
                    decryptKey: options?.decryptKey,
                    lastAccessed: Date.now(),
                    activeSessionCount: 0
                };

                this.pool.set(storagePath, entry);
                return entry;
            } finally {
                this.loadingPromises.delete(storagePath);
            }
        })();

        this.loadingPromises.set(storagePath, loadPromise);
        return await loadPromise;
    }

    private scheduleDebouncedFlush(entry: ActiveDatabaseEntry, delayMs: number): void {
        const now = Date.now();
        if (entry.firstDirtyAt === undefined) {
            entry.firstDirtyAt = now;
        }

        const maxWaitMs = this.config.maxWaitMs || 2000;
        const timeSinceFirstDirty = now - entry.firstDirtyAt;
        const remainingMaxWait = Math.max(0, maxWaitMs - timeSinceFirstDirty);
        const effectiveDelay = Math.min(delayMs, remainingMaxWait);

        if (entry.debounceTimer) {
            clearTimeout(entry.debounceTimer);
        }

        entry.debounceTimer = setTimeout(() => {
            entry.debounceTimer = null;
            this.flushEntry(entry).catch((err: any) => {
                Logger.error('DailyDatabase', `Debounced flush failed for ${entry.storagePath}: ${err.message}`);
            });
        }, effectiveDelay);

        if (typeof entry.debounceTimer?.unref === 'function') {
            entry.debounceTimer.unref();
        }
    }

    public async flushEntry(entry: ActiveDatabaseEntry): Promise<void> {
        if (entry.flushPromise) {
            return entry.flushPromise;
        }
        if (!entry.isDirty) {
            return;
        }

        if (entry.debounceTimer) {
            clearTimeout(entry.debounceTimer);
            entry.debounceTimer = null;
        }

        entry.flushPromise = (async () => {
            try {
                let binary: Uint8Array = entry.db.export();
                if (entry.encryptKey) {
                    binary = await this.sov.encrypt(binary, entry.encryptKey);
                }
                await this.sov.getStorage().saveFile(entry.storagePath, binary);
                entry.isDirty = false;
                entry.firstDirtyAt = undefined;

                if (entry.emitUpdate && entry.moduleName) {
                    this.sov.emit(`${entry.moduleName}:update`, { path: entry.storagePath });
                    entry.emitUpdate = false;
                }
            } finally {
                entry.flushPromise = null;
                if (entry.activeSessionCount === 0 && !entry.isDirty) {
                    this.scheduleIdleEviction(entry);
                }
            }
        })();

        return entry.flushPromise;
    }

    private scheduleIdleEviction(entry: ActiveDatabaseEntry): void {
        if (entry.idleEvictionTimer) {
            clearTimeout(entry.idleEvictionTimer);
        }

        const idleTimeoutMs = this.config.idleTimeoutMs || 10000;
        entry.idleEvictionTimer = setTimeout(() => {
            entry.idleEvictionTimer = null;
            if (entry.activeSessionCount === 0 && !entry.isDirty) {
                try {
                    entry.db.close();
                } catch (e: any) {
                    Logger.warn('DailyDatabase', `Error closing idle database at ${entry.storagePath}: ${e.message}`);
                }
                this.pool.delete(entry.storagePath);
            }
        }, idleTimeoutMs);

        if (typeof entry.idleEvictionTimer?.unref === 'function') {
            entry.idleEvictionTimer.unref();
        }
    }

    /**
     * Immediately flushes any uncommitted changes for a specific database path to storage.
     */
    public async flush(storagePath: string): Promise<void> {
        const entry = this.pool.get(storagePath);
        if (entry && (entry.isDirty || entry.flushPromise)) {
            await this.flushEntry(entry);
        }
    }

    /**
     * Flushes all open, dirty databases to storage.
     * Guaranteed to persist all debounced/batched writes before sync or app exit.
     */
    public async flushAll(): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const entry of this.pool.values()) {
            if (entry.isDirty || entry.flushPromise) {
                promises.push(this.flushEntry(entry));
            }
        }
        await Promise.all(promises);
    }

    /**
     * Checks whether an active database entry is currently loaded in memory.
     */
    public has(storagePath: string): boolean {
        return this.pool.has(storagePath);
    }

    /**
     * Checks whether a database exists either in the active in-memory pool or in storage.
     */
    public async exists(storagePath: string): Promise<boolean> {
        if (this.pool.has(storagePath)) {
            return true;
        }
        const file = await this.sov.getStorage().getFile(storagePath);
        return !!file;
    }

    /**
     * Checks whether a specific database or any active database has pending uncommitted writes.
     */
    public isDirty(storagePath?: string): boolean {
        if (storagePath) {
            return this.pool.get(storagePath)?.isDirty ?? false;
        }
        for (const entry of this.pool.values()) {
            if (entry.isDirty) return true;
        }
        return false;
    }

    /**
     * Flushes and closes a specific database, freeing its in-memory WASM instance.
     */
    public async close(storagePath: string): Promise<void> {
        const entry = this.pool.get(storagePath);
        if (!entry) return;

        if (entry.debounceTimer) {
            clearTimeout(entry.debounceTimer);
            entry.debounceTimer = null;
        }
        if (entry.idleEvictionTimer) {
            clearTimeout(entry.idleEvictionTimer);
            entry.idleEvictionTimer = null;
        }

        if (entry.isDirty || entry.flushPromise) {
            await this.flushEntry(entry);
        }

        try {
            entry.db.close();
        } catch (e: any) {
            Logger.warn('DailyDatabase', `Error closing database at ${storagePath}: ${e.message}`);
        }
        this.pool.delete(storagePath);
    }

    /**
     * Flushes all dirty databases and closes all open database connections in the pool.
     */
    public async closeAll(): Promise<void> {
        const paths = Array.from(this.pool.keys());
        for (const path of paths) {
            await this.close(path);
        }
    }
}
