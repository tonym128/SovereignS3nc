import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';

jest.mock('../src/adapters/S3RemoteAdapter');

describe('SovereignS3nc Public API', () => {
  let db: SovereignS3nc;

  beforeEach(() => {
    (S3RemoteAdapter as any).mockClear();
    (S3RemoteAdapter.prototype as any).put = jest.fn().mockResolvedValue(undefined);
    (S3RemoteAdapter.prototype as any).get = jest.fn().mockResolvedValue(null);
    (S3RemoteAdapter.prototype as any).listChanges = jest.fn().mockResolvedValue([]);
    
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

  test('should expose sync status and last sync time', async () => {
    await db.init();
    
    // Initial state
    expect(db.syncing).toBe(false);
    expect(db.lastSyncedAt).toBe(0);

    // Mock a slow sync
    ((S3RemoteAdapter.prototype as any).listChanges as jest.Mock).mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return [];
    });

    const syncPromise = db.sync();
    
    // Check status during sync
    expect(db.syncing).toBe(true);
    
    await syncPromise;
    
    // Check status after sync
    expect(db.syncing).toBe(false);
    expect(db.lastSyncedAt).toBeGreaterThan(0);
  });

  test('should allow full CRUD without touching store types', async () => {
    await db.init();

    // 1. Create
    const id = await db.save({ title: 'Task 1' });
    expect(typeof id).toBe('string');

    // 2. Retrieve
    const task = await db.get<any>(id);
    expect(task.title).toBe('Task 1');

    // 3. Update
    await db.save({ _id: id, title: 'Task 1 Updated' });
    const updated = await db.get<any>(id);
    expect(updated.title).toBe('Task 1 Updated');

    // 4. Retrieve All
    const all = await db.getAll();
    expect(all).toHaveLength(1);

    // 5. Delete
    await db.delete(id);
    const deleted = await db.get(id);
    expect(deleted).toBeNull();

    // 6. Sync
    await db.sync();
    expect(db.lastSyncedAt).toBeGreaterThan(0);
  });
});