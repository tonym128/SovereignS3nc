import { SyncWorkerEngine } from './SyncWorkerEngine';

/**
 * Loads sql.js in the worker context.
 * Tries local path first, then falls back to CDN.
 */
function loadSqlJs() {
    if (typeof importScripts !== 'undefined' && typeof (self as any).initSqlJs === 'undefined') {
        const sqlJsVersion = '1.8.0';
        const urls = [
            './sql-wasm.js', // Local fallback
            `https://cdnjs.cloudflare.com/ajax/libs/sql.js/${sqlJsVersion}/sql-wasm.js` // CDN
        ];
        
        let loaded = false;
        for (const url of urls) {
            try {
                importScripts(url);
                loaded = true;
                
                // Configure SQL.js WASM location
                const wasmBase = url.includes('://') 
                    ? url.substring(0, url.lastIndexOf('/') + 1)
                    : './';
                
                (self as any).SQL_CONFIG = {
                    locateFile: (file: string) => `${wasmBase}${file}`
                };
                
                console.log(`[SyncWorker] Loaded sql.js from ${url}`);
                break;
            } catch (e) {
                // Try next URL
            }
        }
        
        if (!loaded) {
            console.error('[SyncWorker] Failed to load sql.js in worker context from any source');
        }
    }
}

// Ensure sql.js is loaded
loadSqlJs();

// Initialize the engine with the Web Worker's postMessage function
const engine = new SyncWorkerEngine((message) => self.postMessage(message));

/**
 * The Worker entry point.
 * Listens for messages from the main thread to control the sync process.
 */
self.onmessage = async (event: MessageEvent) => {
    await engine.handleMessage(event.data);
};
