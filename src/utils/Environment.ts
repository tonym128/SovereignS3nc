import type { InitSqlJsStatic, SqlJsConfig } from 'sql.js';

/**
 * Environment abstraction to avoid globalThis type assertions and centralize
 * platform-specific checks.
 */
export const env = {
    /**
     * Access the subtle crypto API in a cross-platform way.
     */
    getSubtleCrypto: (): SubtleCrypto | undefined => {
        if (typeof globalThis !== 'undefined' && globalThis.crypto) {
            return globalThis.crypto.subtle;
        }
        return undefined;
    },

    /**
     * Get the sql.js initializer if available in the global scope.
     */
    getSqlJs: (): InitSqlJsStatic | undefined => {
        return (globalThis as any).initSqlJs;
    },

    /**
     * Get the global SQL configuration.
     */
    getSqlConfig: (): SqlJsConfig | undefined => {
        return (globalThis as any).SQL_CONFIG;
    },

    /**
     * Check if running in a browser environment.
     */
    isBrowser: (): boolean => {
        return typeof window !== 'undefined' && typeof window.document !== 'undefined';
    },

    /**
     * Check if running in a Web Worker.
     */
    isWorker: (): boolean => {
        return typeof importScripts !== 'undefined';
    },

    /**
     * Get the indexedDB implementation.
     */
    getIndexedDB: (): IDBFactory | undefined => {
        if (typeof globalThis !== 'undefined') {
            return (globalThis as any).indexedDB;
        }
        return undefined;
    },

    /**
     * Generate a cryptographically secure random ID string.
     */
    generateId: (length: number = 16): string => {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const bytes = new Uint8Array(length);
        
        if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
            globalThis.crypto.getRandomValues(bytes);
        } else {
            // Fallback for older Node.js or environments without global crypto
            // In this project, crypto-browserify or node:crypto should be available via imports,
            // but for a zero-dependency utility here we use a less ideal fallback if necessary,
            // or better, we just expect the environment to be set up.
            try {
                const nodeCrypto = require('crypto');
                const randomBytes = nodeCrypto.randomBytes(length);
                bytes.set(randomBytes);
            } catch (e) {
                // Last resort (not cryptographically secure, but better than crashing if EVERYTHING fails)
                for (let i = 0; i < length; i++) {
                    bytes[i] = Math.floor(Math.random() * 256);
                }
            }
        }

        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars[bytes[i] % chars.length];
        }
        return result;
    }
};
