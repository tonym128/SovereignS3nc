import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3Config, SyncDocument, RemoteChange } from '../types';
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
  private useManifest: boolean;

  constructor(config: S3Config, paths: { appId: string, userId: string, storeId: string }, useManifest: boolean = false) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: config.credentials,
      forcePathStyle: config.forcePathStyle
    });
    this.bucket = config.bucketName;
    this.prefix = `${paths.appId}/${paths.userId}/${paths.storeId}/`;
    this.useManifest = useManifest;
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
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: JSON.stringify(doc),
      ContentType: 'application/json',
      Metadata: {
        updatedAt: doc._updatedAt.toString()
      }
    });
    const response = await this.client.send(command);
    const etag = response.ETag ? response.ETag.replace(/"/g, '') : undefined;

    if (this.useManifest && !doc._id.startsWith('public/manifest.json') && doc._id !== '_manifest.json') {
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
        const res = await this.client.send(getCmd);
        if (res.Body) {
            const str = await res.Body.transformToString();
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
    const putCmd = new PutObjectCommand({
        Bucket: this.bucket,
        Key: manifestKey,
        Body: JSON.stringify(entries),
        ContentType: 'application/json'
    });
    await this.client.send(putCmd);
  }

  async get(id: string, collection?: string): Promise<SyncDocument | null> {
    const key = this.getKey(id, collection);
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      const response = await this.client.send(command);
      if (!response.Body) return null;
      
      const str = await response.Body.transformToString();
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
    if (this.useManifest) {
        return this.listChangesFromManifest(since, collection);
    }
    
    const changes: RemoteChange[] = [];
    let continuationToken: string | undefined;
    
    let searchPrefix = this.prefix;
    if (collection) {
      searchPrefix += collection + '/';
    }

    do {
      const command: ListObjectsV2Command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: searchPrefix,
        ContinuationToken: continuationToken
      });
      
      const response = await this.client.send(command);
      
      if (response.Contents) {
        for (const item of response.Contents) {
          if (item.Key && item.LastModified && item.LastModified > since) {
            
            // Filter out manifests
            if (item.Key.endsWith('manifest.json')) continue;

            let id = '';
            let col: string | undefined = collection;
            
            if (collection) {
               id = item.Key.substring(searchPrefix.length).replace('.json', '');
            } else {
               const relative = item.Key.substring(this.prefix.length);
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
            }

            changes.push({
              id: id,
              collection: col,
              key: item.Key,
              etag: item.ETag ? item.ETag.replace(/"/g, '') : undefined,
              lastModified: item.LastModified
            });
          }
        }
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return changes;
  }

  private async listChangesFromManifest(since: Date, collection?: string): Promise<RemoteChange[]> {
      const manifestKey = this.getManifestKey(collection);
      let entries: Record<string, ManifestEntry> = {};
      
      try {
        const getCmd = new GetObjectCommand({ Bucket: this.bucket, Key: manifestKey });
        const res = await this.client.send(getCmd);
        if (res.Body) {
            const str = await res.Body.transformToString();
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
    await this.client.send(command);

    if (this.useManifest) {
        // For delete, we might want to update manifest to remove entry OR mark as deleted
        // Ideally we mark as deleted so others know to delete?
        // But our Sync Logic uses LAST_WRITE_WINS on the doc itself.
        // If we remove from manifest, others won't know it's gone unless they already have it.
        // Let's remove for now to keep manifest clean, relying on 'delete' propagation via doc tombstone?
        // Wait, if I delete the file, I can't sync the tombstone!
        // SovereignS3nc typically keeps the tombstone file.
        // So 'delete' here is usually called only if we REALLY want to remove it.
        // But in sync(), we put() the tombstone.
        // So this delete() method is likely used for 'unshare' or hard cleanup.
        // Let's update manifest to remove it.
        await this.updateManifest({ _id: id, collection, _updatedAt: Date.now(), _deleted: true } as any);
    }
  }
}
