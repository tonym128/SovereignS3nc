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
  collection?: string;
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
  public sharedRemote?: IRemoteAdapter; 
  public globalRemote?: IRemoteAdapter;
  public readonly config: SovereignConfig;
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
      const isLocal = config.s3.endpoint.includes('localhost') || config.s3.endpoint.includes('127.0.0.1');
      if (!isLocal) {
        console.warn(
          'SECURITY WARNING: You are using an insecure HTTP endpoint. ' + 
          'Your User IDs and Store IDs (GUIDs) are visible in cleartext network traffic. ' +
          'Please use HTTPS to ensure the "Security via Obscurity" model holds.'
        );
      }
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
      this.globalRemote = new OCIPreAuthAdapter(config.ociParUrl, {
        appId: config.paths.appId,
        userId: 'shared',
        storeId: 'global'
      });
    } else if (config.s3) {
      this.remote = new S3RemoteAdapter(config.s3, config.paths, config.useManifest);
      this.blobs = new S3BlobAdapter(config.s3, config.paths);
      this.sharedRemote = new S3RemoteAdapter(config.s3, {
        appId: config.paths.appId,
        userId: config.paths.userId,
        storeId: 'shared'
      }, config.useManifest);
      this.globalRemote = new S3RemoteAdapter(config.s3, {
        appId: config.paths.appId,
        userId: 'shared',
        storeId: 'global'
      });
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
      existing.collection = doc.collection; // Ensure collection is up to date
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
      isPublic,
      collection: doc.collection
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
        await this.sharedRemote.delete(metadata.sharedId, metadata.collection);
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
      collection: doc.collection,
      data: payload
    };
    await this.sharedRemote.put(sharedDoc, doc.collection);
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

  async getSharedDoc(sharedId: string, key?: string, collection?: string): Promise<any> {
    if (!this.sharedRemote) return null;
    const doc = await this.sharedRemote.get(sharedId, collection);
    if (!doc) return null;
    
    if (key) {
        const tempCrypto = this.getCryptoAdapter(key);
        return await tempCrypto.decrypt(doc.data);
    }
    return doc.data;
  }

  async saveSharedDocToLocal(sharedId: string, key?: string, collection?: string): Promise<string> {
    const plainData = await this.getSharedDoc(sharedId, key, collection);
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
           await this.sharedRemote.delete(meta.sharedId, meta.collection);
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

            const changes = await followRemote.listChanges(new Date(0));
            // We pull all content from followed users. 
            // The 'listChanges' ensures we only see what is in their manifest.
            const contentToPull = changes.filter(c => c.id !== 'public/index.json' && !c.id.startsWith('_sovereign_'));

            for (const file of contentToPull) {
                const indexDoc = await followRemote.get(file.id, file.collection);
                if (!indexDoc) continue;
                
                // If it's a "public" share metadata, it wraps the actual content key/id
                // But for regular posts, the doc IS the content.
                // We need to distinguish between "Shared Metadata" (which points to encrypted content)
                // and "Direct Content" (like posts/comments which might be plaintext or encrypted).
                
                // In the current architecture:
                // 1. "Public Shares" (via db.share) create a metadata doc in 'public/' which points to the real doc.
                // 2. "Posts" (via demo) are just saved to 'posts' collection. They are NOT explicitly "shared" via db.share() in the demo code (except profile).
                //    Wait, in demo/src/app.ts: `await db.collection('posts').save(...)`. This is private by default.
                //    If it's private, `followRemote` (which uses the USER'S path) can access it IF the S3 policy allows.
                //    Assuming the follower has read access to the user's bucket path (security via obscurity/shared key),
                //    then `indexDoc` is the Post itself.
                
                // The existing logic inside this loop assumes `indexDoc.data` contains `id`, `key`, `updatedAt` (metadata structure).
                // THIS IS WRONG for direct content like Posts!
                
                // We need to handle two cases:
                // A) Public Share Metadata (collection == 'public') -> fetch content it points to.
                // B) Direct Content (posts, comments) -> fetch and save directly.
                
                let docToSave = indexDoc;
                let dataToSave = indexDoc.data;

                if (file.collection === 'public' || file.id.startsWith('public/')) {
                     // Case A: Dereference
                     const meta = indexDoc.data; 
                     if (meta.id) {
                         const contentDoc = await followRemote.get(meta.id, meta.collection);
                         if (contentDoc) {
                             if (meta.key) {
                                 const tempCrypto = this.getCryptoAdapter(meta.key);
                                 dataToSave = await tempCrypto.decrypt(contentDoc.data);
                             } else {
                                 dataToSave = contentDoc.data;
                             }
                             // Use original update time from meta to stay in sync
                             docToSave = { ...contentDoc, _updatedAt: meta.updatedAt };
                         } else {
                             continue;
                         }
                     }
                } else {
                    // Case B: Direct content (e.g. posts)
                    // If the followed user encrypted it with THEIR key, we can't read it unless we have their key.
                    // The demo uses `db.save` which uses the user's `encryptionKey`.
                    // If `encryptionKey` is set (it is in demo), posts are encrypted.
                    // Followers DO NOT have the user's private key.
                    // THEREFORE, for followers to see posts, the posts MUST be:
                    // 1. Unencrypted (public write)
                    // 2. OR Encrypted with a shared key (Public Share)
                    
                    // In the demo, `db` is init with `encryptionKey`.
                    // `db.collection('posts').save` encrypts it.
                    // Follower downloads it. Follower tries to decrypt with THEIR key? No.
                    // Follower stores it as `followed_content`.
                    // When displaying, `SocialManager.getFeed` reads it.
                    // `db.getAll` decrypts with LOCAL key.
                    // So: Followed content MUST be re-encrypted for the follower OR stored plaintext.
                    
                    // IF the user simply saves to 'posts', it is encrypted with User A's key.
                    // User B downloads it. User B cannot decrypt it.
                    
                    // FIX: The demo app MUST save posts as "Public" (unencrypted) OR explicitly share them.
                    // In `demo/src/app.ts`, `save` is used. 
                    // `SovereignS3nc.save` encrypts.
                    
                    // I will check `StorageManager.upload` in `SovereignS3nc.ts`. It supports `isPublic`.
                    // But `Collection.save` does not support `isPublic` flag in the current `save` signature (it just takes `data`).
                    
                    // However, `SovereignS3nc.save` method is:
                    // async save<T>(data: T & { _id?: string }, collection?: string, explicitId?: string): Promise<string>
                    // It unconditionally calls `encryptData`.
                    
                    // To support public posts in the social demo, I should probably:
                    // 1. Allow `save` to skip encryption (maybe via a config or flag).
                    // 2. OR Update the demo to use `share` mechanism for posts.
                    
                    // Given the user wants "Feed Visibility", and the existing code in `pullFollowedContent` was designed for "Public Shares" (dereferencing),
                    // it seems the INTENDED pattern was:
                    // User A `shares` the post -> Metadata in `public/`.
                    // User B sees metadata -> Downloads content -> Re-encrypts for themselves.
                    
                    // BUT, the demo app just does `db.collection('posts').save(...)`.
                    // It does NOT call `share`.
                    
                    // OPTION 1: Update Demo to call `db.share(id, true)` after posting.
                    // This creates the `public/` metadata.
                    // Then `pullFollowedContent` (with my fix to allow non-public files? No, if it uses share, it uses public/ collection).
                    // Wait, if I use `share`, the METADATA is in `public/`.
                    // The EXISTING `pullFollowedContent` logic handled `public/` correctly.
                    // So why didn't it work?
                    // Because the demo app DID NOT CALL `share` for posts!
                    
                    // So, I should update the demo to share posts.
                    // AND I should update `pullFollowedContent` to be robust.
                    
                    // However, if I want to support "following" in a raw sense (seeing their 'posts' collection),
                    // they must be unencrypted.
                    
                    // Let's assume for this "Social Network" demo, posts should be PUBLIC (unencrypted).
                    // I will modify `SovereignS3nc.ts` to allow `save` to accept an `unencrypted` flag?
                    // Or easier: Update demo to use `db.share`.
                    
                    // Let's update `pullFollowedContent` to handle the case where the user simply `saves` (if we change save to be unencrypted).
                    // BUT `save` encrypts.
                    
                    // Correct approach for this architecture:
                    // 1. Demo App: After `save('posts')`, call `share(id, true)`.
                    // 2. `pullFollowedContent`: The existing logic handles `public/` items.
                    
                    // So, if I fix the demo to `share` posts, the feed should appear.
                    // AND `pullFollowedContent` needs to correctly identifying the ID/collection from the share metadata.
                    
                    // Let's look at `pullFollowedContent` again.
                    // `const changes = await followRemote.listChanges(...)`
                    // `const publicFiles = changes.filter(...)`
                    
                    // If I share a post, `S3RemoteAdapter` puts a file in `public/`.
                    // `listChanges` sees it.
                    // `pullFollowedContent` sees it.
                    // It gets `indexDoc` (the metadata).
                    // `indexDoc.data` has `key` (encryption key for the content) and `id` (content ID).
                    // It fetches content, decrypts with `key`, re-encrypts with `this` user's key, and saves to `followed_content`.
                    
                    // THIS IS CORRECT.
                    
                    // So the missing piece is simply: **The demo app is not sharing posts.**
                    
                    // I will ALSO refine `pullFollowedContent` to be safe against non-metadata files if I open up the filter.
                    // But if I strictly stick to the "Share" model, I don't need to open the filter much, just ensure it works.
                    
                    // WAIT. The user said: "I don't see other peoples feeds when I follow them."
                    // If I update the demo to share, new posts will show. Old posts won't (unless I share them).
                    // That's acceptable.
                    
                    // I will ALSO implement the "Sync on Tab Change" etc.
                    
                    // Let's first update `pullFollowedContent` to be slightly more permissive or robust, just in case.
                    // Actually, the current logic is:
                    // `const publicFiles = changes.filter(c => c.collection === 'public' || c.id.startsWith('public/'));`
                    // This expects the *Change* to be in `public`.
                    // `db.share(..., true)` puts the metadata in `public/`.
                    // So this works.
                    
                    // CONCLUSION: The main fix for visibility is in `demo/src/app.ts` (calling share).
                    // I will NOT modify `pullFollowedContent` logic deeply if it is correct for the Share model.
                    // However, `contentToPull` implies I might want to pull other things.
                    // For now, I will stick to the Share model.
                    
                    // Wait, `pullFollowedContent` in `src/SovereignS3nc.ts` has a logic bug?
                    /*
                    const local = await this.localStore.get(localId, 'followed_content');
                    if (local && local._updatedAt >= meta.updatedAt) continue;
                    */
                    // This looks okay.
                    
                    // Let's proceed with updating `demo/src/app.ts` first to add `share`.
                    // But wait, the user also wants "Edit and Delete".
                    // Editing a shared post: Update local, then `share` updates the public metadata/content?
                    // `updateSharedDoc` handles updating the remote content.
                    
                    // Let's refine `demo/src/app.ts` extensively.
                }
                
                const meta = indexDoc.data; 
                // Check if this looks like a ShareMetadata object (has id and updatedAt)
                if (!meta || !meta.id || !meta.updatedAt) {
                    // This might be a raw file if we allowed non-public. 
                    // For now, if it's not metadata, skip or handle as raw.
                    // Since we are fixing the demo to use share, we expect metadata.
                    continue;
                }

                const localId = `follow_${addr.userId}_${meta.id}`;
                
                const local = await this.localStore.get(localId, 'followed_content');
                if (local && local._updatedAt >= meta.updatedAt) continue;

                const contentDoc = await followRemote.get(meta.id, meta.collection); // Pass collection if available in meta
                if (contentDoc) {
                    let plainContent = contentDoc.data;
                    if (meta.key) {
                        const tempCrypto = this.getCryptoAdapter(meta.key);
                        plainContent = await tempCrypto.decrypt(contentDoc.data);
                    } else if (docToSave.collection === 'profiles') {
                         // Profiles are public but maybe encrypted with user key?
                         // In `updateSharedDoc`, profiles are decrypted before upload if public.
                         // So `contentDoc.data` should be plaintext if it came from `public/` logic?
                         // Wait, `updateSharedDoc` puts `payload` into `sharedRemote`.
                         // If `isPublic` and `profiles`, `payload` is `decryptData(doc.data)`. So it is PLAINTEXT.
                         // So we don't need to decrypt `contentDoc.data`.
                         plainContent = contentDoc.data;
                    }

                    const encryptedForMe = await this.encryptData(plainContent);
                    await this.localStore.put({
                        _id: localId,
                        _updatedAt: meta.updatedAt,
                        collection: 'followed_content',
                        data: encryptedForMe,
                        _rev: uuidv4(),
                        // Store extra metadata to help with UI
                        // e.g. original author
                        // But `plainContent` (the Post) has `authorId`.
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
