"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const WebRTCRemoteAdapter_1 = require("../src/adapters/WebRTCRemoteAdapter");
describe('WebRTCRemoteAdapter Unit Tests', () => {
    let peerA;
    let peerB;
    beforeEach(() => {
        peerA = new WebRTCRemoteAdapter_1.WebRTCRemoteAdapter('peerA');
        peerB = new WebRTCRemoteAdapter_1.WebRTCRemoteAdapter('peerB');
        // Mock WebRTC DataChannel connection
        const connAtoB = peerA.connectPeer((msg) => connBtoA.receive(msg));
        const connBtoA = peerB.connectPeer((msg) => connAtoB.receive(msg));
    });
    test('should upload file and push to connected peers via gossip', async () => {
        const data = new Uint8Array([1, 2, 3]);
        await peerA.uploadFile('test/file.txt', data);
        // peerB should have it in its cache now via gossip
        const bHash = await peerB.getFileHash('test/file.txt');
        expect(bHash).toBeDefined();
        const bFile = await peerB.downloadFile('test/file.txt');
        expect(bFile?.data).toEqual(data);
    });
    test('should request file from peer if not in cache (late joiner)', async () => {
        // We upload to peerA, then connect peerC
        const peerC = new WebRTCRemoteAdapter_1.WebRTCRemoteAdapter('peerC');
        const data = new Uint8Array([4, 5, 6]);
        await peerA.uploadFile('late/file.txt', data);
        // Connect peer C to A
        const connAtoC = peerA.connectPeer((msg) => connCtoA.receive(msg));
        const connCtoA = peerC.connectPeer((msg) => connAtoC.receive(msg));
        // Now C requests it
        const cFile = await peerC.downloadFile('late/file.txt');
        expect(cFile?.data).toEqual(data);
    });
    test('should return null if file not found in mesh', async () => {
        const file = await peerB.downloadFile('missing/file.txt', undefined, 100); // short timeout
        expect(file).toBeNull();
    });
    test('should respect ifNoneMatch parameter', async () => {
        const data = new Uint8Array([7, 8, 9]);
        const etag = await peerA.uploadFile('etag/file.txt', data);
        // B has it in cache via gossip
        const bFile = await peerB.downloadFile('etag/file.txt', etag);
        expect(bFile?.notModified).toBe(true);
        expect(bFile?.data).toBeNull();
    });
});
//# sourceMappingURL=WebRTCRemoteAdapter.unit.test.js.map