import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { merge } from 'ts-deepmerge';
import { SovereignConfig, SyncDocument, SyncStats, SovereignAddress, BlobMetadata } from './types';
import { ILocalStorage } from './interfaces/IStorage';
import { InMemoryStorage } from './adapters/InMemoryStorage';
import { ICryptoAdapter } from './interfaces/ICryptoAdapter';
import { AESCryptoAdapter } from './adapters/AESCryptoAdapter';

// Remote Adapters
import { IRemoteAdapter } from './interfaces/IRemoteAdapter';
import { S3RemoteAdapter } from './adapters/S3RemoteAdapter';
import { OCIPreAuthAdapter } from './adapters/OCIPreAuthAdapter';

// Blob Adapters
import { IBlobAdapter } from './interfaces/IBlobAdapter';
import { S3BlobAdapter } from './adapters/S3BlobAdapter';
import { OCIBlobAdapter } from './adapters/OCIBlobAdapter';

// Modules
import { ProfileManager, SocialManager } from './modules/Social';
import { BoardManager } from './modules/Boards';

export interface ShareMetadata {
  sharedId: string;
  isPublic: boolean;
  encryptionKey?: string;
}

export class Collection {
  constructor(private db: SovereignS3nc, private name: string) {}
  
  save<T>(data: T & { _id?: string }): Promise<string> { return this.db.save(data, this.name); }
  get<T>(id: string): Promise<T | null> { return this.db.get(id, this.name); }
  getAll<T>(): Promise<T[]> { return this.db.getAll(this.name); }
  delete(id: string): Promise<void> { return this.db.delete(id, this.name); }
}

export class StorageManager {
  constructor(private db: SovereignS3nc) {}

  async upload(name: string, data: Uint8Array, contentType: string = 'application/octet-stream', isPublic: boolean = false): Promise<BlobMetadata> {
    if (!this.db.blobs) throw new Error('Blob storage not configured');
    
    const id = uuidv4();
    let payload = data;
    const shouldEncrypt = this.db.hasEncryption() && !isPublic;
    
    if (shouldEncrypt) {
        payload = await this.db.encryptRaw(data);
    }

    await this.db.blobs.upload(id, payload, contentType);

    const meta: BlobMetadata = {
        _id: id,
        name,
        size: data.length,
        contentType,
        createdAt: Date.now(),
        isEncrypted: shouldEncrypt
    };

    await this.db.collection('blobs').save(meta);
    return meta;
  }

  async download(id: string, options?: { decrypt?: boolean }): Promise<Uint8Array | null> {
    if (!this.db.blobs) throw new Error('Blob storage not configured');
    
    const meta = await this.db.collection('blobs').get<BlobMetadata>(id);
    const raw = await this.db.blobs.download(id);
    if (!raw) return null;

    // Determine encryption status
    // 1. Explicit option overrides everything
    // 2. Metadata overrides global default
    // 3. Global default
    let shouldDecrypt = this.db.hasEncryption();
    if (meta) shouldDecrypt = meta.isEncrypted;
    if (options && options.decrypt !== undefined) shouldDecrypt = options.decrypt;

    if (shouldDecrypt) {
        try {
            return await this.db.decryptRaw(raw);
        } catch (e) {
            console.warn(`Decryption failed for blob ${id}. Returning raw (might be plaintext).`);
            return raw;
        }
    }
    return raw;
  }

  async list(): Promise<BlobMetadata[]> {
    return this.db.collection('blobs').getAll<BlobMetadata>();
  }

  async delete(id: string): Promise<void> {
    if (!this.db.blobs) throw new Error('Blob storage not configured');
    await this.db.blobs.delete(id);
    await this.db.collection('blobs').delete(id);
  }
}

export class SovereignS3nc extends EventEmitter {
  private localStore: ILocalStorage;
  public remote?: IRemoteAdapter; 
  public blobs?: IBlobAdapter;
  private sharedRemote?: IRemoteAdapter; 
  private config: SovereignConfig;
  private crypto?: ICryptoAdapter;
  private syncInterval: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;
  private lastSyncTime: number = 0;
  private sharedDocs: Map<string, ShareMetadata> = new Map();

  public readonly profile: ProfileManager;
  public readonly social: SocialManager;
  public readonly boards: BoardManager;
  public readonly storage: StorageManager;

  public get shares(): Map<string, ShareMetadata> {
    return this.sharedDocs;
  }

  constructor(
    config: SovereignConfig, 
    customLocalStorage?: ILocalStorage, 
    customCryptoAdapter?: ICryptoAdapter
  ) {
    super();
    this.config = config;
    
    if (config.s3?.endpoint && config.s3.endpoint.startsWith('http://')) {
      console.warn(
        'SECURITY WARNING: You are using an insecure HTTP endpoint. ' + 
        'Your User IDs and Store IDs (GUIDs) are visible in cleartext network traffic. ' +
        'Please use HTTPS to ensure the "Security via Obscurity" model holds.'
      );
    }

    this.localStore = customLocalStorage || new InMemoryStorage(config.localPersistencePath);
    this.initRemote(config);
    
    if (customCryptoAdapter) {
      this.crypto = customCryptoAdapter;
    } else if (config.encryptionKey) {
      this.crypto = new AESCryptoAdapter(config.encryptionKey);
    }

    this.profile = new ProfileManager(this);
    this.social = new SocialManager(this);
    this.boards = new BoardManager(this);
    this.storage = new StorageManager(this);
  }

  public getAddress(): SovereignAddress {
    if (this.config.s3) {
      return {
        endpoint: this.config.s3.endpoint,
        region: this.config.s3.region,
        bucket: this.config.s3.bucketName,
        appId: this.config.paths.appId,
        userId: this.config.paths.userId
      };
    }
    return {
        region: 'unknown',
        bucket: 'unknown',
        appId: this.config.paths.appId,
        userId: this.config.paths.userId
    };
  }

  private initRemote(config: SovereignConfig) {
    if (config.ociParUrl) {
      this.remote = new OCIPreAuthAdapter(config.ociParUrl, config.paths, config.useManifest);
      this.blobs = new OCIBlobAdapter(config.ociParUrl, config.paths);
      this.sharedRemote = new OCIPreAuthAdapter(config.ociParUrl, {
        appId: config.paths.appId,
        userId: config.paths.userId,
        storeId: 'shared'
      }, config.useManifest);
    } else if (config.s3) {
      this.remote = new S3RemoteAdapter(config.s3, config.paths, config.useManifest);
      this.blobs = new S3BlobAdapter(config.s3, config.paths);
      this.sharedRemote = new S3RemoteAdapter(config.s3, {
        appId: config.paths.appId,
        userId: config.paths.userId,
        storeId: 'shared'
      }, config.useManifest);
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

  public collection(name: string): Collection {
    return new Collection(this, name);
  }

  public hasEncryption(): boolean {
    return !!this.crypto;
  }

  public async encryptRaw(data: Uint8Array): Promise<Uint8Array> {
    if (!this.crypto) return data;
    return this.crypto.encryptRaw(data);
  }

  public async decryptRaw(data: Uint8Array): Promise<Uint8Array> {
    if (!this.crypto) return data;
    return this.crypto.decryptRaw(data);
  }

  // --- Sharing ---

  async share(docId: string, isPublic: boolean = false, collection?: string): Promise<string> {
    const doc = await this.localStore.get(docId, collection);
    if (!doc || doc._deleted) {
      throw new Error('Document not found');
    }

    if (this.sharedDocs.has(docId)) {
      const existing = this.sharedDocs.get(docId)!;
      if (existing.isPublic === isPublic) {
        return existing.sharedId;
      }
      existing.isPublic = isPublic;
      if (isPublic && !existing.encryptionKey) {
        if (doc.collection !== 'profiles') {
            existing.encryptionKey = uuidv4().replace(/-/g, '');
        }
      }
      this.sharedDocs.set(docId, existing);
      await this.persistShares();
      await this.updateSharedDoc(doc, existing);
      if (isPublic) await this.addToPublicIndex(existing, doc.collection);
      return existing.sharedId;
    }

    const sharedId = uuidv4();
    const metadata: ShareMetadata = {
      sharedId,
      isPublic
    };
    
    if (isPublic && doc.collection !== 'profiles') {
      metadata.encryptionKey = uuidv4().replace(/-/g, '');
    }

    this.sharedDocs.set(docId, metadata);
    
    await this.persistShares();
    try {
      if (this.sharedRemote) {
        await this.updateSharedDoc(doc, metadata);
        if (isPublic) {
          await this.addToPublicIndex(metadata, doc.collection);
        }
      } else {
        console.warn('Document marked as shared locally, but not synced (offline mode).');
      }
    } catch (e) {
      console.error('Failed to sync share to remote', e);
    }

    return sharedId;
  }

  async unshare(docId: string): Promise<void> {
    if (!this.sharedDocs.has(docId)) return;
    
    const metadata = this.sharedDocs.get(docId)!;
    this.sharedDocs.delete(docId);
    await this.persistShares();
    
    if (this.sharedRemote) {
      try {
        await this.sharedRemote.delete(metadata.sharedId);
        if (metadata.isPublic) {
          await this.removeFromPublicIndex(metadata.sharedId);
        }
      } catch (e) {
        console.warn(`Failed to delete shared doc ${metadata.sharedId}`, e);
      }
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

  private getCryptoAdapter(key: string): ICryptoAdapter {
    if (this.crypto && this.crypto.constructor.name === 'WebCryptoAdapter') {
      const AdapterClass = this.crypto.constructor as any;
      return new AdapterClass(key);
    }
    return new AESCryptoAdapter(key);
  }

  private async updateSharedDoc(doc: SyncDocument, metadata: ShareMetadata): Promise<void> {
    if (!this.sharedRemote) return;
    let payload = doc.data;

    if (metadata.isPublic && metadata.encryptionKey) {
       try {
         const plain = await this.decryptData(doc.data);
         const tempCrypto = this.getCryptoAdapter(metadata.encryptionKey);
         payload = await tempCrypto.encrypt(plain);
       } catch (e) {
         console.error('Failed to re-encrypt for sharing', e);
         return; 
       }
    } else if (metadata.isPublic && doc.collection === 'profiles') {
        payload = await this.decryptData(doc.data);
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
    await this.localStore.put(doc, doc.collection);
    
    if (!doc._id.startsWith('_sovereign_') && this.sharedDocs.has(doc._id)) {
      try {
        await this.updateSharedDoc(doc, this.sharedDocs.get(doc._id)!);
      } catch (e) {
        console.error(`Failed to update shared doc copy for ${doc._id}`, e);
      }
    }
  }

  private async addToPublicIndex(metadata: ShareMetadata, collection?: string): Promise<void> {
    const doc: SyncDocument = {
      _id: `public/${metadata.sharedId}`,
      _updatedAt: Date.now(),
      data: {
        id: metadata.sharedId,
        key: metadata.encryptionKey, 
        collection: collection,
        updatedAt: Date.now()
      }
    };
    try {
        await this.sharedRemote!.put(doc);
    } catch (e) {
        console.error('Failed to update public index', e);
    }
  }

  private async removeFromPublicIndex(sharedId: string): Promise<void> {
    if (!this.sharedRemote) return;
    try {
      await this.sharedRemote.delete(`public/${sharedId}`);
    } catch (e) {
      console.error('Failed to remove from public index', e);
    }
  }

  async getPublicShares(): Promise<any[]> {
    if (!this.sharedRemote) return [];
    
    const changes = await this.sharedRemote.listChanges(new Date(0));
    const publicFiles = changes.filter(c => (c.collection === 'public' || c.id.startsWith('public/')) && c.id !== 'public/index.json');

    const results = await Promise.all(publicFiles.map(async c => {
        try {
            const doc = await this.sharedRemote!.get(c.id, c.collection);
            return doc ? doc.data : null;
        } catch (e) {
            return null;
        }
    }));
    return results.filter(r => r !== null);
  }

  async getSharedDoc(sharedId: string, key?: string): Promise<any> {
    if (!this.sharedRemote) return null;
    const doc = await this.sharedRemote.get(sharedId);
    if (!doc) return null;
    
    if (key) {
        const tempCrypto = this.getCryptoAdapter(key);
        return await tempCrypto.decrypt(doc.data);
    }
    return doc.data;
  }

  async saveSharedDocToLocal(sharedId: string, key?: string): Promise<string> {
    const plainData = await this.getSharedDoc(sharedId, key);
    if (!plainData) throw new Error('Shared document not found or decrypt failed');
    
    const newId = plainData._id || uuidv4();
    const encryptedData = await this.encryptData(plainData);
    
    const newDoc: SyncDocument = {
      _id: newId,
      _updatedAt: Date.now(),
      data: encryptedData
    };

    await this.putLocal(newDoc);
    return newId;
  }

  async connect(config: { s3?: SovereignConfig['s3'], ociParUrl?: string }): Promise<void> {
    if (!config.s3 && !config.ociParUrl) {
      throw new Error('S3 configuration or OCI PAR URL required');
    }
    
    this.config.s3 = config.s3;
    this.config.ociParUrl = config.ociParUrl;
    
    this.initRemote(this.config);

    await this.syncShares();
    await this.sync();

    if (this.config.syncIntervalMs && this.config.syncIntervalMs > 0) {
      this.startAutoSync();
    }
  }

  private async syncShares(): Promise<void> {
     if (!this.sharedRemote) return;
     
     for (const [docId, meta] of this.sharedDocs) {
       try {
         const doc = await this.localStore.get(docId);
         if (doc && !doc._deleted) {
           await this.updateSharedDoc(doc, meta);
           if (meta.isPublic) {
               await this.addToPublicIndex(meta, doc.collection);
           }
         } else if (doc && doc._deleted) {
           await this.sharedRemote.delete(meta.sharedId);
           if (meta.isPublic) {
             await this.removeFromPublicIndex(meta.sharedId);
           }
         }
       } catch (e) {
         console.error(`Failed to sync share ${docId}`, e);
       }
     }
  }

  private async encryptData(data: any): Promise<any> {
    if (!this.crypto) return data;
    return await this.crypto.encrypt(data);
  }

  private async decryptData(data: any): Promise<any> {
    if (!this.crypto) return data;
    if (typeof data !== 'string') return data;
    try {
      return await this.crypto.decrypt(data);
    } catch (e) {
      console.warn('Failed to decrypt data:', e);
      return data;
    }
  }

  async save<T>(data: T & { _id?: string }, collection?: string, explicitId?: string): Promise<string> {
    const id = explicitId || data._id || uuidv4();
    const storedData = await this.encryptData(data);

    const doc: SyncDocument<any> = {
      _id: id,
      _updatedAt: Date.now(),
      collection: collection,
      data: storedData
    };
    
    await this.putLocal(doc);
    this.emit('change', { type: 'save', id, doc });
    return id;
  }

  async get<T>(id: string, collection?: string): Promise<T | null> {
    const doc = await this.localStore.get(id, collection);
    if (!doc || doc._deleted) return null;
    
    const plainData = await this.decryptData(doc.data);
    if (typeof plainData === 'object' && plainData !== null) {
        return { ...plainData, _id: id } as T;
    }
    return plainData as T;
  }

  async getAll<T>(collection?: string): Promise<T[]> {
    const docs = await this.localStore.list(false, collection);
    const results: T[] = [];
    for (const doc of docs) {
      if (doc._id.startsWith('_sovereign_')) continue;
      const plain = await this.decryptData(doc.data);
      if (typeof plain === 'object' && plain !== null) {
          results.push({ ...plain, _id: doc._id } as T);
      } else {
          results.push(plain as T);
      }
    }
    return results;
  }

  async delete(id: string, collection?: string): Promise<void> {
    const doc = await this.localStore.get(id, collection);
    if (doc) {
      doc._deleted = true;
      doc._updatedAt = Date.now();
      await this.putLocal(doc);
      this.emit('change', { type: 'delete', id });
    }
  }

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
    if (!this.remote) return { pushed: 0, pulled: 0, errors: 0 };
    if (this.isSyncing) return { pushed: 0, pulled: 0, errors: 0 };
    this.isSyncing = true;
    const stats: SyncStats = { pushed: 0, pulled: 0, errors: 0 };

    try {
      this.emit('syncStart');
      const startSyncTime = Date.now();

      const lastSyncDate = new Date(this.lastSyncTime);
      const changes = await this.remote.listChanges(lastSyncDate);

      for (const change of changes) {
        try {
          const id = change.id;
          const collection = change.collection;
          const localDoc = await this.localStore.get(id, collection);

          if (localDoc && change.etag && localDoc._etag === change.etag) {
             continue;
          }

          const remoteDoc = await this.remote.get(id, collection);
          
          if (remoteDoc) {
            if (collection && !remoteDoc.collection) remoteDoc.collection = collection;

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

      const localChanges = await this.localStore.getChanges(this.lastSyncTime);
      
      for (const doc of localChanges) {
        if (doc._id.startsWith('_sovereign_')) continue; 
        try {
          const etag = await this.remote.put(doc, doc.collection);
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

      if (this.sharedRemote) {
        await this.syncShares(); 
      }

      await this.pullFollowedContent(stats);

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

  private async pullFollowedContent(stats: SyncStats): Promise<void> {
    const following = await this.social.getFollowing();
    for (const addr of following) {
        try {
            let followRemote: IRemoteAdapter;
            
            if (this.config.s3) {
                // S3 Mode
                followRemote = new S3RemoteAdapter({
                    region: addr.region || this.config.s3.region,
                    endpoint: addr.endpoint || this.config.s3.endpoint,
                    credentials: this.config.s3.credentials, 
                    bucketName: addr.bucket,
                    forcePathStyle: this.config.s3.forcePathStyle
                }, {
                    appId: addr.appId,
                    userId: addr.userId,
                    storeId: 'shared'
                });
            } else if (this.config.ociParUrl) {
                // OCI Mode
                // Note: For OCI PAR, we typically don't have separate credentials for other users.
                // We assume the PAR URL allows access OR the user provided a full PAR URL as the 'endpoint' in the address.
                // If the user followed an address like s3://..., that won't work with OCI PAR unless we can derive the URL.
                // OCI PAR URLs are unique per bucket/prefix. 
                // IF we are in the SAME bucket (same PAR root), we can just change the path.
                
                // Heuristic: If we are using OCI, and the followed user is in the same bucket/app, we can construct the path.
                // If they are external, we need their PAR URL.
                
                // For this demo (Single Bucket), we assume same base URL.
                followRemote = new OCIPreAuthAdapter(this.config.ociParUrl, {
                    appId: addr.appId,
                    userId: addr.userId,
                    storeId: 'shared'
                }, this.config.useManifest);
            } else {
                continue;
            }

            const changes = await followRemote.listChanges(new Date(this.lastSyncTime));
            const publicFiles = changes.filter(c => c.collection === 'public' || c.id.startsWith('public/'));

            for (const file of publicFiles) {
                const indexDoc = await followRemote.get(file.id, file.collection);
                if (!indexDoc) continue;
                
                const meta = indexDoc.data; 
                const localId = `follow_${addr.userId}_${meta.id}`;
                
                const local = await this.localStore.get(localId, 'followed_content');
                if (local && local._updatedAt >= meta.updatedAt) continue;

                const contentDoc = await followRemote.get(meta.id);
                if (contentDoc) {
                    let plainContent = contentDoc.data;
                    if (meta.key) {
                        const tempCrypto = this.getCryptoAdapter(meta.key);
                        plainContent = await tempCrypto.decrypt(contentDoc.data);
                    }

                    const encryptedForMe = await this.encryptData(plainContent);
                    await this.localStore.put({
                        _id: localId,
                        _updatedAt: meta.updatedAt,
                        collection: 'followed_content',
                        data: encryptedForMe,
                        _rev: uuidv4()
                    });
                    stats.pulled++;
                }
            }
        } catch (e) {
            console.error(`Failed to pull content from ${addr.userId}`, e);
            stats.errors++;
        }
    }
  }

  async exportData(id?: string): Promise<string> {
    let docs: SyncDocument[] = [];
    if (id) {
      const doc = await this.localStore.get(id); 
      if (doc) docs.push(doc);
    } else {
      docs = await this.localStore.list(false);
    }
    docs = docs.filter(d => !d._id.startsWith('_sovereign_'));

    const decryptedDocs = await Promise.all(docs.map(async d => {
      const plain = await this.decryptData(d.data);
      return { ...d, data: plain };
    }));

    return JSON.stringify(decryptedDocs, null, 2);
  }

  async importData(json: string): Promise<void> {
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

      const local = await this.localStore.get(doc._id, doc.collection);
      
      if (local) {
        const localPlainData = await this.decryptData(local.data);
        const importedPlainData = doc.data; 

        const mergedPlainData = local._updatedAt > doc._updatedAt 
            ? merge(importedPlainData, localPlainData) 
            : merge(localPlainData, importedPlainData);

        const mergedEncrypted = await this.encryptData(mergedPlainData);

        const mergedDoc: SyncDocument = {
            ...local,
            _updatedAt: Date.now(),
            collection: doc.collection,
            data: mergedEncrypted
        };
        
        await this.putLocal(mergedDoc);
        this.emit('change', { type: 'import', id: doc._id, doc: mergedDoc });

      } else {
        const encryptedData = await this.encryptData(doc.data);
        const newDoc: SyncDocument = {
            ...doc,
            _updatedAt: Date.now(),
            collection: doc.collection,
            data: encryptedData
        };
        await this.putLocal(newDoc);
        this.emit('change', { type: 'import', id: doc._id, doc: newDoc });
      }
    }
  }

  private async mergeDocs(local: SyncDocument, remote: SyncDocument): Promise<SyncDocument> {
    if (local._deleted && remote._deleted) return remote;
    if (local._deleted) return remote._updatedAt > local._updatedAt ? remote : local;
    if (remote._deleted) return local._updatedAt > remote._updatedAt ? local : remote;

    const localPlain = await this.decryptData(local.data);
    const remotePlain = await this.decryptData(remote.data);

    const mergedPlain = local._updatedAt > remote._updatedAt 
      ? merge(remotePlain, localPlain) 
      : merge(localPlain, remotePlain);
    
    const mergedEncrypted = await this.encryptData(mergedPlain);

    return {
      _id: local._id,
      _updatedAt: Date.now(), 
      _rev: uuidv4(),
      _etag: remote._etag, 
      collection: remote.collection || local.collection,
      data: mergedEncrypted
    };
  }
}
