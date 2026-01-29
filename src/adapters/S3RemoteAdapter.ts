import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3Config, SyncDocument, RemoteChange, AdapterMetrics } from '../types';
import { IRemoteAdapter } from '../interfaces/IRemoteAdapter';

interface ManifestEntry {
  id: string;
  collection?: string;
  updatedAt: number;
  etag?: string;
}

export class S3RemoteAdapter implements IRemoteAdapter {
  private client: S3Client;
  private bucket: string;
  private prefix: string;
  private metrics: AdapterMetrics = {
    requests: { get: 0, put: 0, list: 0, delete: 0, head: 0, total: 0 },
    bytes: { tx: 0, rx: 0, total: 0 }
  };

  constructor(config: S3Config, paths: { appId: string, userId: string, storeId: string }, useManifest: boolean = true) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: config.credentials,
      forcePathStyle: config.forcePathStyle
    });
    this.bucket = config.bucketName;
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

  private getKey(id: string, collection?: string): string {
    if (collection) {
      return `${this.prefix}${collection}/${id}.json`;
    }
    return `${this.prefix}${id}.json`;
  }

  private getManifestKey(collection?: string): string {
    if (collection === 'public' || this.prefix.includes('/public/')) {
        // Public manifest
        return `${this.prefix}public/manifest.json`;
    }
    // Private manifest
    return `${this.prefix}_manifest.json`;
  }

  async put(doc: SyncDocument, collection?: string): Promise<string | undefined> {
    const key = this.getKey(doc._id, collection);
    const body = JSON.stringify(doc);
    
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      Metadata: {
        updatedAt: doc._updatedAt.toString()
      }
    });
    
    this.trackRequest('put', body.length, 'tx');
    const response = await this.client.send(command);
    const etag = response.ETag ? response.ETag.replace(/"/g, '') : undefined;

    if (!doc._id.startsWith('public/manifest.json') && doc._id !== '_manifest.json') {
      await this.updateManifest(doc, etag);
    }

    return etag;
  }

  private async updateManifest(doc: SyncDocument, etag?: string): Promise<void> {
    const manifestKey = this.getManifestKey(doc.collection);
    
    // 1. Get existing
    let entries: Record<string, ManifestEntry> = {};
    try {
        const getCmd = new GetObjectCommand({ Bucket: this.bucket, Key: manifestKey });
        this.trackRequest('get', 0, 'rx'); // Track request start
        
        const res = await this.client.send(getCmd);
        if (res.Body) {
            const str = await res.Body.transformToString();
            this.metrics.bytes.rx += str.length; // Approximate bytes
            this.metrics.bytes.total += str.length;
            entries = JSON.parse(str);
        }
    } catch (e) {
        // Ignore not found
    }

    // 2. Update
    // Composite key to avoid collisions if multiple collections share one manifest
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
    const body = JSON.stringify(entries);
    const putCmd = new PutObjectCommand({
        Bucket: this.bucket,
        Key: manifestKey,
        Body: body,
        ContentType: 'application/json'
    });
    this.trackRequest('put', body.length, 'tx');
    await this.client.send(putCmd);
  }

  async get(id: string, collection?: string): Promise<SyncDocument | null> {
    const key = this.getKey(id, collection);
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      
      this.trackRequest('get', 0, 'rx');
      const response = await this.client.send(command);
      if (!response.Body) return null;
      
      const str = await response.Body.transformToString();
      this.metrics.bytes.rx += str.length;
      this.metrics.bytes.total += str.length;

      const doc = JSON.parse(str);
      
      if (response.ETag) {
        doc._etag = response.ETag.replace(/"/g, '');
      }
      return doc;
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async listChanges(since: Date, collection?: string): Promise<RemoteChange[]> {
    return this.listChangesFromManifest(since, collection);
  }

  private async listChangesFromManifest(since: Date, collection?: string): Promise<RemoteChange[]> {
      const manifestKey = this.getManifestKey(collection);
      let entries: Record<string, ManifestEntry> = {};
      
      try {
        const getCmd = new GetObjectCommand({ Bucket: this.bucket, Key: manifestKey });
        this.trackRequest('get', 0, 'rx');
        
        const res = await this.client.send(getCmd);
        if (res.Body) {
            const str = await res.Body.transformToString();
            this.metrics.bytes.rx += str.length;
            this.metrics.bytes.total += str.length;
            entries = JSON.parse(str);
        }
      } catch (e) {
          return []; // No manifest, no changes
      }

      const changes: RemoteChange[] = [];
      const sinceTime = since.getTime();

      for (const entry of Object.values(entries)) {
          if (entry.updatedAt > sinceTime) {
              if (collection && entry.collection !== collection) continue;
              
              changes.push({
                  id: entry.id,
                  collection: entry.collection,
                  key: this.getKey(entry.id, entry.collection),
                  etag: entry.etag,
                  lastModified: new Date(entry.updatedAt)
              });
          }
      }
      return changes;
  }

  async delete(id: string, collection?: string): Promise<void> {
    const key = this.getKey(id, collection);
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key
    });
    this.trackRequest('delete');
    await this.client.send(command);

    await this.updateManifest({ _id: id, collection, _updatedAt: Date.now(), _deleted: true } as any);
  }
}
