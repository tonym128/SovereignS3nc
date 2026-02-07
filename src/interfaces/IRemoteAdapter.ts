export interface IRemoteAdapter {
  uploadFile(path: string, data: Uint8Array, hash?: string): Promise<void>;
  downloadFile(path: string): Promise<Uint8Array | null>;
  getFileHash(path: string): Promise<string | null>;
}
