import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';
import { SyncDocument } from '../src/types';

jest.mock('../src/adapters/S3RemoteAdapter');

describe('SovereignS3nc Import/Export', () => {
  let db: SovereignS3nc;

  beforeEach(() => {
    (S3RemoteAdapter as any).mockClear();
    (S3RemoteAdapter.prototype as any).put = jest.fn().mockResolvedValue(undefined);
    (S3RemoteAdapter.prototype as any).get = jest.fn().mockResolvedValue(null);
    (S3RemoteAdapter.prototype as any).listChanges = jest.fn().mockResolvedValue([]);

    db = new SovereignS3nc({
      s3: { region: 'test', credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, bucketName: 'bucket' },
      paths: { appId: 'app', userId: 'user', storeId: 'store' },
      syncIntervalMs: 0
    });
  });

  test('should export all documents', async () => {
    await db.init();
    await db.save({ _id: '1', title: 'One' });
    await db.save({ _id: '2', title: 'Two' });

    const json = await db.exportData();
    const parsed = JSON.parse(json);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed.find((d: any) => d._id === '1')).toBeDefined();
    expect(parsed.find((d: any) => d._id === '2')).toBeDefined();
  });

  test('should export a single document', async () => {
    await db.init();
    await db.save({ _id: '1', title: 'One' });
    await db.save({ _id: '2', title: 'Two' });

    const json = await db.exportData('1');
    const parsed = JSON.parse(json);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0]._id).toBe('1');
  });

  test('should import new documents', async () => {
    await db.init();

    const importData = [
      { _id: '3', data: { title: 'Three' }, _updatedAt: 100 }
    ];
    const json = JSON.stringify(importData);

    await db.importData(json);

    const doc = await db.get('3');
    expect(doc).toBeDefined();
    // Verify it updated the timestamp to now (so it will sync)
    // We can't check exact time easily, but it should be > 100
    const raw = await (db as any).localStore.get('3');
    expect(raw._updatedAt).toBeGreaterThan(100);
  });

  test('should merge imported documents with existing ones', async () => {
    await db.init();

    // Existing: { title: 'Original' }
    await db.save({ _id: 'merge-me', title: 'Original' });

    // Import: { description: 'Imported' } (Disjoint)
    // Timestamp 0 to simulate old backup
    const importData = [
      { _id: 'merge-me', data: { description: 'Imported' }, _updatedAt: 0 }
    ];
    
    await db.importData(JSON.stringify(importData));

    const doc = await db.get<any>('merge-me');
    
    // Should have both
    expect(doc.title).toBe('Original');
    expect(doc.description).toBe('Imported');
    
    // Check if it's marked for sync (time updated)
    const raw = await (db as any).localStore.get('merge-me');
    expect(raw._updatedAt).toBeGreaterThan(0);
  });
});
