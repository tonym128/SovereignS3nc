import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3Config, SyncDocument, RemoteChange } from '../types';
import { Readable } from 'stream';

export class S3RemoteAdapter {
  private client: S3Client;
  private bucket: string;

  constructor(config: S3Config) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: config.credentials,
      forcePathStyle: config.forcePathStyle
    });
    this.bucket = config.bucketName;
  }

  async put(doc: SyncDocument): Promise<string | undefined> {
    const key = `docs/${doc._id}.json`;
    // Clean doc before upload? We might want to NOT send _etag back to S3 inside the JSON 
    // to keep it clean, but for simplicity we send it. 
    // S3 calculates its own ETag on the content.
    
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
    // Remove quotes from ETag if present (S3 often returns "\"hash\"")
    return response.ETag ? response.ETag.replace(/