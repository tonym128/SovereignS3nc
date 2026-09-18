import { WebRTCRemoteAdapter } from '../src/adapters/WebRTCRemoteAdapter';

/**
 * ChaosChannel simulates realistic P2P network conditions including:
 * - Configurable packet drop rate (0.0 to 1.0)
 * - Base transport latency (ms)
 * - Jitter (random additional latency)
 * - Network partitioning / disconnection
 */
class ChaosChannel {
    public dropRate: number = 0;
    public latencyMs: number = 0;
    public jitterMs: number = 0;
    public isPartitioned: boolean = false;
    public sentCount: number = 0;
    public droppedCount: number = 0;
    public deliveredCount: number = 0;

    constructor(private deliverFn: (msg: string) => void) {}

    send(msg: string) {
        this.sentCount++;
        if (this.isPartitioned || (this.dropRate > 0 && Math.random() < this.dropRate)) {
            this.droppedCount++;
            return; // Dropped packet
        }

        const delay = this.latencyMs + (this.jitterMs > 0 ? Math.floor(Math.random() * this.jitterMs) : 0);
        if (delay <= 0) {
            this.deliveredCount++;
            this.deliverFn(msg);
        } else {
            setTimeout(() => {
                this.deliveredCount++;
                this.deliverFn(msg);
            }, delay);
        }
    }
}

describe('WebRTC Chaos & Network Degradation Integration Tests', () => {

    afterEach(() => {
        jest.clearAllTimers();
    });

    test('recovers from packet drops without deadlocking via retries', async () => {
        const peerA = new WebRTCRemoteAdapter('alice', '', { downloadRetries: 3 });
        const peerB = new WebRTCRemoteAdapter('bob', '', { downloadRetries: 3 });

        // Save a test file on peer B's cache
        const testData = new Uint8Array([10, 20, 30, 40, 50]);
        await peerB.uploadFile('documents/report.pdf', testData);

        // Connect A and B via ChaosChannel with 40% packet drop rate
        let connABReceiver: (msg: string) => void = () => {};
        let connBAReceiver: (msg: string) => void = () => {};

        const chaosAB = new ChaosChannel((msg) => connBAReceiver(msg));
        chaosAB.dropRate = 0.4; // 40% drops
        chaosAB.latencyMs = 5;

        const chaosBA = new ChaosChannel((msg) => connABReceiver(msg));
        chaosBA.dropRate = 0.4;
        chaosBA.latencyMs = 5;

        const connA = peerA.connectPeer((msg) => chaosAB.send(msg), 'bob');
        const connB = peerB.connectPeer((msg) => chaosBA.send(msg), 'alice');

        connABReceiver = connA!.receive;
        connBAReceiver = connB!.receive;

        // Download file from Peer A with timeout of 100ms and 5 retries
        const result = await peerA.downloadFile('documents/report.pdf', undefined, 100, 5);

        // Peer A should successfully retrieve the file despite packet loss
        expect(result).not.toBeNull();
        expect(result!.data).toEqual(testData);
        expect(chaosAB.sentCount).toBeGreaterThanOrEqual(1);

        peerA.clearAllReconnectTimers();
        peerB.clearAllReconnectTimers();
    });

    test('times out cleanly without deadlock when network is 100% partitioned', async () => {
        const peerA = new WebRTCRemoteAdapter('alice');
        const peerB = new WebRTCRemoteAdapter('bob');

        let connBAReceiver: (msg: string) => void = () => {};
        const chaosAB = new ChaosChannel((msg) => connBAReceiver(msg));
        chaosAB.isPartitioned = true; // 100% blackhole

        const connA = peerA.connectPeer((msg) => chaosAB.send(msg), 'bob');
        const connB = peerB.connectPeer((msg) => {}, 'alice');
        connBAReceiver = connB!.receive;

        const startTime = Date.now();
        // Request with small timeout and 0 retries
        const result = await peerA.downloadFile('missing.txt', undefined, 150, 0);
        const elapsed = Date.now() - startTime;

        expect(result).toBeNull();
        expect(elapsed).toBeGreaterThanOrEqual(140);
        expect(chaosAB.droppedCount).toBeGreaterThanOrEqual(1);

        peerA.clearAllReconnectTimers();
        peerB.clearAllReconnectTimers();
    });

    test('reconnect exponential backoff prevents CPU spikes when peer channels churn repeatedly', async () => {
        const peerA = new WebRTCRemoteAdapter('alice', '', {
            reconnectBackoffBaseMs: 30,
            maxReconnectBackoffMs: 500
        });

        let reconnectAttempts = 0;
        const recordedDelays: number[] = [];

        peerA.on('reconnect:scheduled', (data: { userId: string, attempt: number, delayMs: number }) => {
            recordedDelays.push(data.delayMs);
        });

        peerA.registerReconnectHandler('bob', async () => {
            reconnectAttempts++;
            // Fail first 3 reconnect attempts, succeed on 4th
            if (reconnectAttempts < 4) {
                return false;
            }
            return true;
        });

        // Trigger disconnection
        const mockChannel = { send: jest.fn() };
        const conn = peerA.connectPeer(mockChannel.send, 'bob');
        peerA.disconnectPeer(conn!.channel);

        // Wait for reconnect backoff progression (30ms -> 60ms -> 120ms -> 240ms)
        await new Promise(r => setTimeout(r, 600));

        // Reconnect attempts should have progressed with doubling backoff delays
        expect(reconnectAttempts).toBeGreaterThanOrEqual(3);
        expect(recordedDelays.length).toBeGreaterThanOrEqual(3);

        // Verify exponential growth of backoff delays: delay[i] >= delay[i-1] * 2
        for (let i = 1; i < recordedDelays.length; i++) {
            expect(recordedDelays[i]).toBeGreaterThanOrEqual(recordedDelays[i - 1] * 1.8);
        }

        // After success, backoff should be reset
        expect(peerA.getReconnectAttempts('bob')).toBe(0);

        peerA.clearAllReconnectTimers();
    });

    test('gossip loop termination: hop limit (TTL) drops messages and prevents infinite relay', async () => {
        // Topology: Node 1 -> Node 2 -> Node 3 -> Node 4 with TTL = 2
        const node1 = new WebRTCRemoteAdapter('n1', '', { ttl: 2 });
        const node2 = new WebRTCRemoteAdapter('n2', '', { ttl: 2 });
        const node3 = new WebRTCRemoteAdapter('n3', '', { ttl: 2 });
        const node4 = new WebRTCRemoteAdapter('n4', '', { ttl: 2 });

        const c12 = node1.connectPeer((m) => c21!.receive(m));
        const c21 = node2.connectPeer((m) => c12!.receive(m));

        const c23 = node2.connectPeer((m) => c32!.receive(m));
        const c32 = node3.connectPeer((m) => c23!.receive(m));

        const c34 = node3.connectPeer((m) => c43!.receive(m));
        const c43 = node4.connectPeer((m) => c34!.receive(m));

        const testData = new Uint8Array([1, 1, 1]);
        await node1.uploadFile('ttl-test.bin', testData);

        // Node 1 uploads (TTL=2) -> Node 2 receives (TTL=1) -> Node 3 receives (TTL=0, do NOT forward) -> Node 4 does not receive
        expect(await node2.getFileHash('ttl-test.bin')).not.toBeNull();
        expect(await node3.getFileHash('ttl-test.bin')).not.toBeNull();
        expect(await node4.getFileHash('ttl-test.bin')).toBeNull();

        node1.clearAllReconnectTimers();
        node2.clearAllReconnectTimers();
        node3.clearAllReconnectTimers();
        node4.clearAllReconnectTimers();
    });

    test('gossip loop termination: stale messages (>30s) are dropped immediately', async () => {
        const peer = new WebRTCRemoteAdapter('test-peer');
        let received = false;

        const conn = peer.connectPeer((msg) => {});

        // Construct a message older than MSG_MAX_AGE_MS (35 seconds old)
        const staleMessage = JSON.stringify({
            type: 'push',
            path: 'stale.txt',
            hash: 'deadbeef',
            etag: '"stale-etag"',
            data: Buffer.from('stale data').toString('base64'),
            senderId: 'remote-peer',
            msgId: 'stale-msg-id-123',
            timestamp: Date.now() - 35000 // 35 seconds ago (> 30s limit)
        });

        await conn!.receive(staleMessage);

        // Stale message must NOT be stored in cache
        const hash = await peer.getFileHash('stale.txt');
        expect(hash).toBeNull();

        peer.clearAllReconnectTimers();
    });

    test('gossip loop termination: circular mesh terminates without broadcast explosion', async () => {
        // Circular topology: Node A -> Node B -> Node C -> Node A
        const peerA = new WebRTCRemoteAdapter('A', '', { ttl: 5 });
        const peerB = new WebRTCRemoteAdapter('B', '', { ttl: 5 });
        const peerC = new WebRTCRemoteAdapter('C', '', { ttl: 5 });

        let bSends = 0;
        let cSends = 0;
        let aSends = 0;

        const connAB = peerA.connectPeer((msg) => { aSends++; connBA!.receive(msg); });
        const connBA = peerB.connectPeer((msg) => { bSends++; connAB!.receive(msg); });

        const connBC = peerB.connectPeer((msg) => { bSends++; connCB!.receive(msg); });
        const connCB = peerC.connectPeer((msg) => { cSends++; connBC!.receive(msg); });

        const connCA = peerC.connectPeer((msg) => { cSends++; connAC!.receive(msg); });
        const connAC = peerA.connectPeer((msg) => { aSends++; connCA!.receive(msg); });

        const data = new Uint8Array([7, 8, 9]);
        await peerA.uploadFile('cyclic-test.dat', data);

        // All peers should have received the file
        expect(await peerB.getFileHash('cyclic-test.dat')).not.toBeNull();
        expect(await peerC.getFileHash('cyclic-test.dat')).not.toBeNull();

        // Total messages sent across all channels should be bounded (<= 10) rather than exploding
        expect(aSends + bSends + cSends).toBeLessThanOrEqual(10);

        peerA.clearAllReconnectTimers();
        peerB.clearAllReconnectTimers();
        peerC.clearAllReconnectTimers();
    });
});
