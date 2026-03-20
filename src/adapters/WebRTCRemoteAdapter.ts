import { IRemoteAdapter, DownloadResult } from '../interfaces/IRemoteAdapter';
import { Logger } from '../utils/Logger';
import { Buffer } from 'buffer';

export interface PeerMessage {
    type: 'push' | 'request' | 'response' | 'not_found';
    path: string;
    hash?: string;
    etag?: string;
    data?: string; // base64 encoded
    reqId?: string;
    senderId: string;
}

export class WebRTCRemoteAdapter implements IRemoteAdapter {
    private cache: Map<string, { data: Uint8Array, hash: string, etag: string }> = new Map();
    private channels: Set<{ send: (msg: string) => void }> = new Set();
    private prefix: string;
    public peerId: string;
    private pendingRequests: Map<string, (res: PeerMessage) => void> = new Map();

    constructor(peerId: string, prefix: string = '') {
        this.peerId = peerId;
        this.prefix = prefix;
        if (this.prefix && !this.prefix.endsWith('/')) {
            this.prefix += '/';
        }
    }

    private getKey(path: string): string {
        return `${this.prefix}${path}`;
    }

    /**
     * Connects an RTCDataChannel (or any mock channel) to this adapter.
     * @param sendFn A function that sends a string message to the peer.
     * @returns A receiver function to be called when a message is received from the peer.
     */
    public connectPeer(sendFn: (msg: string) => void): { receive: (msg: string) => void } {
        const channel = { send: sendFn };
        this.channels.add(channel);
        return {
            receive: (msg: string) => this.handleMessage(msg, channel)
        };
    }

    /**
     * Disconnects a channel.
     */
    public disconnectPeer(receiver: { receive: (msg: string) => void }) {
        // In a real scenario, we'd want a better way to match the channel, 
        // but for now, we'll keep it simple. If needed, the caller can maintain state.
    }

    private handleMessage(msgStr: string, sourceChannel: any) {
        try {
            const msg: PeerMessage = JSON.parse(msgStr);
            const key = msg.path;

            if (msg.type === 'push') {
                if (msg.data && msg.hash && msg.etag) {
                    const dataBuffer = Buffer.from(msg.data, 'base64');
                    const existing = this.cache.get(key);
                    // Extremely simplistic conflict resolution: if etag is different, accept it
                    // In a real mesh network, you'd compare timestamps or logical clocks.
                    if (!existing || existing.etag !== msg.etag) { 
                        this.cache.set(key, { data: new Uint8Array(dataBuffer), hash: msg.hash, etag: msg.etag });
                        Logger.debug(`[WebRTC] Peer ${msg.senderId} pushed ${key}. Caching and forwarding.`);
                        // Gossip: forward to others except sender
                        this.broadcast(msg, sourceChannel);
                    }
                }
            } else if (msg.type === 'request') {
                const entry = this.cache.get(key);
                if (entry) {
                    const res: PeerMessage = {
                        type: 'response',
                        path: key,
                        hash: entry.hash,
                        etag: entry.etag,
                        data: Buffer.from(entry.data).toString('base64'),
                        reqId: msg.reqId,
                        senderId: this.peerId
                    };
                    sourceChannel.send(JSON.stringify(res));
                } else {
                    const res: PeerMessage = {
                        type: 'not_found',
                        path: key,
                        reqId: msg.reqId,
                        senderId: this.peerId
                    };
                    sourceChannel.send(JSON.stringify(res));
                }
            } else if (msg.type === 'response' || msg.type === 'not_found') {
                if (msg.reqId && this.pendingRequests.has(msg.reqId)) {
                    this.pendingRequests.get(msg.reqId)!(msg);
                }
            }
        } catch (e: any) {
            Logger.warn(`[WebRTC] Failed to parse message: ${e.message}`);
        }
    }

    private broadcast(msg: PeerMessage, excludeChannel?: any) {
        const msgStr = JSON.stringify(msg);
        for (const channel of this.channels) {
            if (channel !== excludeChannel) {
                try {
                    channel.send(msgStr);
                } catch (e) {
                    // channel closed or error
                }
            }
        }
    }

    async uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null> {
        const key = this.getKey(path);
        // Fallback hash if not provided
        const fileHash = hash || Buffer.from(data).toString('hex').substring(0, 16); 
        const etag = `"${Date.now().toString()}-${Math.random().toString(36).substring(7)}"`;

        this.cache.set(key, { data, hash: fileHash, etag });

        const msg: PeerMessage = {
            type: 'push',
            path: key,
            hash: fileHash,
            etag,
            data: Buffer.from(data).toString('base64'),
            senderId: this.peerId
        };
        
        Logger.debug(`[WebRTC] Broadcasting push for ${key}`);
        this.broadcast(msg);
        return etag;
    }

    async downloadFile(path: string, ifNoneMatch?: string, timeout: number = 3000): Promise<DownloadResult | null> {
        const key = this.getKey(path);
        
        // 1. Check local cache first
        const local = this.cache.get(key);
        if (local) {
            if (ifNoneMatch && ifNoneMatch === local.etag) {
                return { data: null, etag: local.etag, notModified: true };
            }
            return { data: local.data, etag: local.etag };
        }

        // 2. Request from peers
        if (this.channels.size === 0) return null;

        Logger.debug(`[WebRTC] Requesting ${key} from peers...`);
        return new Promise((resolve) => {
            const reqId = Math.random().toString(36).substring(7);
            
            const timer = setTimeout(() => {
                this.pendingRequests.delete(reqId);
                resolve(null); // Timeout, file not found on mesh
            }, timeout);

            let notFoundCount = 0;
            const expectedCount = this.channels.size;

            this.pendingRequests.set(reqId, (resMsg: PeerMessage) => {
                if (resMsg.type === 'not_found') {
                    notFoundCount++;
                    if (notFoundCount >= expectedCount) {
                        clearTimeout(timer);
                        this.pendingRequests.delete(reqId);
                        resolve(null);
                    }
                    return;
                }

                clearTimeout(timer);
                this.pendingRequests.delete(reqId);
                
                if (resMsg.data && resMsg.hash && resMsg.etag) {
                    const dataBuffer = Buffer.from(resMsg.data, 'base64');
                    const u8Data = new Uint8Array(dataBuffer);
                    this.cache.set(key, { data: u8Data, hash: resMsg.hash, etag: resMsg.etag });
                    
                    if (ifNoneMatch && ifNoneMatch === resMsg.etag) {
                        resolve({ data: null, etag: resMsg.etag, notModified: true });
                    } else {
                        resolve({ data: u8Data, etag: resMsg.etag });
                    }
                } else {
                    resolve(null);
                }
            });

            const reqMsg: PeerMessage = {
                type: 'request',
                path: key,
                reqId,
                senderId: this.peerId
            };
            this.broadcast(reqMsg);
        });
    }

    async getFileHash(path: string): Promise<string | null> {
        const key = this.getKey(path);
        return this.cache.get(key)?.hash || null;
    }

    async getFileEtag(path: string): Promise<string | null> {
        const key = this.getKey(path);
        return this.cache.get(key)?.etag || null;
    }
}