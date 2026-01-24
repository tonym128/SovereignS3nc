import 'fake-indexeddb/auto';
import { IndexedDBStorage } from '../src/adapters/IndexedDBStorage';
import { SyncDocument } from '../src/types';

describe('IndexedDBStorage', () => {
  let storage: IndexedDBStorage;

  beforeEach(async () => {
    // Unique DB name per test to avoid collisions in the fake global scope
    storage = new IndexedDBStorage('TestDB_' + Math.random().toString(36).substring(7));
    await storage.init();
  });

  test('should initialize and save a document', async () => {
    const doc: SyncDocument = {
      _id: '1',
      _updatedAt: Date.now(),
      data: { foo: 'bar' }
    };
    await storage.put(doc);
    const retrieved = await storage.get('1');
    expect(retrieved).toEqual(doc);
  });

  test('should list documents', async () => {
    const doc1: SyncDocument = { _id: '1', _updatedAt: 100, data: 'a' };
    const doc2: SyncDocument = { _id: '2', _updatedAt: 200, data: 'b' };
    await storage.bulkPut([doc1, doc2]);
    
    const list = await storage.list();
    expect(list.length).toBe(2);
    expect(list).toEqual(expect.arrayContaining([doc1, doc2]));
  });

  test('should get changes since a timestamp', async () => {
    const doc1: SyncDocument = { _id: '1', _updatedAt: 100, data: 'old' };
    const doc2: SyncDocument = { _id: '2', _updatedAt: 200, data: 'new' };
    await storage.bulkPut([doc1, doc2]);

    const changes = await storage.getChanges(150);
    expect(changes.length).toBe(1);
    expect(changes[0]._id).toBe('2');
  });

  test('should handle soft deleted documents in list', async () => {
    const doc1: SyncDocument = { _id: '1', _updatedAt: 100, data: 'alive' };
    const doc2: SyncDocument = { _id: '2', _updatedAt: 200, _deleted: true, data: 'dead' };
    await storage.bulkPut([doc1, doc2]);

    const active = await storage.list(false);
    expect(active.length).toBe(1);
    expect(active[0]._id).toBe('1');

    const all = await storage.list(true);
    expect(all.length).toBe(2);
  });
});
