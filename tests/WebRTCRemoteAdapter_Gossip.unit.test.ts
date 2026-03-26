import { WebRTCRemoteAdapter } from '../src/adapters/WebRTCRemoteAdapter';

describe('WebRTCRemoteAdapter Gossip Scaling and Safety', () => {
    
    test('should enforce maxPeers limit', () => {
        const peer = new WebRTCRemoteAdapter('main', '', { maxPeers: 3 });
        
        const conn1 = peer.connectPeer((msg) => {});
        const conn2 = peer.connectPeer((msg) => {});
        const conn3 = peer.connectPeer((msg) => {});
        const conn4 = peer.connectPeer((msg) => {});

        expect(conn1).not.toBeNull();
        expect(conn2).not.toBeNull();
        expect(conn3).not.toBeNull();
        expect(conn4).toBeNull();
    });

    test('should respect TTL (hop limit)', async () => {
        // Chain: A -> B -> C -> D
        const peerA = new WebRTCRemoteAdapter('A', '', { ttl: 2 });
        const peerB = new WebRTCRemoteAdapter('B', '', { ttl: 2 });
        const peerC = new WebRTCRemoteAdapter('C', '', { ttl: 2 });
        const peerD = new WebRTCRemoteAdapter('D', '', { ttl: 2 });

        const connAB = peerA.connectPeer((msg) => connBA!.receive(msg));
        const connBA = peerB.connectPeer((msg) => connAB!.receive(msg));

        const connBC = peerB.connectPeer((msg) => connCB!.receive(msg));
        const connCB = peerC.connectPeer((msg) => connBC!.receive(msg));

        const connCD = peerC.connectPeer((msg) => connDC!.receive(msg));
        const connDC = peerD.connectPeer((msg) => connCD!.receive(msg));

        const data = new Uint8Array([1, 2, 3]);
        await peerA.uploadFile('test.txt', data);

        // A (hop 0) -> B (hop 1) -> C (hop 2) -> D (hop 3)
        // With TTL=2:
        // A sends with TTL=2.
        // B receives, decrements to 1, forwards.
        // C receives, decrements to 0, does NOT forward.
        // D should NOT receive it.

        const bHash = await peerB.getFileHash('test.txt');
        const cHash = await peerC.getFileHash('test.txt');
        const dHash = await peerD.getFileHash('test.txt');

        expect(bHash).toBeDefined();
        expect(cHash).toBeDefined();
        expect(dHash).toBeNull();
    });

    test('should deduplicate messages using msgId', async () => {
        // Loop: A -> B -> C -> A
        const peerA = new WebRTCRemoteAdapter('A');
        const peerB = new WebRTCRemoteAdapter('B');
        const peerC = new WebRTCRemoteAdapter('C');

        let aReceiveCount = 0;
        const originalHandleMessage = (peerA as any).handleMessage.bind(peerA);
        (peerA as any).handleMessage = (msgStr: string, source: any) => {
            aReceiveCount++;
            return originalHandleMessage(msgStr, source);
        };

        const connAB = peerA.connectPeer((msg) => connBA!.receive(msg));
        const connBA = peerB.connectPeer((msg) => connAB!.receive(msg));

        const connBC = peerB.connectPeer((msg) => connCB!.receive(msg));
        const connCB = peerC.connectPeer((msg) => connBC!.receive(msg));

        const connCA = peerC.connectPeer((msg) => connAC!.receive(msg));
        const connAC = peerA.connectPeer((msg) => connCA!.receive(msg));

        const data = new Uint8Array([1, 2, 3]);
        await peerA.uploadFile('loop.txt', data);

        // A sends to B.
        // B sends to C.
        // C sends back to A.
        // A should receive it once but NOT forward it again because it's already seen.
        
        // Wait a bit for gossip to settle (though it's synchronous in this mock)
        
        // Peer A sent it, so it marked it as seen.
        // When it comes back from C, A sees it's already seen and ignores it.
        // aReceiveCount should be 1 (the one coming back from C).
        // If there was no deduplication, it would loop forever (or until TTL).
        
        expect(aReceiveCount).toBe(1);
        
        const bHash = await peerB.getFileHash('loop.txt');
        const cHash = await peerC.getFileHash('loop.txt');
        expect(bHash).toBeDefined();
        expect(cHash).toBeDefined();
    });
});
