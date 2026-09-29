import { IStorage } from './IStorage';
import { IRemoteAdapter } from './IRemoteAdapter';
import { ModuleDefinition, SovereignConfig, SyncRunResult } from '../types';
import { DailyDatabase, DailyDatabaseConfig } from '../core/DailyDatabase';

export interface IScopedStorage {
    /**
     * Resolves a relative subpath into the fully-qualified storage path for this module.
     * E.g. getPath('2026-09-29.db', 'public') => 'public/modules/feed/2026-09-29.db'
     * E.g. getPath('bob/profile', 'followed') => 'followed/bob/profile'
     */
    getPath(subPath: string, type?: 'private' | 'public' | 'followed'): string;

    /** Read a file within the module's scoped namespace. */
    getFile(subPath: string, type?: 'private' | 'public' | 'followed'): Promise<Uint8Array | null>;

    /** Write a file within the module's scoped namespace, automatically emitting module update events. */
    saveFile(subPath: string, data: Uint8Array, type?: 'private' | 'public' | 'followed'): Promise<void>;

    /** Delete a file within the module's scoped namespace. */
    deleteFile(subPath: string, type?: 'private' | 'public' | 'followed'): Promise<void>;

    /** Check if a file exists within the module's scoped namespace. */
    hasFile(subPath: string, type?: 'private' | 'public' | 'followed'): Promise<boolean>;

    /** Saves data to the current user's public user file (e.g. profile). */
    savePublicUserFile(data: Uint8Array): Promise<void>;

    /** Retrieves the current user's public user file (e.g. profile). */
    getPublicUserFile(): Promise<Uint8Array | null>;

    /** Direct access to the underlying un-scoped storage adapter for custom operations. */
    readonly raw: IStorage;
}

export interface IScopedRemote {
    /** The user's public remote adapter (scoped to appId/hashedUserId/storeId). */
    getPublicRemote(): IRemoteAdapter | undefined;

    /** The user's private remote adapter (scoped to appId/privateGuid/storeId). */
    getPrivateRemote(): IRemoteAdapter | undefined;

    /** The system admin remote adapter (scoped to appId/admin). Available if admin remote is configured. */
    getAdminRemote(): IRemoteAdapter | undefined;

    /** The application root remote adapter (scoped to appId root). Available if root remote is configured. */
    getRootRemote(): IRemoteAdapter | undefined;

    /** The global registry remote adapter (scoped to appId/global/users). */
    getGlobalRemote(): IRemoteAdapter | undefined;

    /** Creates a remote adapter scoped to a specific target user. */
    createRemote(userId: string, isPrivate?: boolean): IRemoteAdapter;
}

export interface IQueryBuilder<T = Record<string, any>> {
    select(columns: string | string[]): this;
    where(condition: string, ...params: any[]): this;
    orderBy(column: string, direction?: 'ASC' | 'DESC'): this;
    limit(count: number): this;
    offset(count: number): this;
    toSql(): { sql: string; params: any[] };
    execute(db: any): T[];
    first(db: any): T | null;
}

export interface IModuleContext {
    /** The name of this module (e.g. 'feed', 'messaging', 'profile', 'moderation'). */
    readonly moduleName: string;

    /** The current user's ID. */
    readonly userId: string;

    /** The application ID. */
    readonly appId: string;

    /** The data store ID. */
    readonly storeId: string;

    /** Readonly view of the Sovereign configuration. */
    readonly config: Readonly<SovereignConfig>;

    /** Scoped storage operations for this module. */
    readonly storage: IScopedStorage;

    /** Scoped remote adapter access. */
    readonly remotes: IScopedRemote;

    // Crypto & Keys
    readonly publicKey?: string;
    readonly adminPublicKey?: string;
    encrypt(data: Uint8Array, key?: string): Promise<Uint8Array>;
    decrypt(data: Uint8Array, key?: string): Promise<Uint8Array>;
    deriveSharedSecret(peerPublicKey: string, context?: string): string;
    deriveEphemeralSharedSecret(recipientPublicKey: string): { ephemeralPublicKey: string; sharedSecret: string };
    deriveRecipientSharedSecret(ephemeralPublicKey: string): string;

    // Media & Blobs
    saveBlob(data: Uint8Array, isPublic?: boolean): Promise<string>;
    getBlob(blobPath: string, userId?: string): Promise<Uint8Array | null>;

    // Database & Query Builder
    getDailyDatabase(config?: DailyDatabaseConfig): DailyDatabase;
    createQueryBuilder<T = Record<string, any>>(tableName: string): IQueryBuilder<T>;
    getRepository<T extends Record<string, any>>(tableName: string, options?: any): any;

    // Registration & Events
    registerDefinition(definition: ModuleDefinition): void;
    registerInstance(instance: any): void;
    emit(event: string, payload?: any): void;
    on(event: string, handler: (payload: any) => void): void;
    off(event: string, handler: (payload: any) => void): void;

    // Social / Discovery
    getFollowing(): Promise<Array<{ userId: string; publicKey: string }>>;
    follow(userId: string): Promise<void>;
    unfollow(userId: string): Promise<void>;
    getPublicRegistry(): Promise<Array<{ userId: string; publicKey: string }>>;
    sync(): Promise<SyncRunResult>;

    // Host facade reference
    readonly sovereign: any;
}
