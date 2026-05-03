/**
 * Base error class for all SovereignS3nc errors.
 */
export class SovereignError extends Error {
    constructor(public code: string, message: string, public details?: any) {
        super(message);
        this.name = 'SovereignError';
        Object.setPrototypeOf(this, SovereignError.prototype);
    }
}

/**
 * Errors related to authentication, password verification, and key management.
 */
export class AuthError extends SovereignError {
    constructor(message: string, details?: any) {
        super('AUTH_ERROR', message, details);
        this.name = 'AuthError';
        Object.setPrototypeOf(this, AuthError.prototype);
    }
}

/**
 * Errors related to data synchronization and conflict resolution.
 */
export class SyncError extends SovereignError {
    constructor(message: string, details?: any) {
        super('SYNC_ERROR', message, details);
        this.name = 'SyncError';
        Object.setPrototypeOf(this, SyncError.prototype);
    }
}

/**
 * Errors related to local storage (IndexedDB, Node FS, etc.).
 */
export class StorageError extends SovereignError {
    constructor(message: string, details?: any) {
        super('STORAGE_ERROR', message, details);
        this.name = 'StorageError';
        Object.setPrototypeOf(this, StorageError.prototype);
    }
}

/**
 * Errors related to network connectivity and remote adapters.
 */
export class NetworkError extends SovereignError {
    constructor(message: string, details?: any) {
        super('NETWORK_ERROR', message, details);
        this.name = 'NetworkError';
        Object.setPrototypeOf(this, NetworkError.prototype);
    }
}

/**
 * Errors related to module logic and schema.
 */
export class ModuleError extends SovereignError {
    constructor(moduleName: string, message: string, details?: any) {
        super(`MODULE_ERROR_${moduleName.toUpperCase()}`, message, details);
        this.name = 'ModuleError';
        Object.setPrototypeOf(this, ModuleError.prototype);
    }
}
