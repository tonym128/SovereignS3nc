
import { SyncWorkerEngine } from './SyncWorkerEngine';

// Load sql.js if in worker context and not already loaded
if (typeof importScripts !== 'undefined' && typeof (self as any).initSqlJs === 'undefined') {
    try {
        // Use a consistent CDN version
        importScripts('https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js');
        (self as any).SQL_CONFIG = {
            locateFile: (file: string) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        };
    } catch (e) {
        console.error('[SyncWorker] Failed to load sql.js in worker context:', e);
    }
}

// Initialize the engine with the Web Worker's postMessage function
const engine = new SyncWorkerEngine((message) => self.postMessage(message));

/**
 * The Worker entry point.
 * Listens for messages from the main thread to control the sync process.
 */
self.onmessage = async (event: MessageEvent) => {
    await engine.handleMessage(event.data);
};
