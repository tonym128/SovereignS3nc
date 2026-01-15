import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';
import { SyncDocument } from '../src/types';

jest.mock('../src/adapters/S3RemoteAdapter');

describe('SovereignS3nc ETag Optimization', () => {
  let db: SovereignS3nc;
  const mockS3Adapter = S3RemoteAdapter as jest.MockedClass<typeof S3RemoteAdapter>;

  beforeEach(() => {
    mockS3Adapter.mockClear();
    mockS3Adapter.prototype.put = jest.fn().mockResolvedValue('new-etag');
    mockS3Adapter.prototype.get = jest.fn().mockResolvedValue(null);
    mockS3Adapter.prototype.listChanges = jest.fn().mockResolvedValue([]);
    
    db = new SovereignS3nc({
      s3: { region: 'test', credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, bucketName: 'bucket' },
      syncIntervalMs: 0
    });
  });

  test('should skip download if local ETag matches remote ETag', async () => {
    await db.init();
    
    // 1. Setup local doc with ETag
    const docId = 'doc-etag';
    const localDoc: SyncDocument = {
      _id: docId,
      _updatedAt: 1000,
      _etag: 'hash-123',
      data: { val: 1 }
    };
    await (db as any).localStore.put(localDoc);

    // 2. Mock remote listing returning SAME ETag
    mockS3Adapter.prototype.listChanges.mockResolvedValue([{
      key: `docs/${docId}.json`,
      etag: 'hash-123',
      lastModified: new Date(2000)
    }]);

    await db.sync();

    // Verify: get() should NOT be called
    expect(mockS3Adapter.prototype.get).not.toHaveBeenCalled();
  });

  test('should download if local ETag differs', async () => {
    await db.init();
    
    const docId = 'doc-diff';
    const localDoc: SyncDocument = {
      _id: docId,
      _updatedAt: 1000,
      _etag: 'old-hash',
      data: { val: 1 }
    };
    await (db as any).localStore.put(localDoc);

    // Remote has DIFFERENT ETag
    mockS3Adapter.prototype.listChanges.mockResolvedValue([{
      key: `docs/${docId}.json`,
      etag: 'new-hash',
      lastModified: new Date(2000)
    }]);

    mockS3Adapter.prototype.get.mockResolvedValue({
      _id: docId,
      _updatedAt: 2000,
      _etag: 'new-hash',
      data: { val: 2 }
    });

    await db.sync();

    // Verify: get() WAS called
    expect(mockS3Adapter.prototype.get).toHaveBeenCalledWith(docId);
    
    // Verify local updated
    const updated = await db.get<any>(docId);
    expect(updated.val).toBe(2);
  });

  test('should update local ETag after push', async () => {
    await db.init();
    
    // Create new doc (no ETag yet)
    const id = await db.save({ val: 'fresh' });
    
    // Mock S3 put returning an ETag
    mockS3Adapter.prototype.put.mockResolvedValue('s3-etag-xyz');

    await db.sync();

    // Verify local doc now has the ETag
    const doc = await (db as any).localStore.get(id);
    expect(doc._etag).toBe('s3-etag-xyz');
  });
});
