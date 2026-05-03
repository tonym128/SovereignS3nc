import { IRemoteAdapter, DownloadResult } from '../interfaces/IRemoteAdapter';
import { Logger } from '../utils/Logger';
import { Buffer } from 'buffer';
import { NativeWebRTCTransport } from './NativeWebRTCTransport';
import { EventEmitter } from 'events';
import { LRUCache } from '../utils/LRUCache';
import { DEFAULTS } from '../utils/Constants';
import { NetworkError } from '../utils/Errors';
import { env } from '../utils/Environment';

export interface PeerMessage {
    type: 'push' | 'request' | 'response' | 'not_found' | 'purge' | 'peer_list' | 'relay_signal';
    path: string;
    hash?: string;
    etag?: string;
    data?: string; // base64 encoded
    reqId?: string;
    senderId: string;
    msgId?: string; // Unique ID for deduplication
    ttl?: number;   // Hop limit
    signature?: string; // Hex encoded signature
    signingPublicKey?: string; // Hex encoded signing public key
    // PEX fields
    peerList?: string[];
    to?: string;
    from?: string;
    signal?: any;
}

export interface WebRTCRemoteAdapterConfig {
    maxPeers?: number;
    ttl?: number;
    maxSeenMessages?: number;
    maxCacheSize?: number;
    sign?: (data: Uint8Array) => Uint8Array;
    verify?: (data: Uint8Array, signature: Uint8Array, publicKey: string) => boolean;
    signingPublicKey?: string;
    getPublicKey?: (userId: string) => Promise<string | null>;
}

export class WebRTCRemoteAdapter extends EventEmitter implements IRemoteAdapter {
    private cache: LRUCache<string, { data: Uint8Array, hash: string, etag: string }>;
    private channels: Set<{ send: (msg: string) => void }> = new Set();
    private prefix: string;
    public peerId: string;
    private pendingRequests: Map<string, (res: PeerMessage) => void> = new Map();
    public storage?: any; // Reference to Sovereign storage for purge operations
    
    // PEX & Signal Relay
    private channelsByUserId: Map<string, { send: (msg: string) => void }> = new Map();
    public enablePEX: boolean = false;
    public onSignalRelay?: (from: string, signal: any) => void;

    // Gossip Scaling & Safety
    private maxPeers: number;
    private defaultTTL: number;
    private seenMessages: Set<string> = new Set();
    private seenMessagesQueue: string[] = [];
    private maxSeenMessages: number;

    // Security
    private sign?: (data: Uint8Array) => Uint8Array;
    private verify?: (data: Uint8Array, signature: Uint8Array, publicKey: string) => boolean;
    private signingPublicKey?: string;
    private getPublicKey?: (userId: string) => Promise<string | null>;

    constructor(userId: string, prefix: string = '', config: WebRTCRemoteAdapterConfig = {}) {
        super();
        this.peerId = userId;
        this.prefix = prefix;
        if (this.prefix && !this.prefix.endsWith('/')) {
            this.prefix += '/';
        }
        this.maxPeers = config.maxPeers ?? DEFAULTS.RTC_MAX_PEERS;
        this.defaultTTL = config.ttl ?? DEFAULTS.RTC_TTL;
        this.maxSeenMessages = config.maxSeenMessages ?? DEFAULTS.RTC_MAX_SEEN_MESSAGES;
        this.cache = new LRUCache(config.maxCacheSize ?? DEFAULTS.RTC_MAX_CACHE_SIZE);
        this.sign = config.sign;
        this.verify = config.verify;
        this.signingPublicKey = config.signingPublicKey;
        this.getPublicKey = config.getPublicKey;
    }

    /**
     * Sends an SDP signal to a target peer through the mesh.
     */
    public relaySignal(to: string, signal: any) {
        const msg: PeerMessage = {
            type: 'relay_signal',
            path: '',
            senderId: this.peerId,
            from: this.peerId,
            to,
            signal,
            msgId: this.generateMsgId()
        };
        
        const targetChannel = this.channelsByUserId.get(to);
        if (targetChannel) {
            targetChannel.send(JSON.stringify(msg));
        } else {
            this.broadcast(msg);
        }
    }

    /**
     * Broadcasts the current list of connected peers to the mesh.
     */
    public exchangePeers() {
        if (!this.enablePEX) return;
        
        const peerList = Array.from(this.channelsByUserId.keys());
        if (peerList.length === 0) return;

        const msg: PeerMessage = {
            type: 'peer_list',
            path: '',
            senderId: this.peerId,
            peerList,
            msgId: this.generateMsgId()
        };
        this.broadcast(msg);
    }

    private markMessageAsSeen(msgId: string) {
        if (this.seenMessages.has(msgId)) return;
        this.seenMessages.add(msgId);
        this.seenMessagesQueue.push(msgId);
        if (this.seenMessagesQueue.length > this.maxSeenMessages) {
            const oldest = this.seenMessagesQueue.shift();
            if (oldest) this.seenMessages.delete(oldest);
        }
    }

    private generateMsgId(): string {
        return env.generateId(15) + Date.now().toString(36);
    }

    private getKey(path: string): string {
        return `${this.prefix}${path}`;
    }

    /**
     * Connects an RTCDataChannel (or any mock channel) to this adapter.
     * @param sendFn A function that sends a string message to the peer.
     * @param userId Optional: The user ID of the peer for direct signaling.
     * @returns The channel object and a receiver function.
     */
    public connectPeer(sendFn: (msg: string) => void, userId?: string): { channel: any, receive: (msg: string) => void } | null {
        if (this.channels.size >= this.maxPeers) {
            Logger.warn('WebRTC', `Peer ${this.peerId} reached maxPeers (${this.maxPeers}). Rejecting connection.`);
            return null;
        }
        const channel = { send: sendFn };
        this.channels.add(channel);
        if (userId) {
            this.channelsByUserId.set(userId, channel);
        }
        return {
            channel,
            receive: (msg: string) => this.handleMessage(msg, channel)
        };
    }

    /**
     * Connects a NativeWebRTCTransport directly to this adapter.
     */
    public connectNativeTransport(transport: NativeWebRTCTransport, userId?: string) {
        const conn = this.connectPeer((msg) => transport.send(msg), userId);
        if (conn) {
            transport.onMessage = (msg) => conn.receive(msg);
            transport.onDisconnected = () => this.disconnectPeer(conn.channel);
        }
    }

    /**
     * Disconnects a channel.
     */
    public disconnectPeer(channel: any) {
        this.channels.delete(channel);
        for (const [uid, ch] of this.channelsByUserId.entries()) {
            if (ch === channel) {
                this.channelsByUserId.delete(uid);
                break;
            }
        }
        Logger.debug('WebRTC', `Peer disconnected. Active channels: ${this.channels.size}`);
    }

    private async handleMessage(msgStr: string, sourceChannel: any) {
        try {
            const msg: PeerMessage = JSON.parse(msgStr);
            const key = msg.path;

            // 0. Security Verification
            if (this.verify && msg.signature && msg.signingPublicKey) {
                const messageToVerify = { ...msg };
                delete (messageToVerify as any).signature;
                const dataToVerify = new TextEncoder().encode(JSON.stringify(messageToVerify));
                const signature = Buffer.from(msg.signature, 'hex');
                
                // If msg.senderId matches we should verify against its public key
                // For now we trust msg.signingPublicKey if we don't have a better source
                // but ideally we should check against a known public key for that senderId.
                let knownPublicKey = msg.signingPublicKey;
                if (this.getPublicKey && msg.senderId) {
                    const fetched = await this.getPublicKey(msg.senderId);
                    if (fetched) knownPublicKey = fetched;
                }

                if (!this.verify(dataToVerify, signature, knownPublicKey)) {
                    Logger.warn('WebRTC', `Invalid signature from peer ${msg.senderId}. Dropping message.`);
                    return;
                }
            }

            // 1. Deduplication
            if (msg.msgId) {
                if (this.seenMessages.has(msg.msgId)) {
                    return;
                }
                this.markMessageAsSeen(msg.msgId);
            }

            // 2. Handle PEX Introductions (Signal Relay)
            if (msg.type === 'relay_signal') {
                if (msg.to === this.peerId) {
                    Logger.info('WebRTC', `Received relayed signal from ${msg.from}`);
                    this.onSignalRelay?.(msg.from!, msg.signal);
                } else {
                    // Forward if TTL allows
                    const ttl = msg.ttl ?? this.defaultTTL;
                    if (ttl > 1) {
                        const forwardMsg = { ...msg, ttl: ttl - 1 };
                        const targetChannel = this.channelsByUserId.get(msg.to!);
                        if (targetChannel) {
                            targetChannel.send(JSON.stringify(forwardMsg));
                        } else {
                            this.broadcast(forwardMsg, sourceChannel);
                        }
                    }
                }
                return;
            }

            // 3. Handle Peer List exchange
            if (msg.type === 'peer_list') {
                if (this.enablePEX && msg.peerList) {
                    this.emit('pex:peers', { from: msg.senderId, peers: msg.peerList });
                }
                return;
            }

            if (msg.type === 'push') {
                if (msg.data && msg.hash && msg.etag) {
                    const dataBuffer = Buffer.from(msg.data, 'base64');
                    const existing = this.cache.get(key);
                    // Extremely simplistic conflict resolution: if etag is different, accept it
                    if (!existing || existing.etag !== msg.etag) { 
                        this.cache.set(key, { data: new Uint8Array(dataBuffer), hash: msg.hash, etag: msg.etag });
                        Logger.debug('WebRTC', `Peer ${msg.senderId} pushed ${key}. Caching and forwarding.`);
                        
                        // Gossip: forward to others except sender, if TTL allows
                        const ttl = msg.ttl ?? this.defaultTTL;
                        if (ttl > 1) {
                            const forwardMsg: PeerMessage = {
                                ...msg,
                                ttl: ttl - 1
                            };
                            this.broadcast(forwardMsg, sourceChannel);
                        }
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
                } else if (this.storage) {
                    // SEEDING: Check local storage for the file
                    // We must strip our own prefix to find it in local storage
                    let storagePath = key;
                    if (this.prefix && key.startsWith(this.prefix)) {
                        storagePath = key.substring(this.prefix.length);
                    }

                    this.storage.getFile(storagePath).then((data: Uint8Array | null) => {
                        if (data) {
                            // Found in storage, serve it
                            // Calculate a basic etag if missing
                            const etag = `"${data.length}-${Date.now().toString(36)}"`;
                            const res: PeerMessage = {
                                type: 'response',
                                path: key,
                                hash: 'sha256-seeding', // We could calculate this but it's expensive
                                etag,
                                data: Buffer.from(data).toString('base64'),
                                reqId: msg.reqId,
                                senderId: this.peerId
                            };
                            sourceChannel.send(JSON.stringify(res));
                        } else {
                            // Truly not found
                            const res: PeerMessage = {
                                type: 'not_found',
                                path: key,
                                reqId: msg.reqId,
                                senderId: this.peerId
                            };
                            sourceChannel.send(JSON.stringify(res));
                        }
                    }).catch(() => {
                        const res: PeerMessage = {
                            type: 'not_found',
                            path: key,
                            reqId: msg.reqId,
                            senderId: this.peerId
                        };
                        sourceChannel.send(JSON.stringify(res));
                    });
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
            Logger.warn('WebRTC', `Failed to parse message: ${e.message}`);
        }
    }

    private broadcast(msg: PeerMessage, excludeChannel?: any) {
        if (this.sign && this.signingPublicKey) {
            msg.signingPublicKey = this.signingPublicKey;
            const dataToSign = new TextEncoder().encode(JSON.stringify(msg));
            msg.signature = Buffer.from(this.sign(dataToSign)).toString('hex');
        }

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

    async uploadFile(path: string, data: Uint8Array, hash?: string, metadata?: Record<string, string>): Promise<string | null> {
        const key = this.getKey(path);
        // Fallback hash if not provided
        const fileHash = hash || Buffer.from(data).toString('hex').substring(0, 16); 
        const etag = `"${Date.now().toString()}-${env.generateId(12)}"`;

        this.cache.set(key, { data, hash: fileHash, etag });

        const msg: PeerMessage = {
            type: 'push',
            path: key,
            hash: fileHash,
            etag,
            data: Buffer.from(data).toString('base64'),
            senderId: this.peerId,
            msgId: this.generateMsgId(),
            ttl: this.defaultTTL
        };
        
        this.markMessageAsSeen(msg.msgId!);
        Logger.debug('WebRTC', `Broadcasting push for ${key} (msgId: ${msg.msgId})`);
        this.broadcast(msg);
        return etag;
    }

    async getFileMetadata(path: string, key: string): Promise<string | null> {
        // Metadata not yet supported in P2P cache
        return null;
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

        Logger.debug('WebRTC', `Requesting ${key} from peers...`);
        return new Promise((resolve) => {
            const reqId = env.generateId(12);
            
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
                senderId: this.peerId,
                msgId: this.generateMsgId(),
                ttl: this.defaultTTL
            };
            this.markMessageAsSeen(reqMsg.msgId!);
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

    async canWrite(path: string): Promise<boolean> {
        // In P2P Mesh, 'write access' depends on if we have any authorized peers 
        // who would accept our push. For now we assume true if connected.
        return (this as any).channels.size > 0;
    }

    async listFiles(prefix: string): Promise<string[]> {
        // P2P Listing not yet implemented
        return [];
    }

    async deleteFile(path: string): Promise<void> {
        // P2P Deletion not yet implemented
    }
    }