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

  private getUrl(id: string, collection?: string): string {
    if (collection) {
      return `${this.baseUrl}/${this.prefix}${collection}/${id}.json`;
    }
    return `${this.baseUrl}/${this.prefix}${id}.json`;
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

    const etag = response.headers.get('etag');
    return etag ? etag.replace(/"/g, '') : undefined;
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

  async delete(id: string, collection?: string): Promise<void> {
    const url = this.getUrl(id, collection);
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      throw new Error(`OCI PAR Delete Failed: ${response.statusText}`);
    }
  }
}