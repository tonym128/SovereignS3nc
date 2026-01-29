import { IRemoteAdapter } from '../interfaces/IRemoteAdapter';
import { SyncDocument, RemoteChange, AdapterMetrics } from '../types';

interface ManifestEntry {
  id: string;
  collection?: string;
  updatedAt: number;
  etag?: string;
}

export class OCIPreAuthAdapter implements IRemoteAdapter {
  private baseUrl: string;
  private prefix: string;
  private metrics: AdapterMetrics = {
    requests: { get: 0, put: 0, list: 0, delete: 0, head: 0, total: 0 },
    bytes: { tx: 0, rx: 0, total: 0 }
  };

  constructor(parUrl: string, paths: { appId: string, userId: string, storeId: string }, useManifest: boolean = true) {
    this.baseUrl = parUrl.endsWith('/') ? parUrl.slice(0, -1) : parUrl;
    this.prefix = `${paths.appId}/${paths.userId}/${paths.storeId}/`;
  }

  public getMetrics(): AdapterMetrics {
      return this.metrics;
  }

  private trackRequest(type: keyof AdapterMetrics['requests'], bytes: number = 0, direction: 'tx' | 'rx' = 'tx') {
      this.metrics.requests[type]++;
      this.metrics.requests.total++;
      if (bytes > 0) {
          this.metrics.bytes[direction] += bytes;
          this.metrics.bytes.total += bytes;
      }
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
    const body = JSON.stringify(doc);
    
    const response = await fetch(url, {
      method: 'PUT',
      body: body,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    this.trackRequest('put', body.length, 'tx');

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
        this.trackRequest('get', 0, 'rx');
        const res = await fetch(manifestUrl);
        if (res.ok) {
            const blob = await res.blob();
            this.metrics.bytes.rx += blob.size;
            this.metrics.bytes.total += blob.size;
            
            const text = await blob.text();
            entries = JSON.parse(text);
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
        const body = JSON.stringify(entries);
        await fetch(manifestUrl, {
            method: 'PUT',
            body: body,
            headers: { 'Content-Type': 'application/json' }
        });
        this.trackRequest('put', body.length, 'tx');
    } catch (e) {
        console.error('Failed to update manifest', e);
        // We do not throw here to avoid blocking the main save operation
        // In a real app, we might want to queue this for retry
    }
  }

  async get(id: string, collection?: string): Promise<SyncDocument | null> {
    const url = this.getUrl(id, collection);
    
    this.trackRequest('get', 0, 'rx');
    const response = await fetch(url);
    
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`OCI PAR Get Failed: ${response.statusText}`);

    const blob = await response.blob();
    this.metrics.bytes.rx += blob.size;
    this.metrics.bytes.total += blob.size;
    
    const text = await blob.text();
    const doc = JSON.parse(text);

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
        this.trackRequest('get', 0, 'rx');
        const res = await fetch(manifestUrl);
        if (res.ok) {
            const blob = await res.blob();
            this.metrics.bytes.rx += blob.size;
            this.metrics.bytes.total += blob.size;
            const text = await blob.text();
            entries = JSON.parse(text);
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
    this.trackRequest('delete');
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      throw new Error(`OCI PAR Delete Failed: ${response.statusText}`);
    }

    await this.updateManifest({ _id: id, collection, _updatedAt: Date.now(), _deleted: true } as any);
  }
}
