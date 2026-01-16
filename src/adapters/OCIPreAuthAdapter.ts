import { IRemoteAdapter } from '../interfaces/IRemoteAdapter';
import { SyncDocument, RemoteChange } from '../types';

export class OCIPreAuthAdapter implements IRemoteAdapter {
  private baseUrl: string;
  private prefix: string;

  constructor(parUrl: string, paths: { appId: string, userId: string, storeId: string }) {
    // Ensure URL does NOT end with /
    this.baseUrl = parUrl.endsWith('/') ? parUrl.slice(0, -1) : parUrl;
    this.prefix = `${paths.appId}/${paths.userId}/${paths.storeId}/`;
  }

  private getUrl(id: string): string {
    return `${this.baseUrl}/${this.prefix}${id}.json`;
  }

  async put(doc: SyncDocument): Promise<string | undefined> {
    const url = this.getUrl(doc._id);
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

    const etag = response.headers.get('etag');
    return etag ? etag.replace(/"/g, '') : undefined;
  }

  async get(id: string): Promise<SyncDocument | null> {
    const url = this.getUrl(id);
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

  async listChanges(since: Date): Promise<RemoteChange[]> {
    // OCI List Objects: GET {parUrl}?prefix={prefix}&fields=name,etag,timeModified
    // Note: The PAR URL itself points to /o/. We append query params.
    
    const params = new URLSearchParams({
      prefix: this.prefix,
      fields: 'name,etag,timeModified'
    });
    
    // OCI API paging not implemented for brevity, but needed for production
    const response = await fetch(`${this.baseUrl}?${params.toString()}`);
    
    if (!response.ok) {
      // If 404, maybe bucket empty or wrong URL?
      return []; 
    }

    const data = await response.json();
    // Expected format: { "objects": [ ... ] }
    if (!data.objects) return [];

    const changes: RemoteChange[] = [];
    
    for (const obj of data.objects) {
      const lastModified = new Date(obj.timeModified);
      if (lastModified > since) {
        // name includes prefix? Yes.
        const key = obj.name;
        // Extract ID: prefix/{id}.json
        // Verify it starts with prefix
        if (key.startsWith(this.prefix)) {
             const id = key.substring(this.prefix.length).replace('.json', '');
             changes.push({
               id,
               key,
               etag: obj.etag ? obj.etag.replace(/"/g, '') : undefined,
               lastModified
             });
        }
      }
    }
    
    return changes;
  }

  async delete(id: string): Promise<void> {
    const url = this.getUrl(id);
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      throw new Error(`OCI PAR Delete Failed: ${response.statusText}`);
    }
  }
}
