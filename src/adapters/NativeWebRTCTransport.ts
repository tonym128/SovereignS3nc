
import { WebRTCSignalingData } from '../types';
import { Logger } from '../utils/Logger';

export class NativeWebRTCTransport {
    private pc: RTCPeerConnection;
    private dc: RTCDataChannel | null = null;
    private isInitiator: boolean = false;

    public onSignalingData?: (data: WebRTCSignalingData) => void;
    public onConnected?: () => void;
    public onMessage?: (msg: string) => void;
    public onDisconnected?: () => void;

    constructor(private userId: string, iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]) {
        this.pc = new RTCPeerConnection({ iceServers });
        this.setupPeerConnection();
    }

    private setupPeerConnection() {
        this.pc.onicecandidate = (event) => {
            if (event.candidate && this.onSignalingData) {
                this.onSignalingData({
                    type: 'candidate',
                    candidate: event.candidate.toJSON(),
                    senderId: this.userId
                });
            }
        };

        this.pc.onconnectionstatechange = () => {
            Logger.debug(`[NativeWebRTC] Connection state: ${this.pc.connectionState}`);
            if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
                this.onDisconnected?.();
            }
        };

        this.pc.ondatachannel = (event) => {
            Logger.debug('[NativeWebRTC] Received remote data channel');
            this.setupDataChannel(event.channel);
        };
    }

    private setupDataChannel(channel: RTCDataChannel) {
        this.dc = channel;
        this.dc.onopen = () => {
            Logger.info('[NativeWebRTC] Data channel OPEN');
            this.onConnected?.();
        };
        this.dc.onmessage = (event) => {
            this.onMessage?.(event.data);
        };
        this.dc.onclose = () => {
            Logger.info('[NativeWebRTC] Data channel CLOSED');
            this.onDisconnected?.();
        };
    }

    /**
     * Start the connection process as the initiator (e.g. show QR code).
     */
    public async createOffer(): Promise<WebRTCSignalingData> {
        this.isInitiator = true;
        const channel = this.pc.createDataChannel('sovereign-sync');
        this.setupDataChannel(channel);

        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);

        return {
            type: 'offer',
            sdp: offer.sdp,
            senderId: this.userId
        };
    }

    /**
     * Respond to an offer as the receiver.
     */
    public async handleOffer(offerSdp: string): Promise<WebRTCSignalingData> {
        this.isInitiator = false;
        await this.pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
        
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);

        return {
            type: 'answer',
            sdp: answer.sdp,
            senderId: this.userId
        };
    }

    /**
     * Handle the answer from the receiver (Initiator only).
     */
    public async handleAnswer(answerSdp: string) {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    }

    /**
     * Handle incoming ICE candidates from the peer.
     */
    public async handleCandidate(candidate: RTCIceCandidateInit) {
        try {
            await this.pc.addIceCandidate(candidate);
        } catch (e: any) {
            Logger.warn('[NativeWebRTC] Failed to add ICE candidate', e);
        }
    }

    /**
     * Send data over the data channel.
     */
    public send(msg: string) {
        if (this.dc && this.dc.readyState === 'open') {
            this.dc.send(msg);
        } else {
            Logger.warn('[NativeWebRTC] Attempted to send message but data channel is not open');
        }
    }

    public close() {
        this.dc?.close();
        this.pc.close();
    }
}
