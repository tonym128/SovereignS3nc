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
      endpoint: config.endpoint,
      credentials: config.credentials,
      forcePathStyle: config.forcePathStyle
    });
    this.bucket = config.bucketName;
    this.prefix = `${paths.appId}/${paths.userId}/${paths.storeId}/`;
  }

  async uploadFile(path: string, data: Uint8Array): Promise<void> {
    const key = this.getKey(path);
    console.log(`[S3] Uploading to key: ${key}`);
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    
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
    console.log(`[S3] Downloading key: ${key}`);
    try {
        const response = await this.client.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: key
        }));
        if (!response.Body) return null;
        return await response.Body.transformToByteArray();
    } catch (e: any) {
        if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
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
         return response.Metadata?.hash || null;
     } catch (e: any) {
         if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
         throw e;
     }
  }

  private getKey(path: string): string {
      return `${this.prefix}${path}`;
  }
}
