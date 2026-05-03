
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

    constructor(private userId: string, iceServers: RTCIceServer[] = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // OpenRelay Public TURN servers (Free)
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]) {
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
            Logger.debug('WebRTC', `Connection state: ${this.pc.connectionState}`);
            if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
                this.onDisconnected?.();
            }
        };

        this.pc.ondatachannel = (event) => {
            Logger.debug('WebRTC', 'Received remote data channel');
            this.setupDataChannel(event.channel);
        };
    }

    private setupDataChannel(channel: RTCDataChannel) {
        this.dc = channel;
        this.dc.onopen = () => {
            Logger.info('WebRTC', 'Data channel OPEN');
            this.onConnected?.();
        };
        this.dc.onmessage = (event) => {
            this.onMessage?.(event.data);
        };
        this.dc.onclose = () => {
            Logger.info('WebRTC', 'Data channel CLOSED');
            this.onDisconnected?.();
        };
    }

    /**
     * Helper to wait for ICE gathering to complete.
     * This is required for "Vanilla ICE" (manual SDP exchange via QR/BLE) 
     * where there is no back-channel for trickle ICE candidates.
     */
    private waitForIceGathering(): Promise<void> {
        return new Promise((resolve) => {
            if (this.pc.iceGatheringState === 'complete') {
                resolve();
            } else {
                const checkState = () => {
                    if (this.pc.iceGatheringState === 'complete') {
                        this.pc.removeEventListener('icegatheringstatechange', checkState);
                        resolve();
                    }
                };
                this.pc.addEventListener('icegatheringstatechange', checkState);
                
                // End-of-candidates candidate also signals completion
                const onCandidate = (event: RTCPeerConnectionIceEvent) => {
                    if (!event.candidate) {
                        this.pc.removeEventListener('icecandidate', onCandidate);
                        resolve();
                    }
                };
                this.pc.addEventListener('icecandidate', onCandidate);

                // Safety timeout: 5 seconds is usually enough for local/STUN gathering
                setTimeout(() => {
                    this.pc.removeEventListener('icegatheringstatechange', checkState);
                    resolve();
                }, 5000);
            }
        });
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

        Logger.debug('WebRTC', 'Waiting for ICE gathering...');
        await this.waitForIceGathering();

        return {
            type: 'offer',
            sdp: this.pc.localDescription?.sdp || offer.sdp,
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

        Logger.debug('WebRTC', 'Waiting for ICE gathering...');
        await this.waitForIceGathering();

        return {
            type: 'answer',
            sdp: this.pc.localDescription?.sdp || answer.sdp,
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
            Logger.warn('WebRTC', 'Failed to add ICE candidate', e);
        }
    }

    /**
     * Send data over the data channel.
     */
    public send(msg: string) {
        if (this.dc && this.dc.readyState === 'open') {
            this.dc.send(msg);
        } else {
            Logger.warn('WebRTC', 'Attempted to send message but data channel is not open');
        }
    }

    public close() {
        this.dc?.close();
        this.pc.close();
    }
}
