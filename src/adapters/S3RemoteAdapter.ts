import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { S3Config } from '../types';
import { IRemoteAdapter } from '../interfaces/IRemoteAdapter';
import * as crypto from 'crypto';

export class S3RemoteAdapter implements IRemoteAdapter {
  private client: S3Client;
  private bucket: string;
  private prefix: string;

  constructor(config: S3Config, paths: { appId: string, userId: string, storeId: string }) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint || undefined,
      credentials: config.credentials,
      forcePathStyle: true, // Always use path style to avoid ListBucket calls for bucket resolution
      apiVersion: '2006-03-01'
    });
    this.bucket = config.bucketName;
    this.prefix = `${paths.appId}/${paths.userId}/${paths.storeId}/`;
  }

  async uploadFile(path: string, data: Uint8Array, providedHash?: string): Promise<void> {
    const key = this.getKey(path);
    console.log(`[S3] Uploading to key: ${key}`);
    const hash = providedHash || crypto.createHash('sha256').update(data).digest('hex');
    
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      Metadata: {
          'hash': hash
      }
    }));
  }

  async downloadFile(path: string): Promise<Uint8Array | null> {
    const key = this.getKey(path);
    try {
        const response = await this.client.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: key
        }));
        if (!response.Body) return null;
        return await response.Body.transformToByteArray();
    } catch (e: any) {
        const statusCode = e.$metadata?.httpStatusCode;
        
        if (statusCode === 403) {
            console.warn(`[S3] Access Denied (403) for ${key}. This usually means the file doesn't exist AND ListBucket is disabled, OR you truly lack read permissions.`);
            return null;
        }
        if (e.name === 'NoSuchKey' || statusCode === 404) {
            return null;
        }
        throw e;
    }
  }

  async getFileHash(path: string): Promise<string | null> {
     const key = this.getKey(path);
     try {
         const response = await this.client.send(new HeadObjectCommand({
             Bucket: this.bucket,
             Key: key
         }));
         const hash = response.Metadata?.hash || null;
         if (!hash) console.warn(`[S3] File ${key} exists but is missing 'hash' metadata. Check CORS 'ExposeHeaders'.`);
         return hash;
     } catch (e: any) {
         const statusCode = e.$metadata?.httpStatusCode;
         if (statusCode === 403 || e.name === 'NoSuchKey' || statusCode === 404) {
             return null;
         }
         throw e;
     }
  }

  private getKey(path: string): string {
      return `${this.prefix}${path}`;
  }
}
