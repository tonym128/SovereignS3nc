
import { SovereignConfig } from '../types';
import { EventEmitter } from 'events';

/**
 * SyncWorkerProxy manages a Web Worker from the main thread.
 * It provides a Promise-based API for sync operations and emits events
 * when the worker detects changes.
 */
export class SyncWorkerProxy extends EventEmitter {
    private worker: Worker | null = null;
    private messageId = 0;
    private pendingPromises: Map<number, { resolve: Function, reject: Function }> = new Map();

    constructor(private workerUrl: string) {
        super();
    }

    /**
     * Initializes the worker and the Sovereign instance inside it.
     */
    async init(config: SovereignConfig): Promise<void> {
        if (!this.worker) {
            try {
                this.worker = new Worker(this.workerUrl);
                this.worker.onmessage = this.handleMessage.bind(this);
                this.worker.onerror = (err) => {
                    console.error('[SyncWorkerProxy] Worker error:', err);
                    // Avoid unhandled error event if no listeners
                    if (this.listenerCount('error') > 0) {
                        this.emit('error', err);
                    }
                };
            } catch (e: any) {
                console.error('[SyncWorkerProxy] Failed to create Worker:', e);
                throw e;
            }
        }

        return this.sendMessage('INIT', config, 10000); // 10s timeout for init
    }

    /**
     * Triggers a sync operation in the worker.
     */
    async sync(forceSync: boolean = false): Promise<void> {
        return this.sendMessage('SYNC', { forceSync }, 60000); // 60s timeout for sync
    }

    /**
     * Registers a module definition in the worker.
     */
    async registerModule(definition: any): Promise<void> {
        return this.sendMessage('REGISTER_MODULE', definition, 5000);
    }

    /**
     * Terminates the worker.
     */
    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }

    private sendMessage(type: string, payload: any, timeout: number = 0): Promise<any> {
        if (!this.worker) return Promise.reject(new Error('Worker not initialized'));

        const id = ++this.messageId;
        return new Promise((resolve, reject) => {
            let timer: any = null;
            if (timeout > 0) {
                timer = setTimeout(() => {
                    if (this.pendingPromises.has(id)) {
                        this.pendingPromises.delete(id);
                        reject(new Error(`Worker request timed out (${type})`));
                    }
                }, timeout);
            }

            this.pendingPromises.set(id, { 
                resolve: (res: any) => {
                    if (timer) clearTimeout(timer);
                    resolve(res);
                }, 
                reject: (err: any) => {
                    if (timer) clearTimeout(timer);
                    reject(err);
                } 
            });
            this.worker!.postMessage({ id, type, payload });
        });
    }

    private handleMessage(event: MessageEvent) {
        const { id, type, payload, error } = event.data;

        // 1. Handle Events (No ID or special event types)
        if (type === 'EVENT_UPDATE') {
            this.emit('update', payload);
            return;
        }

        if (type === 'EVENT_CONFLICT') {
            this.emit('conflict', {
                ...payload,
                resolve: (choice: 'local' | 'remote' | 'abort') => {
                    this.worker!.postMessage({ type: 'RESOLVE_CONFLICT', payload: { conflictId: payload.id, choice } });
                }
            });
            return;
        }

        // 2. Handle Responses to Promises
        const pending = this.pendingPromises.get(id);
        if (!pending) return;

        this.pendingPromises.delete(id);

        if (type === 'ERROR') {
            pending.reject(new Error(error));
        } else {
            pending.resolve(payload);
        }
    }
}
