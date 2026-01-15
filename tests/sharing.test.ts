import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';

// Mock the S3RemoteAdapter
jest.mock('../src/adapters/S3RemoteAdapter');

describe('SovereignS3nc Sharing', () => {
  let db: SovereignS3nc;
  let mockRemote: any;
  let mockSharedRemote: any;

  beforeEach(async () => {
    // Clear all mocks
    (S3RemoteAdapter as any).mockClear();

    // Setup default mock implementation
    (S3RemoteAdapter.prototype as any).put = jest.fn().mockResolvedValue('etag-123');
    (S3RemoteAdapter.prototype as any).get = jest.fn().mockResolvedValue(null);
    (S3RemoteAdapter.prototype as any).listChanges = jest.fn().mockResolvedValue([]);
    (S3RemoteAdapter.prototype as any).delete = jest.fn().mockResolvedValue(undefined);

    db = new SovereignS3nc({
      s3: {
        region: 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        bucketName: 'test-bucket'
      },
      paths: { appId: 'app', userId: 'user', storeId: 'store' },
      syncIntervalMs: 0 // manual sync for tests
    });

    await db.init();

    // S3RemoteAdapter is instantiated twice in constructor.
    // 1st: this.remote
    // 2nd: this.sharedRemote
    const mockInstances = (S3RemoteAdapter as any).mock.instances;
    mockRemote = mockInstances[0];
    mockSharedRemote = mockInstances[1];
  });

  test('should share a document', async () => {
    const id = await db.save({ name: 'shared item' });
    
    // Check initial save didn't touch shared remote
    expect(mockSharedRemote.put).not.toHaveBeenCalled();

    // Share it
    const sharedId = await db.share(id);
    
    expect(sharedId).toBeDefined();
    // Check shared remote was updated
    expect(mockSharedRemote.put).toHaveBeenCalledTimes(1);
    const putCall = mockSharedRemote.put.mock.calls[0][0];
    expect(putCall._id).toBe(sharedId);
    expect(putCall.data).toEqual({ name: 'shared item' });

    // Check mapping persistence
    // We can't access private members easily, but we can verify it's persisted by checking internal storage calls if we mocked it, 
    // or just rely on behavior.
    // But we know 'share' saves '_sovereign_shares'.
    // Let's verify by creating a new instance (simulating restart) and sharing same doc
    // It should return same sharedId.

    const db2 = new SovereignS3nc({
      s3: {
        region: 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        bucketName: 'test-bucket'
      },
      paths: { appId: 'app', userId: 'user', storeId: 'store' },
      localPersistencePath: db['config'].localPersistencePath // share the same memory store? No, InMemory is per instance unless passed.
    }, db['localStore']); // Pass the same local store

    await db2.init();
    const sharedId2 = await db2.share(id);
    expect(sharedId2).toBe(sharedId);
  });

  test('should update shared copy when original changes', async () => {
    const id = await db.save({ name: 'v1' });
    await db.share(id);
    mockSharedRemote.put.mockClear();

    // Update original
    await db.save({ _id: id, name: 'v2' });

    // Shared remote should be updated
    expect(mockSharedRemote.put).toHaveBeenCalledTimes(1);
    const putCall = mockSharedRemote.put.mock.calls[0][0];
    expect(putCall.data).toEqual({ _id: id, name: 'v2' });
  });

  test('should unshare a document', async () => {
    const id = await db.save({ name: 'to unshare' });
    const sharedId = await db.share(id);
    mockSharedRemote.put.mockClear();

    await db.unshare(id);

    // Shared remote delete should be called
    expect(mockSharedRemote.delete).toHaveBeenCalledWith(sharedId);

    // Update original -> should NOT update shared
    mockSharedRemote.put.mockClear();
    await db.save({ _id: id, name: 'v2' });
    expect(mockSharedRemote.put).not.toHaveBeenCalled();
  });
});
