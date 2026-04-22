
import { SovereignS3nc } from '../SovereignS3nc';
import { SovereignConfig, ModuleDefinition } from '../types';
import { Logger } from '../utils/Logger';

export interface WorkerMessage {
    type: string;
    payload?: any;
    id?: number;
    error?: string;
}

/**
 * SyncWorkerEngine contains the core logic for the background sync worker.
 * It is decoupled from the actual Web Worker global scope to allow for testing.
 */
export class SyncWorkerEngine {
    private sovereign: SovereignS3nc | null = null;

    constructor(private postMessage: (message: WorkerMessage) => void) {}

    /**
     * Handles incoming messages from the main thread.
     */
    public async handleMessage(message: WorkerMessage) {
        const { type, payload, id } = message;

        try {
            switch (type) {
                case 'INIT':
                    await this.handleInit(payload);
                    this.postMessage({ id, type: 'INIT_SUCCESS' });
                    break;

                case 'SYNC':
                    await this.handleSync(payload);
                    this.postMessage({ id, type: 'SYNC_SUCCESS' });
                    break;

                case 'TERMINATE':
                    this.sovereign = null;
                    this.postMessage({ id, type: 'TERMINATED' });
                    break;

                case 'REGISTER_MODULE':
                    if (this.sovereign) {
                        this.sovereign.registerModule(payload);
                    }
                    this.postMessage({ id, type: 'REGISTER_MODULE_SUCCESS' });
                    break;

                case 'RESOLVE_CONFLICT':
                    if (this.sovereign) {
                        this.sovereign.resolveConflict(payload.conflictId, payload.choice);
                    }
                    break;

                default:
                    Logger.warn(`[SyncWorkerEngine] Unknown message type: ${type}`);
            }
        } catch (error: any) {
            Logger.error(`[SyncWorkerEngine] Error handling ${type}:`, error);
            this.postMessage({ 
                id, 
                type: 'ERROR', 
                error: error.message || 'Unknown error' 
            });
        }
    }

    private async handleInit(config: SovereignConfig) {
        Logger.info('[SyncWorkerEngine] Initializing SovereignS3nc instance...');
        // Disable useWorker for the instance INSIDE the worker to avoid infinite recursion
        const workerConfig = { ...config, useWorker: false };
        this.sovereign = new SovereignS3nc(workerConfig);
        
        // Forward update events back to the main thread
        this.sovereign.on('update', (data) => {
            this.postMessage({ type: 'EVENT_UPDATE', payload: data });
        });

        this.sovereign.on('conflict', (data) => {
            // Forward conflict to main thread
            this.postMessage({ type: 'EVENT_CONFLICT', payload: { id: data.id, path: data.path } });
        });

        await this.sovereign.init();
        Logger.info('[SyncWorkerEngine] Initialization complete.');
    }

    private async handleSync(payload: { forceSync?: boolean }) {
        if (!this.sovereign) {
            throw new Error('Sovereign instance not initialized in worker');
        }

        Logger.info('[SyncWorkerEngine] Starting background sync...');
        await this.sovereign.sync(payload.forceSync);
        Logger.info('[SyncWorkerEngine] Background sync complete.');
    }

    /**
     * Getter for the sovereign instance (mainly for testing)
     */
    public getSovereign() {
        return this.sovereign;
    }
}
