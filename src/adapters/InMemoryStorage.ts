import * as fs from 'fs';
import * as path from 'path';
import { ILocalStorage } from '../interfaces/IStorage';
import { SyncDocument } from '../types';

export class InMemoryStorage implements ILocalStorage {
  // Key format: "collection::id" or "id" (if no collection)
  private store: Map<string, SyncDocument> = new Map();
  private filePath?: string;

  constructor(filePath?: string) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    if (this.filePath && fs.existsSync(this.filePath)) {
      try {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        const docs: SyncDocument[] = JSON.parse(data);
        docs.forEach(doc => {
           const key = this.getMapKey(doc._id, doc.collection);
           this.store.set(key, doc);
        });
      } catch (err) {
        console.error('Failed to load local database:', err);
      }
    }
  }

  private getMapKey(id: string, collection?: string): string {
    return collection ? `${collection}::${id}` : id;
  }

  private async persist(): Promise<void> {
    if (this.filePath) {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = JSON.stringify(Array.from(this.store.values()), null, 2);
      fs.writeFileSync(this.filePath, data);
    }
  }

  async put(doc: SyncDocument, collection?: string): Promise<void> {
    // Ensure doc.collection is set if provided
    if (collection) {
        doc.collection = collection;
    }
    const key = this.getMapKey(doc._id, doc.collection);
    this.store.set(key, doc);
    await this.persist();
  }

  async get(id: string, collection?: string): Promise<SyncDocument | null> {
    const key = this.getMapKey(id, collection);
    return this.store.get(key) || null;
  }

  async list(includeDeleted: boolean = false, collection?: string): Promise<SyncDocument[]> {
    let all = Array.from(this.store.values());
    
    if (collection) {
        all = all.filter(doc => doc.collection === collection);
    } else {
        // If collection is NOT provided, do we list everything? 
        // Or only things without collection?
        // Usually list() implies everything unless scoped.
        // But for backward compatibility, maybe list() returns everything?
        // Let's return everything.
    }

    if (includeDeleted) return all;
    return all.filter(doc => !doc._deleted);
  }

  async getChanges(since: number, collection?: string): Promise<SyncDocument[]> {
    return Array.from(this.store.values()).filter(doc => {
        if (doc._updatedAt <= since) return false;
        if (collection && doc.collection !== collection) return false;
        return true;
    });
  }

  async bulkPut(docs: SyncDocument[]): Promise<void> {
    docs.forEach(doc => {
        const key = this.getMapKey(doc._id, doc.collection);
        this.store.set(key, doc);
    });
    await this.persist();
  }
}