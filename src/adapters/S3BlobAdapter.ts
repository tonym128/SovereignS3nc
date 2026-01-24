import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3Config } from '../types';
import { IBlobAdapter } from '../interfaces/IBlobAdapter';

export class S3BlobAdapter implements IBlobAdapter {
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
    this.prefix = `${paths.appId}/${paths.userId}/${paths.storeId}/blobs/`;
  }

  private getKey(id: string): string {
    return `${this.prefix}${id}`;
  }

  async upload(id: string, data: Uint8Array, contentType?: string): Promise<string> {
    const key = this.getKey(id);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: contentType || 'application/octet-stream'
    });
    const response = await this.client.send(command);
    return response.ETag ? response.ETag.replace(/"/g, '') : id;
  }

  async download(id: string): Promise<Uint8Array | null> {
    const key = this.getKey(id);
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      const response = await this.client.send(command);
      if (!response.Body) return null;
      return await response.Body.transformToByteArray();
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    const key = this.getKey(id);
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key
    });
    await this.client.send(command);
  }
}
