import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3Config, SyncDocument, RemoteChange } from '../types';
import { IRemoteAdapter } from '../interfaces/IRemoteAdapter';

export class S3RemoteAdapter implements IRemoteAdapter {
  private client: S3Client;
  private bucket: string;
  private prefix: string;

  constructor(config: S3Config, paths: { appId: string, userId: string, storeId: string }) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: config.credentials,
      forcePathStyle: config.forcePathStyle
    });
    this.bucket = config.bucketName;
    // Ensure trailing slash
    this.prefix = `${paths.appId}/${paths.userId}/${paths.storeId}/`;
  }

  private getKey(id: string, collection?: string): string {
    if (collection) {
      return `${this.prefix}${collection}/${id}.json`;
    }
    return `${this.prefix}${id}.json`;
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
    return response.ETag ? response.ETag.replace(/"/g, '') : undefined;
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
            
            let id = '';
            let col: string | undefined = collection;
            
            if (collection) {
               // Key is prefix/collection/id.json
               id = item.Key.substring(searchPrefix.length).replace('.json', '');
            } else {
               // Key is prefix/...
               const relative = item.Key.substring(this.prefix.length);
               const parts = relative.split('/');
               
               if (parts.length === 2) {
                 // collection/id.json
                 col = parts[0];
                 id = parts[1].replace('.json', '');
               } else if (parts.length === 1) {
                 // id.json
                 col = undefined;
                 id = parts[0].replace('.json', '');
               } else {
                 // Skip deep nesting or other files
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

  async delete(id: string, collection?: string): Promise<void> {
    const key = this.getKey(id, collection);
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key
    });
    await this.client.send(command);
  }
}