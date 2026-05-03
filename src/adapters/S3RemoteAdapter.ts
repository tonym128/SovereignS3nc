import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3Config } from '../types';
import { IRemoteAdapter, DownloadResult } from '../interfaces/IRemoteAdapter';
import { Logger } from '../utils/Logger';
import { env } from '../utils/Environment';
import * as crypto from 'crypto';
import { NetworkError } from '../utils/Errors';

export class S3RemoteAdapter implements IRemoteAdapter {
  private client: S3Client;
  private bucket: string;
  private prefix: string;
  private endpoint: string;
  private supportsMetadataHash: boolean = true; // Optimization flag for backends like RustFS

  constructor(config: S3Config, paths: { appId: string, userId: string, storeId: string }) {
    Logger.debug('S3', `Initializing adapter for ${paths.userId}...`);
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
    Logger.debug('S3', `Client created for ${paths.userId}`);
    this.bucket = config.bucketName;
    
    // Construct prefix, ignoring empty parts to support root-level access
    const pathParts = [paths.appId, paths.userId, paths.storeId].filter(p => p !== undefined && p !== null && p.trim() !== '');
    if (pathParts.length > 0) {
        this.prefix = `${pathParts.join('/')}/`;
    } else {
        this.prefix = '';
    }
    Logger.info('S3', `Adapter initialized with prefix: ${this.prefix}`);
  }

  /**
   * Helper to execute S3 operations with exponential backoff.
   */
  private async withRetry<T>(operation: () => Promise<T>, label: string, maxRetries: number = 3): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (e: any) {
        lastError = e;
        const statusCode = e.$metadata?.httpStatusCode;

        // Don't retry for these status codes
        if (statusCode === 403 || statusCode === 404 || statusCode === 304 || e.name === 'NoSuchKey') {
          throw e;
        }

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 10000);
          Logger.warn('S3', `${label} failed (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${Math.round(delay)}ms... Error: ${e.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  async uploadFile(path: string, data: Uint8Array, providedHash?: string, customMetadata?: Record<string, string>): Promise<string | null> {
    const key = this.getKey(path);
    Logger.debug('S3', `Uploading to key: ${key}`);
    
    let hash = providedHash;
    if (!hash) {
        const subtle = env.getSubtleCrypto();
        if (subtle) {
            Logger.debug('S3', 'Using SubtleCrypto for hashing');
            const hashBuffer = await subtle.digest('SHA-256', data as any);
            hash = Array.from(new Uint8Array(hashBuffer))
                .map((b: number) => b.toString(16).padStart(2, '0'))
                .join('');
        } else {
            Logger.debug('S3', 'Using crypto-browserify for hashing');
            hash = crypto.createHash('sha256').update(data).digest('hex');
        }
    }
    
    const response = await this.withRetry(() => this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      Metadata: {
          'hash': hash,
          ...(customMetadata || {})
      }
    })), `Upload ${key}`);
    return response.ETag || null;
  }

  async downloadFile(path: string, ifNoneMatch?: string, timeout: number = 15000): Promise<DownloadResult | null> {
    const key = this.getKey(path);
    Logger.debug('S3', `Starting download from S3: ${key} (If-None-Match: ${ifNoneMatch || 'none'}, timeout: ${timeout}ms)`);
    
    return this.withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const command = new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
                IfNoneMatch: (ifNoneMatch && ifNoneMatch !== '') ? ifNoneMatch : undefined
            });
            
            const response = await this.client.send(command, { abortSignal: controller.signal as any });
            
            clearTimeout(timeoutId);
            if (!response.Body) {
                return { data: null, etag: response.ETag || null };
            }
            
            const data = await response.Body.transformToByteArray();
            return { data, etag: response.ETag || null };
        } catch (e: any) {
            clearTimeout(timeoutId);
            const statusCode = e.$metadata?.httpStatusCode;

            if (statusCode === 304) {
                return { data: null, etag: ifNoneMatch || null, notModified: true };
            }

            if (e.name === 'AbortError') {
                Logger.error('S3', `Download timed out for ${key}`);
                throw new NetworkError(`S3 Download Timeout for ${key}`);
            }

            if (statusCode === 403 || e.name === 'NoSuchKey' || statusCode === 404) {
                return null;
            }
            throw e;
        }
    }, `Download ${key}`);
  }

  async getFileHash(path: string): Promise<string | null> {
     // If we've already detected that metadata hashes aren't supported, 
     // fallback to ETag immediately to save a HeadObject call (if we can)
     // and reduce log noise.
     if (!this.supportsMetadataHash) {
         return this.getFileEtag(path);
     }

     const key = this.getKey(path);
     try {
         const response = await this.withRetry(() => this.client.send(new HeadObjectCommand({
             Bucket: this.bucket,
             Key: key
         })), `GetHash ${key}`);
         
         const hash = response.Metadata?.hash || null;
         
         if (!hash) {
             // Backend exists but doesn't have our custom hash. 
             // Mark this connection as not supporting hashes to avoid future noise.
             Logger.info('S3', `Metadata 'hash' missing for ${key}. Falling back to ETag for this session.`);
             this.supportsMetadataHash = false;
             return response.ETag || null;
         }
         
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
          const response = await this.withRetry(() => this.client.send(new HeadObjectCommand({
              Bucket: this.bucket,
              Key: key
          })), `GetEtag ${key}`);
          return response.ETag || null;
      } catch (e: any) {
          const statusCode = e.$metadata?.httpStatusCode;
          if (statusCode === 403 || e.name === 'NoSuchKey' || statusCode === 404) {
              return null;
          }
          throw e;
      }
  }

  async getFileMetadata(path: string, key: string): Promise<string | null> {
      const fullKey = this.getKey(path);
      try {
          const response = await this.withRetry(() => this.client.send(new HeadObjectCommand({
              Bucket: this.bucket,
              Key: fullKey
          })), `GetMetadata ${fullKey}`);
          return response.Metadata?.[key] || null;
      } catch (e: any) {
          return null;
      }
  }

  async canWrite(path: string): Promise<boolean> {
      const key = this.getKey(path.endsWith('/') ? `${path}.probe` : `${path}/.probe`);
      try {
          // Probe: Try to write a tiny hidden file to the path/prefix
          const sentinel = new TextEncoder().encode(JSON.stringify({ probe: Date.now() }));
          await this.withRetry(() => this.client.send(new PutObjectCommand({
              Bucket: this.bucket,
              Key: key,
              Body: sentinel,
              ContentType: 'application/json'
          })), `WriteProbe ${key}`);
          return true;
      } catch (e: any) {
          // 403 Forbidden or 405 Method Not Allowed means we don't have write access
          return false;
      }
  }

  async listFiles(prefix: string): Promise<string[]> {
      // Ensure we don't double-prefix
      let fullPrefix = prefix;
      if (!prefix.startsWith(this.prefix)) {
          fullPrefix = this.getKey(prefix);
      }
      
      Logger.debug('S3', `Listing files for prefix: ${fullPrefix} (original: ${prefix}, adapter prefix: ${this.prefix})`);
      
      const keys: string[] = [];
      let continuationToken: string | undefined = undefined;

      try {
          let hasMore = true;
          while (hasMore) {
              const command = new ListObjectsV2Command({
                  Bucket: this.bucket,
                  Prefix: fullPrefix,
                  ContinuationToken: continuationToken
              });
              
              const response: any = await this.withRetry(() => this.client.send(command), `ListObjects ${fullPrefix}`);
              
              if (response.Contents) {
                  for (const item of response.Contents) {
                      if (item.Key) {
                          // Strip the adapter prefix to return relative paths
                          const relativePath = item.Key.startsWith(this.prefix) 
                            ? item.Key.substring(this.prefix.length) 
                            : item.Key;
                            
                          if (relativePath && relativePath !== '') {
                              keys.push(relativePath);
                          }
                      }
                  }
              }
              continuationToken = response.NextContinuationToken;
              hasMore = response.IsTruncated || false;
          }
      } catch (e: any) {
          Logger.warn('S3', `Failed to list files for prefix ${prefix}: ${e.message}`);
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
          await this.withRetry(() => this.client.send(command), `Delete ${key}`);
          Logger.debug('S3', `Deleted file: ${key}`);
      } catch (e: any) {
          Logger.warn('S3', `Failed to delete file ${key}: ${e.message}`);
      }
  }

  async purge(): Promise<void> {
    Logger.info('S3', `Purging all data in bucket ${this.bucket} under prefix ${this.prefix}...`);
    const files = await this.listFiles('');
    for (const file of files) {
        await this.deleteFile(file);
    }
    Logger.info('S3', `Purge complete. ${files.length} files deleted.`);
  }

  private getKey(path: string): string {
      // Safety check: ensure path doesn't try to escape the prefix (e.g. via ../)
      if (path.includes('..')) {
          throw new NetworkError(`Security Violation: Path '${path}' contains parent directory references.`);
      }
      return `${this.prefix}${path}`;
  }
}
