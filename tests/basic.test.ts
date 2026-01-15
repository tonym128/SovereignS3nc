import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';
import { SyncDocument } from '../src/types';

// Mock the S3RemoteAdapter
jest.mock('../src/adapters/S3RemoteAdapter');

describe('SovereignS3nc', () => {
  let db: SovereignS3nc;
  const mockS3Adapter = S3RemoteAdapter as unknown as jest.Mocked<S3RemoteAdapter>;

  beforeEach(() => {
    // Clear all mocks
    (S3RemoteAdapter as any).mockClear();

    // Setup default mock implementation
    S3RemoteAdapter.prototype.put = jest.fn().mockResolvedValue(undefined);
    S3RemoteAdapter.prototype.get = jest.fn().mockResolvedValue(null);
    S3RemoteAdapter.prototype.listChanges = jest.fn().mockResolvedValue([]);
    S3RemoteAdapter.prototype.delete = jest.fn().mockResolvedValue(undefined);

    db = new SovereignS3nc({
      s3: {
        region: 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        bucketName: 'test-bucket'
      },
      syncIntervalMs: 0 // manual sync for tests
    });
  });

  test('should save a document locally', async () => {
    await db.init();
    const id = await db.save({ name: 'test item' });
    
    const doc = await db.get<{ name: string }>(id);
    expect(doc).toBeDefined();
    expect(doc?.name).toBe('test item');
  });

  test('should sync local changes to remote', async () => {
    await db.init();
    await db.save({ name: 'sync me' });
    
    // Trigger sync
    const stats = await db.sync();
    
    expect(stats.pushed).toBe(1);
    expect(S3RemoteAdapter.prototype.put).toHaveBeenCalledTimes(1);
  });

  test('should pull remote changes', async () => {
    await db.init();
    
    // Mock remote having a new file
    const remoteDoc: SyncDocument = {
      _id: 'remote-id',
      _updatedAt: Date.now() + 1000,
      data: { name: 'from cloud' }
    };

    (S3RemoteAdapter.prototype.listChanges as jest.Mock).mockResolvedValue([
      { key: 'docs/remote-id.json', etag: 'abc', lastModified: new Date() }
    ]);
    (S3RemoteAdapter.prototype.get as jest.Mock).mockResolvedValue(remoteDoc);

    const stats = await db.sync();
    
    expect(stats.pulled).toBe(1);
    
    const localDoc = await db.get<{ name: string }>('remote-id');
    expect(localDoc).toBeDefined();
    expect(localDoc?.name).toBe('from cloud');
  });
});