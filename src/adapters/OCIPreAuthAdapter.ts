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
  private useManifest: boolean = false; // Add support if needed, assuming user wants it

  constructor(parUrl: string, paths: { appId: string, userId: string, storeId: string }, useManifest: boolean = false) {
    this.baseUrl = parUrl.endsWith('/') ? parUrl.slice(0, -1) : parUrl;
    this.prefix = `${paths.appId}/${paths.userId}/${paths.storeId}/`;
    this.useManifest = useManifest;
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

    if (this.useManifest && !doc._id.startsWith('public/manifest.json') && doc._id !== '_manifest.json') {
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
    await fetch(manifestUrl, {
        method: 'PUT',
        body: JSON.stringify(entries),
        headers: { 'Content-Type': 'application/json' }
    });
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
    if (this.useManifest) {
        return this.listChangesFromManifest(since, collection);
    }

    let searchPrefix = this.prefix;
    if (collection) {
        searchPrefix += collection + '/';
    }

    const params = new URLSearchParams({
      prefix: searchPrefix,
      fields: 'name,etag,timeModified'
    });
    
    const response = await fetch(`${this.baseUrl}?${params.toString()}`);
    
    if (!response.ok) {
      return []; 
    }

    const data = await response.json();
    if (!data.objects) return [];

    const changes: RemoteChange[] = [];
    
    for (const obj of data.objects) {
      const lastModified = new Date(obj.timeModified);
      if (lastModified > since) {
        const key = obj.name;
        if (key.endsWith('manifest.json')) continue;

        let id = '';
        let col: string | undefined = collection;
        
        if (collection) {
           if (key.startsWith(searchPrefix)) {
             id = key.substring(searchPrefix.length).replace('.json', '');
           } else {
               continue; 
           }
        } else {
           if (key.startsWith(this.prefix)) {
              const relative = key.substring(this.prefix.length);
              const parts = relative.split('/');
              if (parts.length === 2) {
                  col = parts[0];
                  id = parts[1].replace('.json', '');
              } else if (parts.length === 1) {
                  col = undefined;
                  id = parts[0].replace('.json', '');
              } else {
                  continue;
              }
           } else {
               continue;
           }
        }
        
        changes.push({
            id,
            collection: col,
            key,
            etag: obj.etag ? obj.etag.replace(/"/g, '') : undefined,
            lastModified
        });
      }
    }
    
    return changes;
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

    if (this.useManifest) {
        await this.updateManifest({ _id: id, collection, _updatedAt: Date.now(), _deleted: true } as any);
    }
  }
}
