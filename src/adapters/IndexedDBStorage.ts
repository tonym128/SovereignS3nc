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
    this.db = await openDB(this.dbName, 2, {
      upgrade: (db, oldVersion, newVersion, transaction) => {
        let store;
        if (oldVersion === 0) {
          store = db.createObjectStore(this.storeName, { keyPath: '_id' });
          store.createIndex('by-date', '_updatedAt');
        } else {
          store = transaction.objectStore(this.storeName);
        }

        if (!store.indexNames.contains('collection')) {
            store.createIndex('collection', 'collection', { unique: false });
        }
      },
    });
  }

  async put(doc: SyncDocument, collection?: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    if (collection) doc.collection = collection;
    await this.db.put(this.storeName, doc);
  }

  async get(id: string, collection?: string): Promise<SyncDocument | null> {
    if (!this.db) throw new Error('Database not initialized');
    const doc = await this.db.get(this.storeName, id);
    if (!doc) return null;
    if (collection && doc.collection !== collection) return null;
    return doc;
  }

  async list(includeDeleted: boolean = false, collection?: string): Promise<SyncDocument[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    let docs: SyncDocument[];
    if (collection) {
        docs = await this.db.getAllFromIndex(this.storeName, 'collection', collection);
    } else {
        docs = await this.db.getAll(this.storeName);
    }

    if (includeDeleted) return docs;
    return docs.filter(doc => !doc._deleted);
  }

  async getChanges(since: number, collection?: string): Promise<SyncDocument[]> {
    if (!this.db) throw new Error('Database not initialized');
    // We can use the index 'by-date' to optimize this queries
    const range = IDBKeyRange.lowerBound(since, true); // true = open range (strictly greater than)
    const docs = await this.db.getAllFromIndex(this.storeName, 'by-date', range);
    
    if (collection) {
        return docs.filter(doc => doc.collection === collection);
    }
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