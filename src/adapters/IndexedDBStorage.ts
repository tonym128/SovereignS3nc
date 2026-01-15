import { openDB, IDBPDatabase } from 'idb';
import { ILocalStorage } from '../interfaces/IStorage';
import { SyncDocument } from '../types';

export class IndexedDBStorage implements ILocalStorage {
  private dbName: string;
  private storeName: string;
  private db: IDBPDatabase | null = null;

  constructor(dbName: string = 'SovereignS3ncDB', storeName: string = 'documents') {
    this.dbName = dbName;
    this.storeName = storeName;
  }

  async init(): Promise<void> {
    this.db = await openDB(this.dbName, 1, {
      upgrade: (db) => {
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: '_id' });
          store.createIndex('by-date', '_updatedAt');
        }
      },
    });
  }

  async put(doc: SyncDocument): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.put(this.storeName, doc);
  }

  async get(id: string): Promise<SyncDocument | null> {
    if (!this.db) throw new Error('Database not initialized');
    const doc = await this.db.get(this.storeName, id);
    return doc || null;
  }

  async list(includeDeleted: boolean = false): Promise<SyncDocument[]> {
    if (!this.db) throw new Error('Database not initialized');
    const docs: SyncDocument[] = await this.db.getAll(this.storeName);
    if (includeDeleted) return docs;
    return docs.filter(doc => !doc._deleted);
  }

  async getChanges(since: number): Promise<SyncDocument[]> {
    if (!this.db) throw new Error('Database not initialized');
    // We can use the index 'by-date' to optimize this queries
    const range = IDBKeyRange.lowerBound(since, true); // true = open range (strictly greater than)
    const docs = await this.db.getAllFromIndex(this.storeName, 'by-date', range);
    return docs;
  }

  async bulkPut(docs: SyncDocument[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const tx = this.db.transaction(this.storeName, 'readwrite');
    await Promise.all([
      ...docs.map(doc => tx.store.put(doc)),
      tx.done
    ]);
  }
}
