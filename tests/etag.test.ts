import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';
import { SyncDocument } from '../src/types';

jest.mock('../src/adapters/S3RemoteAdapter');

describe('SovereignS3nc ETag Optimization', () => {
  let db: SovereignS3nc;

  beforeEach(() => {
    (S3RemoteAdapter as any).mockClear();
    (S3RemoteAdapter.prototype as any).put = jest.fn().mockResolvedValue('new-etag');
    (S3RemoteAdapter.prototype as any).get = jest.fn().mockResolvedValue(null);
    (S3RemoteAdapter.prototype as any).listChanges = jest.fn().mockResolvedValue([]);
    
    db = new SovereignS3nc({
      s3: { region: 'test', credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, bucketName: 'bucket' },
      paths: { appId: 'app', userId: 'user', storeId: 'store' },
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
    ((S3RemoteAdapter.prototype as any).listChanges as jest.Mock).mockResolvedValue([{
      id: docId,
      key: `app/user/store/${docId}.json`,
      etag: 'hash-123',
      lastModified: new Date(2000)
    }]);

    await db.sync();

    // Verify: get() should NOT be called
    expect((S3RemoteAdapter.prototype as any).get).not.toHaveBeenCalled();
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
    ((S3RemoteAdapter.prototype as any).listChanges as jest.Mock).mockResolvedValue([{
      id: docId,
      key: `app/user/store/${docId}.json`,
      etag: 'new-hash',
      lastModified: new Date(2000)
    }]);

    ((S3RemoteAdapter.prototype as any).get as jest.Mock).mockResolvedValue({
      _id: docId,
      _updatedAt: 2000,
      _etag: 'new-hash',
      data: { val: 2 }
    });

    await db.sync();

    // Verify: get() WAS called
    expect((S3RemoteAdapter.prototype as any).get).toHaveBeenCalledWith(docId);
    
    // Verify local updated
    const updated = await db.get<any>(docId);
    expect(updated.val).toBe(2);
  });

  test('should update local ETag after push', async () => {
    await db.init();
    
    // Create new doc (no ETag yet)
    const id = await db.save({ val: 'fresh' });
    
    // Mock S3 put returning an ETag
    ((S3RemoteAdapter.prototype as any).put as jest.Mock).mockResolvedValue('s3-etag-xyz');

    await db.sync();

    // Verify local doc now has the ETag
    const doc = await (db as any).localStore.get(id);
    expect(doc._etag).toBe('s3-etag-xyz');
  });
});