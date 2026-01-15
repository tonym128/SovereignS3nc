import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';

jest.mock('../src/adapters/S3RemoteAdapter');

describe('SovereignS3nc Public API', () => {
  let db: SovereignS3nc;
  const mockS3Adapter = S3RemoteAdapter as jest.MockedClass<typeof S3RemoteAdapter>;

  beforeEach(() => {
    mockS3Adapter.mockClear();
    mockS3Adapter.prototype.put = jest.fn().mockResolvedValue(undefined);
    mockS3Adapter.prototype.get = jest.fn().mockResolvedValue(null);
    mockS3Adapter.prototype.listChanges = jest.fn().mockResolvedValue([]);
    
    db = new SovereignS3nc({
      s3: {
        region: 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        bucketName: 'test-bucket'
      },
      syncIntervalMs: 0
    });
  });

  test('should expose sync status and last sync time', async () => {
    await db.init();
    
    // Initial state
    expect(db.syncing).toBe(false);
    expect(db.lastSyncedAt).toBe(0);

    // Mock a slow sync
    mockS3Adapter.prototype.listChanges.mockImplementation(async () => {
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
