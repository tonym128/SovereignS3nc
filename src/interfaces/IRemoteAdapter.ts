export interface DownloadResult {
  data: Uint8Array | null;
  etag: string | null;
  notModified?: boolean;
}

export interface IRemoteAdapter {
  uploadFile(path: string, data: Uint8Array, hash?: string, metadata?: Record<string, string>): Promise<string | null>; // Returns ETag
  downloadFile(path: string, ifNoneMatch?: string, timeout?: number): Promise<DownloadResult | null>;
  getFileHash(path: string): Promise<string | null>;
  getFileEtag(path: string): Promise<string | null>;
  getFileMetadata?(path: string, key: string): Promise<string | null>;

  /**
   * Check if the current adapter has write permissions for a specific path or prefix.
   */
  canWrite(path: string): Promise<boolean>;

  /**
   * List all files under a specific prefix.
   */
  listFiles?(prefix: string): Promise<string[]>;

  /**
   * Permanently delete all data associated with the current appId/scope.
   */
  purge?(): Promise<void>;
  }
