
import { SovereignS3nc } from '../SovereignS3nc';
import { SovereignConfig } from '../types';
import { Logger } from '../utils/Logger';

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

let sovereign: SovereignS3nc | null = null;

/**
 * The Worker entry point.
 * Listens for messages from the main thread to control the sync process.
 */
self.onmessage = async (event: MessageEvent) => {
    const { type, payload, id } = event.data;

    try {
        switch (type) {
            case 'INIT':
                await handleInit(payload);
                self.postMessage({ id, type: 'INIT_SUCCESS' });
                break;

            case 'SYNC':
                await handleSync(payload);
                self.postMessage({ id, type: 'SYNC_SUCCESS' });
                break;

            case 'TERMINATE':
                sovereign = null;
                self.postMessage({ id, type: 'TERMINATED' });
                // Note: Actual termination is usually handled by the main thread calling worker.terminate()
                break;

            case 'RESOLVE_CONFLICT':
                if (sovereign) {
                    sovereign.resolveConflict(payload.conflictId, payload.choice);
                }
                break;

            default:
                console.warn(`[SyncWorker] Unknown message type: ${type}`);
        }
    } catch (error: any) {
        console.error(`[SyncWorker] Error handling ${type}:`, error);
        self.postMessage({ 
            id, 
            type: 'ERROR', 
            error: error.message || 'Unknown error' 
        });
    }
};

async function handleInit(config: SovereignConfig) {
    Logger.info('[SyncWorker] Initializing SovereignS3nc instance...');
    // Ensure we are in a worker context (browser)
    // IMPORTANT: Disable useWorker for the instance INSIDE the worker to avoid infinite recursion
    const workerConfig = { ...config, useWorker: false };
    sovereign = new SovereignS3nc(workerConfig);
    
    // Forward update events back to the main thread
    sovereign.on('update', (data) => {
        self.postMessage({ type: 'EVENT_UPDATE', payload: data });
    });

    sovereign.on('conflict', (data) => {
        // Forward conflict to main thread
        self.postMessage({ type: 'EVENT_CONFLICT', payload: { id: data.id, path: data.path } });
    });

    await sovereign.init();
    Logger.info('[SyncWorker] Initialization complete.');
}

async function handleSync(payload: { forceSync?: boolean }) {
    if (!sovereign) {
        throw new Error('Sovereign instance not initialized in worker');
    }

    Logger.info('[SyncWorker] Starting background sync...');
    await sovereign.sync(payload.forceSync);
    Logger.info('[SyncWorker] Background sync complete.');
}
