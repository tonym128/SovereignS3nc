import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3Config } from '../types';
import { IRemoteAdapter, DownloadResult } from '../interfaces/IRemoteAdapter';
import { Logger } from '../utils/Logger';
import * as crypto from 'crypto';

export class S3RemoteAdapter implements IRemoteAdapter {
  private client: S3Client;
  private bucket: string;
  private prefix: string;
  private endpoint: string;

  constructor(config: S3Config, paths: { appId: string, userId: string, storeId: string }) {
    Logger.debug(`[S3] Initializing adapter for ${paths.userId}...`);
    this.endpoint = config.endpoint || '';
    
    // Support both nested credentials object and flat config (from dev.sh)
    const credentials = config.credentials || {
        accessKeyId: (config as any).accessKeyId,
        secretAccessKey: (config as any).secretAccessKey
    };

    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint || undefined,
      credentials,
      forcePathStyle: true,
      apiVersion: '2006-03-01',
      requestHandler: {
        requestTimeout: 10000 
      }
    });
    Logger.debug(`[S3] Client created for ${paths.userId}`);
    this.bucket = config.bucketName;
    
    // Construct prefix, ignoring empty parts to support root-level access
    const pathParts = [paths.appId, paths.userId, paths.storeId].filter(p => p && p.trim() !== '');
    this.prefix = pathParts.length > 0 ? `${pathParts.join('/')}/` : '';
  }

  async uploadFile(path: string, data: Uint8Array, providedHash?: string): Promise<string | null> {
    const key = this.getKey(path);
    Logger.debug(`[S3] Uploading to key: ${key}`);
    
    let hash = providedHash;
    if (!hash) {
        const browserCrypto = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : null;
        if (browserCrypto && browserCrypto.subtle) {
            Logger.debug('[S3] Using SubtleCrypto for hashing');
            const hashBuffer = await browserCrypto.subtle.digest('SHA-256', data);
            hash = Array.from(new Uint8Array(hashBuffer))
                .map((b: number) => b.toString(16).padStart(2, '0'))
                .join('');
        } else {
            Logger.debug('[S3] Using crypto-browserify for hashing');
            hash = crypto.createHash('sha256').update(data).digest('hex');
        }
    }
    
    const response = await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      Metadata: {
          'hash': hash
      }
    }));
    return response.ETag || null;
  }

  async downloadFile(path: string, ifNoneMatch?: string, timeout: number = 15000): Promise<DownloadResult | null> {
    const key = this.getKey(path);
    Logger.debug(`[S3] Step 4.1: Starting download from S3: ${key} (If-None-Match: ${ifNoneMatch || 'none'}, timeout: ${timeout}ms)`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        Logger.debug(`[S3] Step 4.2: Creating GetObjectCommand for ${key}...`);
        
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
            IfNoneMatch: ifNoneMatch
        });
        
        Logger.debug(`[S3] Step 4.2.1: Sending command to client for ${key}...`);
        const response = await this.client.send(command, { abortSignal: controller.signal as any });
        
        clearTimeout(timeoutId); // Success, clear it
        Logger.debug(`[S3] Step 4.3: Response received for ${key}.`);
        if (!response.Body) {
            return { data: null, etag: response.ETag || null };
        }
        
        Logger.debug(`[S3] Step 4.4: Transforming body to byte array for ${key}...`);
        const data = await response.Body.transformToByteArray();
        Logger.debug(`[S3] Step 4.5: Download complete for ${key}. Size: ${data.length} bytes`);
        return { data, etag: response.ETag || null };
    } catch (e: any) {
        clearTimeout(timeoutId);
        
        const statusCode = e.$metadata?.httpStatusCode;

        if (statusCode === 304) {
            Logger.debug(`[S3] File ${key} not modified (304).`);
            return { data: null, etag: ifNoneMatch || null, notModified: true };
        }

        if (e.name === 'AbortError') {
            console.error(`[S3] Step 4.6: Request timed out for ${key}`);
            throw new Error(`S3 Download Timeout for ${key}`);
        }
        Logger.debug(`[S3] Step 4.6: Download catch block for ${key}. Error: ${e.name} - ${e.message}`);
        
        if (statusCode === 403) {
            Logger.warn(`[S3] Access Denied (403) for ${key}. This usually means the file doesn't exist AND ListBucket is disabled, OR you truly lack read permissions.`);
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
         if (!hash) Logger.warn(`[S3] File ${key} exists but is missing 'hash' metadata. Check CORS 'ExposeHeaders'.`);
         return hash;
     } catch (e: any) {
         const statusCode = e.$metadata?.httpStatusCode;
         if (statusCode === 403 || e.name === 'NoSuchKey' || statusCode === 404) {
             return null;
         }
         throw e;
     }
  }

  async getFileEtag(path: string): Promise<string | null> {
      const key = this.getKey(path);
      try {
          const response = await this.client.send(new HeadObjectCommand({
              Bucket: this.bucket,
              Key: key
          }));
          return response.ETag || null;
      } catch (e: any) {
          const statusCode = e.$metadata?.httpStatusCode;
          if (statusCode === 403 || e.name === 'NoSuchKey' || statusCode === 404) {
              return null;
          }
          throw e;
      }
  }

  async canWrite(path: string): Promise<boolean> {
      const key = this.getKey(path.endsWith('/') ? `${path}.probe` : `${path}/.probe`);
      try {
          // Probe: Try to write a tiny hidden file to the path/prefix
          const sentinel = new TextEncoder().encode(JSON.stringify({ probe: Date.now() }));
          await this.client.send(new PutObjectCommand({
              Bucket: this.bucket,
              Key: key,
              Body: sentinel,
              ContentType: 'application/json'
          }));
          return true;
      } catch (e: any) {
          // 403 Forbidden or 405 Method Not Allowed means we don't have write access
          return false;
      }
  }

  async listFiles(prefix: string): Promise<string[]> {
      const fullPrefix = this.getKey(prefix);
      const keys: string[] = [];
      let continuationToken: string | undefined = undefined;

      try {
          do {
              const command = new ListObjectsV2Command({
                  Bucket: this.bucket,
                  Prefix: fullPrefix,
                  ContinuationToken: continuationToken
              });
              const response = await this.client.send(command);
              if (response.Contents) {
                  for (const item of response.Contents) {
                      if (item.Key) {
                          // Strip the adapter prefix to return relative paths
                          const relativePath = item.Key.substring(this.prefix.length);
                          keys.push(relativePath);
                      }
                  }
              }
              continuationToken = response.NextContinuationToken;
          } while (continuationToken);
      } catch (e: any) {
          Logger.warn(`[S3] Failed to list files for prefix ${prefix}: ${e.message}`);
      }

      return keys;
  }

  async deleteFile(path: string): Promise<void> {
      const key = this.getKey(path);
      try {
          const command = new DeleteObjectCommand({
              Bucket: this.bucket,
              Key: key
          });
          await this.client.send(command);
          Logger.debug(`[S3] Deleted file: ${key}`);
      } catch (e: any) {
          Logger.warn(`[S3] Failed to delete file ${key}: ${e.message}`);
      }
  }

  private getKey(path: string): string {
      return `${this.prefix}${path}`;
  }
}
