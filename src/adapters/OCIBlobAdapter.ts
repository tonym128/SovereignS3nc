import { IBlobAdapter } from '../interfaces/IBlobAdapter';

export class OCIBlobAdapter implements IBlobAdapter {
  private baseUrl: string;
  private prefix: string;

  constructor(parUrl: string, paths: { appId: string, userId: string, storeId: string }) {
    this.baseUrl = parUrl.endsWith('/') ? parUrl.slice(0, -1) : parUrl;
    this.prefix = `${paths.appId}/${paths.userId}/${paths.storeId}/blobs/`;
  }

  private getUrl(id: string): string {
    return `${this.baseUrl}/${this.prefix}${id}`;
  }

  async upload(id: string, data: Uint8Array, contentType?: string): Promise<string> {
    const url = this.getUrl(id);
    const response = await fetch(url, {
      method: 'PUT',
      body: data as any,
      headers: {
        'Content-Type': contentType || 'application/octet-stream'
      }
    });

    if (!response.ok) {
      throw new Error(`OCI Blob Upload Failed: ${response.statusText}`);
    }

    const etag = response.headers.get('etag');
    return etag ? etag.replace(/"/g, '') : id;
  }

  async download(id: string): Promise<Uint8Array | null> {
    const url = this.getUrl(id);
    const response = await fetch(url);
    
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`OCI Blob Download Failed: ${response.statusText}`);

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async delete(id: string): Promise<void> {
    const url = this.getUrl(id);
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      throw new Error(`OCI Blob Delete Failed: ${response.statusText}`);
    }
  }
}
