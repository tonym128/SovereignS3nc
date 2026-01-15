import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';
import { SyncDocument } from '../src/types';

jest.mock('../src/adapters/S3RemoteAdapter');

describe('SovereignS3nc Merging', () => {
  let db: SovereignS3nc;
  const mockS3Adapter = S3RemoteAdapter as jest.MockedClass<typeof S3RemoteAdapter>;

  beforeEach(() => {
    mockS3Adapter.mockClear();
    
    // Default mocks
    mockS3Adapter.prototype.put = jest.fn().mockResolvedValue(undefined);
    mockS3Adapter.prototype.get = jest.fn().mockResolvedValue(null);
    mockS3Adapter.prototype.listChanges = jest.fn().mockResolvedValue([]);
    mockS3Adapter.prototype.delete = jest.fn().mockResolvedValue(undefined);

    db = new SovereignS3nc({
      s3: {
        region: 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        bucketName: 'test-bucket'
      },
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

    mockS3Adapter.prototype.listChanges.mockResolvedValue([`docs/${docId}.json`]);
    mockS3Adapter.prototype.get.mockResolvedValue(remoteDoc);

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
    // Manually set time back? No, just make remote future.
    
    const remoteDoc: SyncDocument = {
      _id: docId,
      _updatedAt: Date.now() + 5000, // Future
      data: { status: 'Published' }
    };

    mockS3Adapter.prototype.listChanges.mockResolvedValue([`docs/${docId}.json`]);
    mockS3Adapter.prototype.get.mockResolvedValue(remoteDoc);

    await db.sync();
    
    let doc = await db.get<any>(docId);
    expect(doc.status).toBe('Published'); // Remote (Newer) wins

    // 2. Local is NEWER
    // Update local again (now it's > remote's previous +5000?) 
    // Wait, syncing updates local time to Now().
    // Let's create a new conflict.
    
    // Reset DB for clarity
    mockS3Adapter.mockClear();
    
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

    mockS3Adapter.prototype.listChanges.mockResolvedValue(['docs/doc-local-wins.json']);
    mockS3Adapter.prototype.get.mockResolvedValue(remoteOlder);

    await db.sync();

    doc = await db.get<any>('doc-local-wins');
    expect(doc.status).toBe('LocalWin');
  });
});