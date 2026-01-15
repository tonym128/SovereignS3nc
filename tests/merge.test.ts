import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';
import { SyncDocument } from '../src/types';

jest.mock('../src/adapters/S3RemoteAdapter');

describe('SovereignS3nc Merging', () => {
  let db: SovereignS3nc;

  beforeEach(() => {
    (S3RemoteAdapter as any).mockClear();
    
    // Default mocks
    (S3RemoteAdapter.prototype as any).put = jest.fn().mockResolvedValue(undefined);
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
      syncIntervalMs: 0
    });
  });

  test('should merge disjoint fields from both sides', async () => {
    await db.init();
    
    const docId = 'doc-disjoint';
    // Local: has 'title'
    await db.save({ _id: docId, title: 'Local Title' });

    // Remote: has 'tags' (and is newer)
    const remoteDoc: SyncDocument = {
      _id: docId,
      _updatedAt: Date.now() + 1000,
      data: { tags: ['remote'] }
    };

    ((S3RemoteAdapter.prototype as any).listChanges as jest.Mock).mockResolvedValue([
      { id: docId, key: `app/user/store/${docId}.json`, etag: 'remote', lastModified: new Date() }
    ]);
    ((S3RemoteAdapter.prototype as any).get as jest.Mock).mockResolvedValue(remoteDoc);

    const stats = await db.sync();
    
    expect(stats.pulled).toBe(1);
    
    const mergedDoc = await db.get<any>(docId);
    expect(mergedDoc).toBeDefined();
    // Verify both fields exist
    expect(mergedDoc.title).toBe('Local Title');
    expect(mergedDoc.tags).toEqual(['remote']);
  });

  test('should resolve conflicts by timestamp (Newer Wins)', async () => {
    await db.init();
    
    const docId = 'doc-conflict';
    
    // 1. Local is OLDER
    await db.save({ _id: docId, status: 'Draft' });
    
    const remoteDoc: SyncDocument = {
      _id: docId,
      _updatedAt: Date.now() + 5000, // Future
      data: { status: 'Published' }
    };

    ((S3RemoteAdapter.prototype as any).listChanges as jest.Mock).mockResolvedValue([
       { id: docId, key: `app/user/store/${docId}.json`, etag: 'remote', lastModified: new Date() }
    ]);
    ((S3RemoteAdapter.prototype as any).get as jest.Mock).mockResolvedValue(remoteDoc);

    await db.sync();
    
    let doc = await db.get<any>(docId);
    expect(doc.status).toBe('Published'); // Remote (Newer) wins

    // 2. Local is NEWER
    // Reset DB for clarity
    (S3RemoteAdapter as any).mockClear();
    (S3RemoteAdapter.prototype as any).put = jest.fn().mockResolvedValue(undefined);
    (S3RemoteAdapter.prototype as any).get = jest.fn().mockResolvedValue(null);

    // Save local with VERY future timestamp
    const futureTime = Date.now() + 100000;
    const localDoc: SyncDocument = {
        _id: 'doc-local-wins',
        _updatedAt: futureTime,
        data: { status: 'LocalWin' }
    };
    // Inject into local store directly
    await (db as any).localStore.put(localDoc);

    // Remote is older
    const remoteOlder: SyncDocument = {
        _id: 'doc-local-wins',
        _updatedAt: Date.now(),
        data: { status: 'RemoteLoss' }
    };

    ((S3RemoteAdapter.prototype as any).listChanges as jest.Mock).mockResolvedValue([
       { id: 'doc-local-wins', key: 'app/user/store/doc-local-wins.json', etag: 'remote-older', lastModified: new Date() }
    ]);
    ((S3RemoteAdapter.prototype as any).get as jest.Mock).mockResolvedValue(remoteOlder);

    await db.sync();

    doc = await db.get<any>('doc-local-wins');
    expect(doc.status).toBe('LocalWin');
  });
});
