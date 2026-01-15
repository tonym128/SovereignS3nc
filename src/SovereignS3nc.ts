import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { merge } from 'ts-deepmerge';
import { SovereignConfig, SyncDocument, SyncStats } from './types';
import { ILocalStorage } from './interfaces/IStorage';
import { InMemoryStorage } from './adapters/InMemoryStorage';
import { S3RemoteAdapter } from './adapters/S3RemoteAdapter';
import { ICryptoAdapter } from './interfaces/ICryptoAdapter';
import { AESCryptoAdapter } from './adapters/AESCryptoAdapter';

interface ShareMetadata {
  sharedId: string;
  isPublic: boolean;
  encryptionKey?: string;
}

export class SovereignS3nc extends EventEmitter {
  private localStore: ILocalStorage;
  private remote: S3RemoteAdapter;
  private sharedRemote: S3RemoteAdapter;
  private config: SovereignConfig;
  private crypto?: ICryptoAdapter;
  private syncInterval: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;
  private lastSyncTime: number = 0;
  private sharedDocs: Map<string, ShareMetadata> = new Map();

  constructor(config: SovereignConfig, customLocalStorage?: ILocalStorage) {
    super();
    this.config = config;
    this.localStore = customLocalStorage || new InMemoryStorage(config.localPersistencePath);
    this.remote = new S3RemoteAdapter(config.s3, config.paths);
    this.sharedRemote = new S3RemoteAdapter(config.s3, {
      appId: config.paths.appId,
      userId: 'shared',
      storeId: 'shared'
    });
    
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

    const shares = await this.localStore.get('_sovereign_shares');
    if (shares && shares.data) {
      // Migrate legacy string values to ShareMetadata
      const entries = Object.entries(shares.data).map(([key, value]): [string, ShareMetadata] => {
        if (typeof value === 'string') {
          return [key, { sharedId: value, isPublic: false }];
        }
        return [key, value as ShareMetadata];
      });
      this.sharedDocs = new Map(entries);
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

  // --- Sharing ---

  async share(docId: string, isPublic: boolean = false): Promise<string> {
    const doc = await this.localStore.get(docId);
    if (!doc || doc._deleted) {
      throw new Error('Document not found');
    }

    if (this.sharedDocs.has(docId)) {
      const existing = this.sharedDocs.get(docId)!;
      // If requested status matches existing, return existing ID
      if (existing.isPublic === isPublic) {
        return existing.sharedId;
      }
      // Status change not fully supported in this simple version without full re-share logic
      // But we can update metadata
      existing.isPublic = isPublic;
      if (isPublic && !existing.encryptionKey) {
        existing.encryptionKey = uuidv4().replace(/-/g, ''); // Simple key gen
      }
      this.sharedDocs.set(docId, existing);
      await this.persistShares();
      await this.updateSharedDoc(doc, existing);
      if (isPublic) await this.addToPublicIndex(existing);
      return existing.sharedId;
    }

    const sharedId = uuidv4();
    const metadata: ShareMetadata = {
      sharedId,
      isPublic
    };
    
    if (isPublic) {
      metadata.encryptionKey = uuidv4().replace(/-/g, '');
    }

    this.sharedDocs.set(docId, metadata);
    
    await this.persistShares();
    await this.updateSharedDoc(doc, metadata);

    if (isPublic) {
      await this.addToPublicIndex(metadata);
    }

    return sharedId;
  }

  async unshare(docId: string): Promise<void> {
    if (!this.sharedDocs.has(docId)) return;
    
    const metadata = this.sharedDocs.get(docId)!;
    this.sharedDocs.delete(docId);
    await this.persistShares();
    
    // Attempt to delete the shared copy
    try {
      await this.sharedRemote.delete(metadata.sharedId);
      if (metadata.isPublic) {
        await this.removeFromPublicIndex(metadata.sharedId);
      }
    } catch (e) {
      console.warn(`Failed to delete shared doc ${metadata.sharedId}`, e);
    }
  }

  private async persistShares(): Promise<void> {
    const data = Object.fromEntries(this.sharedDocs);
    await this.localStore.put({
      _id: '_sovereign_shares',
      _updatedAt: Date.now(),
      data
    });
  }

  private async updateSharedDoc(doc: SyncDocument, metadata: ShareMetadata): Promise<void> {
    let payload = doc.data;

    // If public, we need to decrypt the local data and re-encrypt with the shared key
    if (metadata.isPublic && metadata.encryptionKey) {
       try {
         const plain = await this.decryptData(doc.data);
         const tempCrypto = new AESCryptoAdapter(metadata.encryptionKey);
         payload = await tempCrypto.encrypt(plain);
       } catch (e) {
         console.error('Failed to re-encrypt for sharing', e);
         return; // Abort share update if encryption fails
       }
    }

    const sharedDoc: SyncDocument = {
      _id: metadata.sharedId,
      _rev: uuidv4(),
      _updatedAt: Date.now(),
      _deleted: doc._deleted,
      data: payload
    };
    await this.sharedRemote.put(sharedDoc);
  }

  private async putLocal(doc: SyncDocument): Promise<void> {
    await this.localStore.put(doc);
    
    // If this is a regular document and it is shared, update the share
    if (!doc._id.startsWith('_sovereign_') && this.sharedDocs.has(doc._id)) {
      try {
        await this.updateSharedDoc(doc, this.sharedDocs.get(doc._id)!);
      } catch (e) {
        console.error(`Failed to update shared doc copy for ${doc._id}`, e);
      }
    }
  }

  // --- Public Index Management ---

  private async addToPublicIndex(metadata: ShareMetadata): Promise<void> {
    if (!metadata.encryptionKey) return;
    try {
      const indexDoc = await this.sharedRemote.get('public');
      let index: any[] = [];
      if (indexDoc) {
        index = indexDoc.data;
      }
      
      // Remove existing entry if any
      index = index.filter((i: any) => i.id !== metadata.sharedId);
      
      index.push({
        id: metadata.sharedId,
        key: metadata.encryptionKey,
        updatedAt: Date.now()
      });

      await this.sharedRemote.put({
        _id: 'public',
        _updatedAt: Date.now(),
        data: index
      });
    } catch (e) {
      console.error('Failed to update public index', e);
    }
  }

  private async removeFromPublicIndex(sharedId: string): Promise<void> {
    try {
      const indexDoc = await this.sharedRemote.get('public');
      if (!indexDoc) return;
      
      const index = indexDoc.data.filter((i: any) => i.id !== sharedId);
      
      await this.sharedRemote.put({
        ...indexDoc,
        _updatedAt: Date.now(),
        data: index
      });
    } catch (e) {
      console.error('Failed to update public index', e);
    }
  }

  // --- Public Consumption ---

  async getPublicShares(): Promise<any[]> {
    const indexDoc = await this.sharedRemote.get('public');
    return indexDoc ? indexDoc.data : [];
  }

  async getSharedDoc(sharedId: string, key: string): Promise<any> {
    const doc = await this.sharedRemote.get(sharedId);
    if (!doc) return null;
    
    const tempCrypto = new AESCryptoAdapter(key);
    return await tempCrypto.decrypt(doc.data);
  }

  async saveSharedDocToLocal(sharedId: string, key: string): Promise<string> {
    const plainData = await this.getSharedDoc(sharedId, key);
    if (!plainData) throw new Error('Shared document not found or decrypt failed');
    
    // Check if we already have this doc (by matching content or ID logic?)
    // If the plainData contains the original _id, we can reuse it.
    // If not, we might create a duplicate. 
    // Assuming plainData matches the { _id, ... } structure of source if it was full doc sync.
    // But usually `data` is the payload. The _id is separate in SyncDocument.
    // However, when we encrypt, we encrypt `data`. 
    // If the original `data` had an ID, good. If not, we generate new one.
    
    const newId = plainData._id || uuidv4();
    
    // To save locally, we must encrypt with OUR master key
    const encryptedData = await this.encryptData(plainData);
    
    const newDoc: SyncDocument = {
      _id: newId,
      _updatedAt: Date.now(),
      data: encryptedData
    };

    await this.putLocal(newDoc);
    return newId;
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
    
    await this.putLocal(doc);
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
      await this.putLocal(doc);
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
              await this.putLocal(remoteDoc);
              stats.pulled++;
              this.emit('change', { type: 'pull', id, doc: remoteDoc });
            } else {
              const isLocalDirty = localDoc._updatedAt > this.lastSyncTime;
              
              if (!isLocalDirty) {
                 await this.putLocal(remoteDoc);
                 stats.pulled++;
                 this.emit('change', { type: 'pull', id, doc: remoteDoc });
              } else {
                if (this.config.conflictResolutionStrategy === 'LastWriteWins') {
                  if (remoteDoc._updatedAt > localDoc._updatedAt) {
                    await this.putLocal(remoteDoc);
                    stats.pulled++;
                    this.emit('change', { type: 'pull', id, doc: remoteDoc });
                  }
                } else {
                  // Merge Strategy
                  // Note: mergeDocs is now async
                  const merged = await this.mergeDocs(localDoc, remoteDoc);
                  await this.putLocal(merged);
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
            await this.putLocal(doc);
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
        
        await this.putLocal(mergedDoc);
        this.emit('change', { type: 'import', id: doc._id, doc: mergedDoc });

      } else {
        // New insert
        const encryptedData = await this.encryptData(doc.data);
        const newDoc: SyncDocument = {
            ...doc,
            _updatedAt: Date.now(),
            data: encryptedData
        };
        await this.putLocal(newDoc);
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
