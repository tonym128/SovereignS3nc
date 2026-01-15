import * as fs from 'fs';
import * as path from 'path';
import { ILocalStorage } from '../interfaces/IStorage';
import { SyncDocument } from '../types';

export class InMemoryStorage implements ILocalStorage {
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
        docs.forEach(doc => this.store.set(doc._id, doc));
      } catch (err) {
        console.error('Failed to load local database:', err);
      }
    }
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

  async put(doc: SyncDocument): Promise<void> {
    this.store.set(doc._id, doc);
    await this.persist();
  }

  async get(id: string): Promise<SyncDocument | null> {
    return this.store.get(id) || null;
  }

  async list(includeDeleted: boolean = false): Promise<SyncDocument[]> {
    const all = Array.from(this.store.values());
    if (includeDeleted) return all;
    return all.filter(doc => !doc._deleted);
  }

  async getChanges(since: number): Promise<SyncDocument[]> {
    return Array.from(this.store.values()).filter(doc => doc._updatedAt > since);
  }

  async bulkPut(docs: SyncDocument[]): Promise<void> {
    docs.forEach(doc => this.store.set(doc._id, doc));
    await this.persist();
  }
}
