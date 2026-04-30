
import { NativeWebRTCTransport } from '../src/adapters/NativeWebRTCTransport';
import { WebRTCRemoteAdapter } from '../src/adapters/WebRTCRemoteAdapter';

// Mock RTCPeerConnection
const mockDataChannel = {
    send: jest.fn(),
    close: jest.fn(),
    readyState: 'open',
    onopen: null,
    onmessage: null,
    onclose: null
};

(global as any).RTCPeerConnection = jest.fn().mockImplementation(() => ({
    createDataChannel: jest.fn().mockReturnValue(mockDataChannel),
    createOffer: jest.fn().mockResolvedValue({ sdp: 'v=0\r\ntest-offer', type: 'offer' }),
    createAnswer: jest.fn().mockResolvedValue({ sdp: 'v=0\r\ntest-answer', type: 'answer' }),
    setLocalDescription: jest.fn().mockResolvedValue(undefined),
    setRemoteDescription: jest.fn().mockResolvedValue(undefined),
    addIceCandidate: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    iceGatheringState: 'complete',
    localDescription: { sdp: 'v=0\r\ntest-sdp-complete' },
    onicecandidate: null,
    onconnectionstatechange: null,
    ondatachannel: null
}));

describe('Native WebRTC & PEX Logic', () => {
    it('should perform a manual handshake flow', async () => {
        const alice = new NativeWebRTCTransport('alice');
        const bob = new NativeWebRTCTransport('bob');

        // 1. Alice creates offer
        const offer = await alice.createOffer();
        expect(offer.type).toBe('offer');
        expect(offer.sdp).toContain('test-sdp-complete');

        // 2. Bob handles offer and creates answer
        const answer = await bob.handleOffer(offer.sdp!);
        expect(answer.type).toBe('answer');
        expect(answer.sdp).toContain('test-sdp-complete');

        // 3. Alice handles answer
        await alice.handleAnswer(answer.sdp!);
    });

    it('WebRTCRemoteAdapter should relay signals (PEX)', () => {
        const aliceAdapter = new WebRTCRemoteAdapter('alice');
        const bobAdapter = new WebRTCRemoteAdapter('bob');
        
        const mockSendToBob = jest.fn();
        aliceAdapter.connectPeer(mockSendToBob, 'bob');

        const signal = { type: 'offer', sdp: 'test' };
        aliceAdapter.relaySignal('charlie', signal);

        // Should broadcast because charlie is not a direct peer
        expect(mockSendToBob).toHaveBeenCalled();
        const sentMsg = JSON.parse(mockSendToBob.mock.calls[0][0]);
        expect(sentMsg.type).toBe('relay_signal');
        expect(sentMsg.to).toBe('charlie');
        expect(sentMsg.signal).toEqual(signal);
    });

    it('WebRTCRemoteAdapter should handle incoming relayed signals', (done) => {
        const charlieAdapter = new WebRTCRemoteAdapter('charlie');
        const signal = { type: 'offer', sdp: 'test' };

        charlieAdapter.onSignalRelay = (from, receivedSignal) => {
            expect(from).toBe('alice');
            expect(receivedSignal).toEqual(signal);
            done();
        };

        const incomingMsg = JSON.stringify({
            type: 'relay_signal',
            from: 'alice',
            to: 'charlie',
            signal: signal,
            senderId: 'bob'
        });

        // Simulate message from bob
        (charlieAdapter as any).handleMessage(incomingMsg, { send: jest.fn() });
    });
});
