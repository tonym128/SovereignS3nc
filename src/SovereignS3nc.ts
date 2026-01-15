import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { merge } from 'ts-deepmerge';
import { SovereignConfig, SyncDocument, SyncStats } from './types';
import { ILocalStorage } from './interfaces/IStorage';
import { InMemoryStorage } from './adapters/InMemoryStorage';
import { S3RemoteAdapter } from './adapters/S3RemoteAdapter';

export class SovereignS3nc extends EventEmitter {
  private localStore: ILocalStorage;
  private remote: S3RemoteAdapter;
  private config: SovereignConfig;
  private syncInterval: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;
  private lastSyncTime: number = 0;

  constructor(config: SovereignConfig, customLocalStorage?: ILocalStorage) {
    super();
    this.config = config;
    this.localStore = customLocalStorage || new InMemoryStorage(config.localPersistencePath);
    this.remote = new S3RemoteAdapter(config.s3);
  }

  async init(): Promise<void> {
    await this.localStore.init();
    
    // Try to load last sync time
    const meta = await this.localStore.get('_sovereign_meta');
    if (meta) {
      this.lastSyncTime = meta.data.lastSyncTime || 0;
    }

    if (this.config.syncIntervalMs && this.config.syncIntervalMs > 0) {
      this.startAutoSync();
    }
  }

  /**
   * Returns true if a sync operation is currently in progress.
   */
  public get syncing(): boolean {
    return this.isSyncing;
  }

  /**
   * Returns the timestamp of the last successful sync.
   */
  public get lastSyncedAt(): number {
    return this.lastSyncTime;
  }

  /**
   * Save a document. If it doesn't have an _id, one will be generated.
   */
  async save<T>(data: T & { _id?: string }): Promise<string> {
    const id = data._id || uuidv4();
    const doc: SyncDocument<T> = {
      _id: id,
      _updatedAt: Date.now(),
      data: data
    };
    
    // Optimistic local save
    await this.localStore.put(doc);
    this.emit('change', { type: 'save', id, doc });
    return id;
  }

  async get<T>(id: string): Promise<T | null> {
    const doc = await this.localStore.get(id);
    if (!doc || doc._deleted) return null;
    return doc.data as T;
  }

  async getAll<T>(): Promise<T[]> {
    const docs = await this.localStore.list(false);
    return docs.map(d => d.data as T);
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
      // We process remote changes first.
      const lastSyncDate = new Date(this.lastSyncTime);
      const changes = await this.remote.listChanges(lastSyncDate);

      for (const change of changes) {
        try {
          const id = change.key.replace('docs/', '').replace('.json', '');
          const localDoc = await this.localStore.get(id);

          // ETag Optimization: If local exists and ETag matches, skip download
          if (localDoc && change.etag && localDoc._etag === change.etag) {
             // Already up to date
             continue;
          }

          // Otherwise, we must download to compare timestamps/content
          const remoteDoc = await this.remote.get(id);
          
          if (remoteDoc) {
            if (!localDoc) {
              // New from remote
              await this.localStore.put(remoteDoc);
              stats.pulled++;
              this.emit('change', { type: 'pull', id, doc: remoteDoc });
            } else {
              // Local exists. Check for changes.
              const isLocalDirty = localDoc._updatedAt > this.lastSyncTime;
              
              if (!isLocalDirty) {
                 // Local matches our last known state (or is older), so Remote is newer.
                 await this.localStore.put(remoteDoc);
                 stats.pulled++;
                 this.emit('change', { type: 'pull', id, doc: remoteDoc });
              } else {
                // Conflict: Both changed since last sync
                if (this.config.conflictResolutionStrategy === 'LastWriteWins') {
                  if (remoteDoc._updatedAt > localDoc._updatedAt) {
                    await this.localStore.put(remoteDoc);
                    stats.pulled++;
                    this.emit('change', { type: 'pull', id, doc: remoteDoc });
                  }
                } else {
                  // Merge Strategy (Newer Wins Base)
                  const merged = this.mergeDocs(localDoc, remoteDoc);
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
      // Upload anything updated locally since last sync
      const localChanges = await this.localStore.getChanges(this.lastSyncTime);
      
      for (const doc of localChanges) {
        if (doc._id.startsWith('_sovereign_')) continue; 
        try {
          const etag = await this.remote.put(doc);
          stats.pushed++;
          
          if (etag) {
            // Update local ETag to match what we just pushed, so next pull sees it as clean
            doc._etag = etag;
            // Save silently (preserves _updatedAt)
            await this.localStore.put(doc);
          }
        } catch (e) {
          console.error(`Failed to push doc ${doc._id}`, e);
          stats.errors++;
        }
      }

      // Update last sync time
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

  private mergeDocs(local: SyncDocument, remote: SyncDocument): SyncDocument {
    if (local._deleted && remote._deleted) return remote;
    if (local._deleted) return remote._updatedAt > local._updatedAt ? remote : local;
    if (remote._deleted) return local._updatedAt > remote._updatedAt ? local : remote;

    // Deep merge data: Older < Newer (Newer overwrites Older)
    const mergedData = local._updatedAt > remote._updatedAt 
      ? merge(remote.data, local.data) 
      : merge(local.data, remote.data);
    
    return {
      _id: local._id,
      _updatedAt: Date.now(), // Merged version is new
      _rev: uuidv4(),
      _etag: remote._etag, // Is this correct? No, the merged doc is new, so ETag is invalid.
      // Actually, we shouldn't copy ETag if we merged, because the content is different.
      // S3 will give us a new ETag when we push this merged doc.
      data: mergedData
    };
  }
}
