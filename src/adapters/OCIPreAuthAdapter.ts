import { IRemoteAdapter } from '../interfaces/IRemoteAdapter';
import { SyncDocument, RemoteChange } from '../types';

interface ManifestEntry {
  id: string;
  collection?: string;
  updatedAt: number;
  etag?: string;
}

export class OCIPreAuthAdapter implements IRemoteAdapter {
  private baseUrl: string;
  private prefix: string;

  constructor(parUrl: string, paths: { appId: string, userId: string, storeId: string }, useManifest: boolean = true) {
    this.baseUrl = parUrl.endsWith('/') ? parUrl.slice(0, -1) : parUrl;
    this.prefix = `${paths.appId}/${paths.userId}/${paths.storeId}/`;
  }

  private getUrl(id: string, collection?: string): string {
    if (collection) {
      return `${this.baseUrl}/${this.prefix}${collection}/${id}.json`;
    }
    return `${this.baseUrl}/${this.prefix}${id}.json`;
  }

  private getManifestUrl(collection?: string): string {
    if (collection === 'public' || this.prefix.includes('/public/')) {
        return `${this.baseUrl}/${this.prefix}public/manifest.json`;
    }
    return `${this.baseUrl}/${this.prefix}_manifest.json`;
  }

  async put(doc: SyncDocument, collection?: string): Promise<string | undefined> {
    const url = this.getUrl(doc._id, collection);
    const response = await fetch(url, {
      method: 'PUT',
      body: JSON.stringify(doc),
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`OCI PAR Put Failed: ${response.statusText}`);
    }

    const etag = response.headers.get('etag')?.replace(/"/g, '');

    if (!doc._id.startsWith('public/manifest.json') && doc._id !== '_manifest.json') {
      await this.updateManifest(doc, etag);
    }

    return etag;
  }

  private async updateManifest(doc: SyncDocument, etag?: string): Promise<void> {
    const manifestUrl = this.getManifestUrl(doc.collection);
    
    // 1. Get existing
    let entries: Record<string, ManifestEntry> = {};
    try {
        const res = await fetch(manifestUrl);
        if (res.ok) {
            entries = await res.json();
        }
    } catch (e) { }

    // 2. Update
    const entryKey = doc.collection ? `${doc.collection}::${doc._id}` : doc._id;
    
    if (doc._deleted) {
        delete entries[entryKey];
    } else {
        entries[entryKey] = {
            id: doc._id,
            collection: doc.collection,
            updatedAt: doc._updatedAt,
            etag: etag
        };
    }

    // 3. Save
    try {
        await fetch(manifestUrl, {
            method: 'PUT',
            body: JSON.stringify(entries),
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        console.error('Failed to update manifest', e);
        // We do not throw here to avoid blocking the main save operation
        // In a real app, we might want to queue this for retry
    }
  }

  async get(id: string, collection?: string): Promise<SyncDocument | null> {
    const url = this.getUrl(id, collection);
    const response = await fetch(url);
    
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`OCI PAR Get Failed: ${response.statusText}`);

    const doc = await response.json();
    const etag = response.headers.get('etag');
    if (etag) {
      doc._etag = etag.replace(/"/g, '');
    }
    return doc;
  }

  async listChanges(since: Date, collection?: string): Promise<RemoteChange[]> {
    return this.listChangesFromManifest(since, collection);
  }

  private async listChangesFromManifest(since: Date, collection?: string): Promise<RemoteChange[]> {
      const manifestUrl = this.getManifestUrl(collection);
      let entries: Record<string, ManifestEntry> = {};
      
      try {
        const res = await fetch(manifestUrl);
        if (res.ok) {
            entries = await res.json();
        }
      } catch (e) {
          return [];
      }

      const changes: RemoteChange[] = [];
      const sinceTime = since.getTime();

      for (const entry of Object.values(entries)) {
          if (entry.updatedAt > sinceTime) {
              if (collection && entry.collection !== collection) continue;
              
              changes.push({
                  id: entry.id,
                  collection: entry.collection,
                  key: `manifest:${entry.id}`, 
                  etag: entry.etag,
                  lastModified: new Date(entry.updatedAt)
              });
          }
      }
      return changes;
  }

  async delete(id: string, collection?: string): Promise<void> {
    const url = this.getUrl(id, collection);
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      throw new Error(`OCI PAR Delete Failed: ${response.statusText}`);
    }

    await this.updateManifest({ _id: id, collection, _updatedAt: Date.now(), _deleted: true } as any);
  }
}
