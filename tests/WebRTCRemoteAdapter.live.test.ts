import { WebRTCRemoteAdapter } from '../src/adapters/WebRTCRemoteAdapter';
import { Peer } from 'peerjs';
import * as crypto from 'crypto';

// --- Polyfills for Node Environment ---
if (!(globalThis as any).crypto) {
    Object.defineProperty(globalThis, 'crypto', {
        value: crypto.webcrypto,
        writable: true,
        configurable: true
    });
}

describe('WebRTCRemoteAdapter Live Integration (WT-19)', () => {
    let peerA: Peer;
    let peerB: Peer;
    let adapterA: WebRTCRemoteAdapter;
    let adapterB: WebRTCRemoteAdapter;

    beforeAll((done) => {
        // Peer A setup
        peerA = new Peer('peer-a', { host: 'localhost', port: 9001, path: '/' });
        adapterA = new WebRTCRemoteAdapter('peer-a', 'app/alice');

        // Peer B setup
        peerB = new Peer('peer-b', { host: 'localhost', port: 9001, path: '/' });
        adapterB = new WebRTCRemoteAdapter('peer-b', 'app/alice');

        // Bridge Peer A to Peer B when they connect
        peerA.on('connection', (conn) => {
            const bridge = adapterA.connectPeer((msg) => conn.send(msg));
            conn.on('data', (data: any) => bridge?.receive(data as string));
        });

        peerB.on('connection', (conn) => {
            const bridge = adapterB.connectPeer((msg) => conn.send(msg));
            conn.on('data', (data: any) => bridge?.receive(data as string));
        });

        // Ensure peers are open
        let openCount = 0;
        const checkDone = () => {
            openCount++;
            if (openCount === 2) done();
        };
        peerA.on('open', checkDone);
        peerB.on('open', checkDone);
    }, 10000);

    afterAll(() => {
        peerA.destroy();
        peerB.destroy();
    });

    it('should synchronize data between Peer A and Peer B via P2P Gossip', (done) => {
        const testPath = 'test-file.txt';
        const testData = new TextEncoder().encode('Hello WebRTC Gossip!');
        const testHash = crypto.createHash('sha256').update(testData).digest('hex');

        // Peer A uploads a file to its local adapter cache
        adapterA.uploadFile(testPath, testData, testHash);

        // Peer B should eventually be able to download it
        // We need to trigger the connection manually or wait for gossip
        const conn = peerB.connect('peer-a');
        conn.on('open', async () => {
            const bridge = adapterB.connectPeer((msg) => conn.send(msg));
            conn.on('data', (data: any) => bridge?.receive(data as string));

            // Wait for gossip to propagate or request the file
            // Gossip in WebRTCRemoteAdapter happens during upload or periodically.
            // Let's try to download from Peer B.
            setTimeout(async () => {
                const result = await adapterB.downloadFile(testPath);
                expect(result).not.toBeNull();
                if (result && result.data) {
                    expect(new TextDecoder().decode(result.data)).toBe('Hello WebRTC Gossip!');
                    done();
                } else {
                    done('Download result was null or had no data');
                }
            }, 1000);
        });
    }, 15000);
});
