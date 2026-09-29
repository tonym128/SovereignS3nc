import { SovereignS3nc } from '../SovereignS3nc';
import {
    IModuleContext,
    IScopedStorage,
    IScopedRemote,
    IQueryBuilder
} from '../interfaces/IModuleContext';
import { ModuleDefinition, SovereignConfig, SyncRunResult } from '../types';
import { DailyDatabase, DailyDatabaseConfig } from './DailyDatabase';
import { Repository, RepositoryOptions } from './Repository';
import { ModuleError, AuthError } from '../utils/Errors';
import { PATHS } from '../utils/Constants';

/**
 * Validates identifier names (e.g. table names, columns) to protect against SQL injection.
 */
function validateIdentifier(name: string, type: 'table' | 'column'): string {
    if (typeof name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        throw new Error(`Invalid ${type} identifier: "${name}". Identifiers must match /^[a-zA-Z_][a-zA-Z0-9_]*$/.`);
    }
    return name;
}

/**
 * Fluent, type-safe SQL query builder for module database operations.
 */
export class QueryBuilder<T = Record<string, any>> implements IQueryBuilder<T> {
    private _tableName: string;
    private _columns: string = '*';
    private _whereConditions: { condition: string; params: any[] }[] = [];
    private _orderBy?: string;
    private _limit?: number;
    private _offset?: number;

    constructor(tableName: string) {
        this._tableName = validateIdentifier(tableName, 'table');
    }

    select(columns: string | string[]): this {
        if (Array.isArray(columns)) {
            columns.forEach(col => {
                if (col !== '*' && !col.includes('(')) {
                    validateIdentifier(col, 'column');
                }
            });
            this._columns = columns.map(c => (c === '*' || c.includes('(')) ? c : `"${c}"`).join(', ');
        } else {
            this._columns = columns;
        }
        return this;
    }

    where(condition: string, ...params: any[]): this {
        this._whereConditions.push({ condition, params });
        return this;
    }

    orderBy(column: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
        validateIdentifier(column, 'column');
        const cleanDir = direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        this._orderBy = `"${column}" ${cleanDir}`;
        return this;
    }

    limit(count: number): this {
        this._limit = Math.max(0, count);
        return this;
    }

    offset(count: number): this {
        this._offset = Math.max(0, count);
        return this;
    }

    toSql(): { sql: string; params: any[] } {
        let sql = `SELECT ${this._columns} FROM "${this._tableName}"`;
        const params: any[] = [];

        if (this._whereConditions.length > 0) {
            const clauses = this._whereConditions.map(w => {
                params.push(...w.params);
                return `(${w.condition})`;
            });
            sql += ` WHERE ${clauses.join(' AND ')}`;
        }

        if (this._orderBy) {
            sql += ` ORDER BY ${this._orderBy}`;
        }

        if (this._limit !== undefined) {
            sql += ` LIMIT ${this._limit}`;
        }

        if (this._offset !== undefined) {
            sql += ` OFFSET ${this._offset}`;
        }

        return { sql, params };
    }

    execute(db: any): T[] {
        const { sql, params } = this.toSql();
        const stmt = db.prepare(sql);
        try {
            if (params.length > 0) {
                stmt.bind(params);
            }
            const results: T[] = [];
            while (stmt.step()) {
                results.push(stmt.getAsObject() as T);
            }
            return results;
        } finally {
            stmt.free();
        }
    }

    first(db: any): T | null {
        const prevLimit = this._limit;
        this._limit = 1;
        const results = this.execute(db);
        this._limit = prevLimit;
        return results.length > 0 ? results[0] : null;
    }
}

/**
 * Concrete implementation of IModuleContext.
 * Enforces module encapsulation by providing scoped storage, scoped remotes,
 * and typed query building.
 */
export class ModuleContext implements IModuleContext {
    public readonly moduleName: string;
    public readonly sovereign: SovereignS3nc;
    public readonly storage: IScopedStorage;
    public readonly remotes: IScopedRemote;

    constructor(sovereign: SovereignS3nc, moduleName: string) {
        if (!/^[a-z0-9_-]+$/i.test(moduleName)) {
            throw new ModuleError(moduleName, `Invalid module name: "${moduleName}". Only alphanumeric, underscore, and hyphen are allowed.`);
        }
        this.sovereign = sovereign;
        this.moduleName = moduleName.toLowerCase();

        this.storage = {
            getPath: (subPath: string, type: 'private' | 'public' | 'followed' = 'public') => {
                return this.sovereign.getModulePath(this.moduleName, subPath, type);
            },
            getFile: async (subPath: string, type: 'private' | 'public' | 'followed' = 'public') => {
                const path = this.sovereign.getModulePath(this.moduleName, subPath, type);
                return this.sovereign.getStorage().getFile(path);
            },
            saveFile: async (subPath: string, data: Uint8Array, type: 'private' | 'public' | 'followed' = 'public') => {
                const path = this.sovereign.getModulePath(this.moduleName, subPath, type);
                await this.sovereign.getStorage().saveFile(path, data);
                this.sovereign.emit(`${this.moduleName}:update`, { path });
                this.sovereign.emit('update', { moduleName: this.moduleName, path });
            },
            deleteFile: async (subPath: string, type: 'private' | 'public' | 'followed' = 'public') => {
                const path = this.sovereign.getModulePath(this.moduleName, subPath, type);
                await this.sovereign.getStorage().deleteFile(path);
                this.sovereign.emit(`${this.moduleName}:update`, { path, deleted: true });
                this.sovereign.emit('update', { moduleName: this.moduleName, path, deleted: true });
            },
            hasFile: async (subPath: string, type: 'private' | 'public' | 'followed' = 'public') => {
                const path = this.sovereign.getModulePath(this.moduleName, subPath, type);
                const file = await this.sovereign.getStorage().getFile(path);
                return file !== null;
            },
            savePublicUserFile: async (data: Uint8Array) => {
                await this.sovereign.getStorage().savePublicUserFile(data);
                this.sovereign.emit(`${this.moduleName}:update`, { path: PATHS.USER_PROFILE });
                this.sovereign.emit('update', { moduleName: this.moduleName, path: PATHS.USER_PROFILE });
            },
            getPublicUserFile: async () => {
                return this.sovereign.getStorage().getPublicUserFile();
            },
            get raw() {
                return sovereign.getStorage();
            }
        };

        this.remotes = {
            getPublicRemote: () => this.sovereign.getPublicRemote(),
            getPrivateRemote: () => this.sovereign.getRemote(),
            getAdminRemote: () => this.sovereign.getAdminRemote(),
            getRootRemote: () => this.sovereign.getRootRemote(),
            getGlobalRemote: () => this.sovereign.getGlobalRemote(),
            createRemote: (userId: string, isPrivate: boolean = false) => this.sovereign.createRemote(userId, isPrivate)
        };
    }

    get userId(): string {
        return this.sovereign.getConfig().paths.userId;
    }

    get appId(): string {
        return this.sovereign.getConfig().paths.appId;
    }

    get storeId(): string {
        return this.sovereign.getConfig().paths.storeId;
    }

    get config(): Readonly<SovereignConfig> {
        return this.sovereign.getConfig();
    }

    get publicKey(): string | undefined {
        return this.sovereign.getConfig().publicEncryptionKey;
    }

    get adminPublicKey(): string | undefined {
        return this.sovereign.getConfig().adminPublicKey;
    }

    encrypt(data: Uint8Array, key?: string): Promise<Uint8Array> {
        const k = key || this.sovereign.getConfig().encryptionKey;
        if (!k) throw new AuthError('Cannot encrypt: No encryption key provided or configured.');
        return this.sovereign.encrypt(data, k);
    }

    decrypt(data: Uint8Array, key?: string): Promise<Uint8Array> {
        const k = key || this.sovereign.getConfig().encryptionKey;
        if (!k) throw new AuthError('Cannot decrypt: No encryption key provided or configured.');
        return this.sovereign.decrypt(data, k);
    }

    deriveSharedSecret(peerPublicKey: string, context?: string): string {
        return this.sovereign.deriveSharedSecret(peerPublicKey, context);
    }

    deriveEphemeralSharedSecret(recipientPublicKey: string): { ephemeralPublicKey: string; sharedSecret: string } {
        return this.sovereign.deriveEphemeralSharedSecret(recipientPublicKey);
    }

    deriveRecipientSharedSecret(ephemeralPublicKey: string): string {
        return this.sovereign.deriveRecipientSharedSecret(ephemeralPublicKey);
    }

    saveBlob(data: Uint8Array, isPublic: boolean = false): Promise<string> {
        return this.sovereign.saveBlob(data, isPublic);
    }

    getBlob(blobPath: string, userId?: string): Promise<Uint8Array | null> {
        return this.sovereign.getBlob(blobPath, userId);
    }

    getDailyDatabase(config?: DailyDatabaseConfig): DailyDatabase {
        return this.sovereign.getDailyDatabase(this.moduleName, config);
    }

    createQueryBuilder<T = Record<string, any>>(tableName: string): IQueryBuilder<T> {
        return new QueryBuilder<T>(tableName);
    }

    getRepository<T extends Record<string, any>>(tableName: string, options?: RepositoryOptions): Repository<T> {
        return new Repository<T>(this, tableName, options);
    }

    registerDefinition(definition: ModuleDefinition): void {
        this.sovereign.registerModule(definition);
    }

    registerInstance(instance: any): void {
        this.sovereign.registerModuleInstance(instance);
    }

    emit(event: string, payload?: any): void {
        this.sovereign.emit(event, payload);
    }

    on(event: string, handler: (payload: any) => void): void {
        this.sovereign.on(event, handler);
    }

    off(event: string, handler: (payload: any) => void): void {
        this.sovereign.off(event, handler);
    }

    getFollowing() {
        return this.sovereign.getFollowing();
    }

    follow(userId: string) {
        return this.sovereign.follow(userId);
    }

    unfollow(userId: string) {
        return this.sovereign.unfollow(userId);
    }

    getPublicRegistry() {
        return this.sovereign.getPublicRegistry();
    }

    sync(): Promise<SyncRunResult> {
        return this.sovereign.sync();
    }
}
