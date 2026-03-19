export interface DownloadResult {
  data: Uint8Array | null;
  etag: string | null;
  notModified?: boolean;
}

export interface IRemoteAdapter {
  uploadFile(path: string, data: Uint8Array, hash?: string): Promise<string | null>; // Returns ETag
  downloadFile(path: string, ifNoneMatch?: string): Promise<DownloadResult | null>;
  getFileHash(path: string): Promise<string | null>;
  getFileEtag(path: string): Promise<string | null>;
}
