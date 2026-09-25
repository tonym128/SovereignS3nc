
import { SovereignConfig, SyncRunResult } from '../types';
import { EventEmitter } from 'events';
import { DEFAULTS } from '../utils/Constants';
import { SyncError } from '../utils/Errors';

/**
 * SyncWorkerProxy manages a Web Worker from the main thread.
 * It provides a Promise-based API for sync operations and emits events
 * when the worker detects changes.
 *
 * When `integrity` is provided (e.g. "sha256-abc123=="), the worker script
 * is fetched, the hash is verified via SubtleCrypto, and only then is the
 * Worker created from a Blob URL — preventing supply-chain attacks.
 */
export class SyncWorkerProxy extends EventEmitter {
    private worker: Worker | null = null;
    private messageId = 0;
    private pendingPromises: Map<number, { resolve: Function, reject: Function }> = new Map();

    constructor(private workerUrl: string, private integrity?: string) {
        super();
    }

    /**
     * Fetches the worker script and verifies its integrity against the given SRI hash.
     * Returns a Blob URL that can be used to create a same-origin Worker.
     * Throws SyncError if the hash does not match.
     */
    private async fetchAndVerifyWorker(url: string, integrity: string): Promise<string> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new SyncError(`Failed to fetch worker script: ${response.status} ${response.statusText}`);
        }
        const scriptText = await response.text();
        const scriptBytes = new TextEncoder().encode(scriptText);

        // Parse SRI hash: "sha256-<base64>" or "sha384-..." or "sha512-..."
        const match = integrity.match(/^(sha(?:256|384|512))-(.+)$/);
        if (!match) {
            throw new SyncError(`Invalid integrity format: "${integrity}". Expected "sha256-<base64>", "sha384-...", or "sha512-...".`);
        }
        const algorithm = match[1].toUpperCase().replace('SHA', 'SHA-'); // "sha256" -> "SHA-256"
        const expectedBase64 = match[2];

        const hashBuffer = await crypto.subtle.digest(algorithm, scriptBytes);
        const hashBase64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

        if (hashBase64 !== expectedBase64) {
            throw new SyncError(
                `Worker script integrity check FAILED for ${url}. ` +
                `Expected: ${expectedBase64}, Got: ${hashBase64}. ` +
                `This may indicate a supply-chain attack or stale deployment.`
            );
        }

        const blob = new Blob([scriptText], { type: 'application/javascript' });
        return URL.createObjectURL(blob);
    }

    /**
     * Initializes the worker and the Sovereign instance inside it.
     */
    async init(config: SovereignConfig): Promise<void> {
        if (!this.worker) {
            try {
                let workerSrc: string = this.workerUrl;

                // If an integrity hash is provided and we're in a browser environment
                // with SubtleCrypto + fetch, verify the script before loading it.
                if (this.integrity && typeof crypto !== 'undefined' && crypto.subtle && typeof fetch !== 'undefined') {
                    workerSrc = await this.fetchAndVerifyWorker(this.workerUrl, this.integrity);
                }

                this.worker = new Worker(workerSrc);
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
    async sync(forceSync: boolean = false): Promise<SyncRunResult> {
        return this.sendMessage('SYNC', { forceSync }, 60000); // 60s timeout for sync
    }

    /**
     * Registers a module definition in the worker.
     */
    async registerModule(definition: any): Promise<void> {
        return this.sendMessage('REGISTER_MODULE', definition, DEFAULTS.NETWORK_TIMEOUT);
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
        if (!this.worker) return Promise.reject(new SyncError('Worker not initialized'));

        const id = ++this.messageId;
        return new Promise((resolve, reject) => {
            let timer: any = null;
            if (timeout > 0) {
                timer = setTimeout(() => {
                    if (this.pendingPromises.has(id)) {
                        this.pendingPromises.delete(id);
                        reject(new SyncError(`Worker request timed out (${type})`));
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

        if (type === 'EVENT_SYNC_PROGRESS') {
            this.emit('sync:progress', payload);
            return;
        }

        if (type === 'EVENT_SYNC_DIAGNOSTIC') {
            this.emit('sync:diagnostic', payload);
            return;
        }

        if (type === 'EVENT_SYNC_RESULT') {
            this.emit('sync:result', payload);
            return;
        }

        // SYNC_RESULT follows the legacy SYNC_SUCCESS notification and carries the structured result.
        if (type === 'SYNC_SUCCESS') return;

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
            pending.reject(new SyncError(error));
        } else {
            pending.resolve(payload);
        }
    }
}
