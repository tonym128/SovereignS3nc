import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { merge } from 'ts-deepmerge';
import { SovereignConfig, SyncDocument, SyncStats } from './types';
import { ILocalStorage } from './interfaces/IStorage';
import { InMemoryStorage } from './adapters/InMemoryStorage';
import { S3RemoteAdapter } from './adapters/S3RemoteAdapter';
import { ICryptoAdapter } from './interfaces/ICryptoAdapter';
import { AESCryptoAdapter } from './adapters/AESCryptoAdapter';

export class SovereignS3nc extends EventEmitter {
  private localStore: ILocalStorage;
  private remote: S3RemoteAdapter;
  private config: SovereignConfig;
  private crypto?: ICryptoAdapter;
  private syncInterval: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;
  private lastSyncTime: number = 0;

  constructor(config: SovereignConfig, customLocalStorage?: ILocalStorage) {
    super();
    this.config = config;
    this.localStore = customLocalStorage || new InMemoryStorage(config.localPersistencePath);
    this.remote = new S3RemoteAdapter(config.s3, config.paths);
    
    if (config.encryptionKey) {
      this.crypto = new AESCryptoAdapter(config.encryptionKey);
    }
  }

  async init(): Promise<void> {
    await this.localStore.init();
    
    const meta = await this.localStore.get('_sovereign_meta');
    if (meta) {
      this.lastSyncTime = meta.data.lastSyncTime || 0;
    }

    if (this.config.syncIntervalMs && this.config.syncIntervalMs > 0) {
      this.startAutoSync();
    }
  }

  public get syncing(): boolean {
    return this.isSyncing;
  }

  public get lastSyncedAt(): number {
    return this.lastSyncTime;
  }

  // --- Encryption Helpers ---

  private async encryptData(data: any): Promise<any> {
    if (!this.crypto) return data;
    return await this.crypto.encrypt(data);
  }

  private async decryptData(data: any): Promise<any> {
    if (!this.crypto) return data;
    // If data is not a string, it might not be encrypted or is legacy data
    if (typeof data !== 'string') return data;
    try {
      return await this.crypto.decrypt(data);
    } catch (e) {
      console.warn('Failed to decrypt data, returning raw:', e);
      return data;
    }
  }

  // --- CRUD ---

  async save<T>(data: T & { _id?: string }): Promise<string> {
    const id = data._id || uuidv4();
    
    // Encrypt payload
    const storedData = await this.encryptData(data);

    const doc: SyncDocument<any> = {
      _id: id,
      _updatedAt: Date.now(),
      data: storedData
    };
    
    await this.localStore.put(doc);
    this.emit('change', { type: 'save', id, doc });
    return id;
  }

  async get<T>(id: string): Promise<T | null> {
    const doc = await this.localStore.get(id);
    if (!doc || doc._deleted) return null;
    
    const plainData = await this.decryptData(doc.data);
    return plainData as T;
  }

  async getAll<T>(): Promise<T[]> {
    const docs = await this.localStore.list(false);
    const results: T[] = [];
    for (const doc of docs) {
      if (doc._id.startsWith('_sovereign_')) continue;
      const plain = await this.decryptData(doc.data);
      results.push(plain as T);
    }
    return results;
  }

  async delete(id: string): Promise<void> {
    const doc = await this.localStore.get(id);
    if (doc) {
      doc._deleted = true;
      doc._updatedAt = Date.now();
      await this.localStore.put(doc);
      this.emit('change', { type: 'delete', id });
    }
  }

  // --- Sync ---

  startAutoSync() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.syncInterval = setInterval(() => {
      this.sync().catch(err => console.error('Auto-sync failed:', err));
    }, this.config.syncIntervalMs);
  }

  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  async sync(): Promise<SyncStats> {
    if (this.isSyncing) return { pushed: 0, pulled: 0, errors: 0 };
    this.isSyncing = true;
    const stats: SyncStats = { pushed: 0, pulled: 0, errors: 0 };

    try {
      this.emit('syncStart');
      const startSyncTime = Date.now();

      // --- STEP 1: PULL & MERGE ---
      const lastSyncDate = new Date(this.lastSyncTime);
      const changes = await this.remote.listChanges(lastSyncDate);

      for (const change of changes) {
        try {
          const id = change.id;
          const localDoc = await this.localStore.get(id);

          if (localDoc && change.etag && localDoc._etag === change.etag) {
             continue;
          }

          const remoteDoc = await this.remote.get(id);
          
          if (remoteDoc) {
            if (!localDoc) {
              await this.localStore.put(remoteDoc);
              stats.pulled++;
              this.emit('change', { type: 'pull', id, doc: remoteDoc });
            } else {
              const isLocalDirty = localDoc._updatedAt > this.lastSyncTime;
              
              if (!isLocalDirty) {
                 await this.localStore.put(remoteDoc);
                 stats.pulled++;
                 this.emit('change', { type: 'pull', id, doc: remoteDoc });
              } else {
                if (this.config.conflictResolutionStrategy === 'LastWriteWins') {
                  if (remoteDoc._updatedAt > localDoc._updatedAt) {
                    await this.localStore.put(remoteDoc);
                    stats.pulled++;
                    this.emit('change', { type: 'pull', id, doc: remoteDoc });
                  }
                } else {
                  // Merge Strategy
                  // Note: mergeDocs is now async
                  const merged = await this.mergeDocs(localDoc, remoteDoc);
                  await this.localStore.put(merged);
                  stats.pulled++; 
                  this.emit('change', { type: 'merge', id, doc: merged });
                }
              }
            }
          }
        } catch (e) {
          console.error(`Failed to pull/merge key ${change.key}`, e);
          stats.errors++;
        }
      }

      // --- STEP 2: PUSH ---
      const localChanges = await this.localStore.getChanges(this.lastSyncTime);
      
      for (const doc of localChanges) {
        if (doc._id.startsWith('_sovereign_')) continue; 
        try {
          const etag = await this.remote.put(doc);
          stats.pushed++;
          
          if (etag) {
            doc._etag = etag;
            await this.localStore.put(doc);
          }
        } catch (e) {
          console.error(`Failed to push doc ${doc._id}`, e);
          stats.errors++;
        }
      }

      this.lastSyncTime = startSyncTime;
      await this.localStore.put({
        _id: '_sovereign_meta',
        _updatedAt: Date.now(),
        data: { lastSyncTime: this.lastSyncTime }
      });

      this.emit('syncComplete', stats);
    } catch (err) {
      this.emit('error', err);
      stats.errors++;
    } finally {
      this.isSyncing = false;
    }
    return stats;
  }

  // --- Import / Export ---

  async export(id?: string): Promise<string> {
    let docs: SyncDocument[] = [];
    if (id) {
      const doc = await this.localStore.get(id);
      if (doc) docs.push(doc);
    } else {
      docs = await this.localStore.list(false);
    }
    docs = docs.filter(d => !d._id.startsWith('_sovereign_'));

    // Decrypt all data for export
    const decryptedDocs = await Promise.all(docs.map(async d => {
      const plain = await this.decryptData(d.data);
      return { ...d, data: plain };
    }));

    return JSON.stringify(decryptedDocs, null, 2);
  }

  async import(json: string): Promise<void> {
    let docs: any;
    try {
      docs = JSON.parse(json);
    } catch (e) {
      throw new Error('Invalid JSON format');
    }

    if (!Array.isArray(docs)) {
      if (typeof docs === 'object' && docs !== null) {
        docs = [docs];
      } else {
        throw new Error('Import data must be an array of documents');
      }
    }

    for (const doc of docs as SyncDocument[]) {
      if (!doc._id || !doc.data) continue;

      // Import logic assumes 'doc.data' is PLAIN JSON (decrypted)
      // We need to re-encrypt it to store it.
      
      const local = await this.localStore.get(doc._id);
      
      // But wait, to merge, we need to compare PLAIN data.
      // So let's encrypt AFTER merge.

      if (local) {
        // Need to pass a "Plain" version of local to merge? 
        // Or decrypt local first.
        // And the 'doc' from import is already plain.
        // My mergeDocs expects two SyncDocuments which might contain encrypted data.
        // I should probably overload or adapt mergeDocs.
        
        // Let's manually do it here to be safe and explicit
        const localPlainData = await this.decryptData(local.data);
        const importedPlainData = doc.data; // Assumed plain

        // Logic: Older < Newer
        const mergedPlainData = local._updatedAt > doc._updatedAt 
            ? merge(importedPlainData, localPlainData) 
            : merge(localPlainData, importedPlainData);

        const mergedEncrypted = await this.encryptData(mergedPlainData);

        const mergedDoc: SyncDocument = {
            ...local,
            _updatedAt: Date.now(),
            data: mergedEncrypted
        };
        
        await this.localStore.put(mergedDoc);
        this.emit('change', { type: 'import', id: doc._id, doc: mergedDoc });

      } else {
        // New insert
        const encryptedData = await this.encryptData(doc.data);
        const newDoc: SyncDocument = {
            ...doc,
            _updatedAt: Date.now(),
            data: encryptedData
        };
        await this.localStore.put(newDoc);
        this.emit('change', { type: 'import', id: doc._id, doc: newDoc });
      }
    }
  }

  // --- Merge Logic ---

  private async mergeDocs(local: SyncDocument, remote: SyncDocument): Promise<SyncDocument> {
    if (local._deleted && remote._deleted) return remote;
    if (local._deleted) return remote._updatedAt > local._updatedAt ? remote : local;
    if (remote._deleted) return local._updatedAt > remote._updatedAt ? local : remote;

    // Decrypt both
    const localPlain = await this.decryptData(local.data);
    const remotePlain = await this.decryptData(remote.data);

    // Deep merge data: Older < Newer (Newer overwrites Older)
    const mergedPlain = local._updatedAt > remote._updatedAt 
      ? merge(remotePlain, localPlain) 
      : merge(localPlain, remotePlain);
    
    // Encrypt result
    const mergedEncrypted = await this.encryptData(mergedPlain);

    return {
      _id: local._id,
      _updatedAt: Date.now(), 
      _rev: uuidv4(),
      _etag: remote._etag, // Invalidate/Reuse? Usually new push gets new etag.
      data: mergedEncrypted
    };
  }
}
