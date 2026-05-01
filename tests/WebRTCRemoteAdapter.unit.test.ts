import { WebRTCRemoteAdapter } from '../src/adapters/WebRTCRemoteAdapter';

describe('WebRTCRemoteAdapter Unit Tests', () => {
    let peerA: WebRTCRemoteAdapter;
    let peerB: WebRTCRemoteAdapter;

    beforeEach(() => {
        peerA = new WebRTCRemoteAdapter('peerA');
        peerB = new WebRTCRemoteAdapter('peerB');

        // Mock WebRTC DataChannel connection
        const connAtoB = peerA.connectPeer((msg) => connBtoA!.receive(msg));
        const connBtoA = peerB.connectPeer((msg) => connAtoB!.receive(msg));
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
        const peerC = new WebRTCRemoteAdapter('peerC');
        const data = new Uint8Array([4, 5, 6]);
        await peerA.uploadFile('late/file.txt', data);

        // Connect peer C to A
        const connAtoC = peerA.connectPeer((msg) => connCtoA!.receive(msg));
        const connCtoA = peerC.connectPeer((msg) => connAtoC!.receive(msg));

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
        const bFile = await peerB.downloadFile('etag/file.txt', etag!);
        expect(bFile?.notModified).toBe(true);
        expect(bFile?.data).toBeNull();
    });

    test('should serve file from storage if not in memory cache (seeding)', async () => {
        const data = new Uint8Array([10, 11, 12]);
        const path = 'stored/file.txt';
        
        // Mock storage for peerA
        const mockStorage = {
            getFile: jest.fn().mockResolvedValue(data)
        };
        peerA.storage = mockStorage;

        // PeerB requests file from PeerA (A doesn't have it in memory cache)
        const result = await peerB.downloadFile(path);
        
        expect(mockStorage.getFile).toHaveBeenCalledWith(path);
        expect(result?.data).toEqual(data);
        expect(result?.etag).toBeDefined();
    });

    test('should strip prefix when serving from storage', async () => {
        const data = new Uint8Array([20, 21, 22]);
        const prefix = 'app/user/store/';
        const relativePath = 'public/data.json';
        const fullPath = prefix + relativePath;

        peerA = new WebRTCRemoteAdapter('peerA', prefix);
        // Re-establish connection since we replaced peerA
        const connAtoB = peerA.connectPeer((msg) => connBtoA!.receive(msg));
        const connBtoA = peerB.connectPeer((msg) => connAtoB!.receive(msg));

        const mockStorage = {
            getFile: jest.fn().mockResolvedValue(data)
        };
        peerA.storage = mockStorage;

        // PeerB requests using full path
        const result = await peerB.downloadFile(fullPath);

        // PeerA should have looked up the relative path in storage
        expect(mockStorage.getFile).toHaveBeenCalledWith(relativePath);
        expect(result?.data).toEqual(data);
    });
});
