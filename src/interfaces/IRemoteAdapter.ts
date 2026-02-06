export interface IRemoteAdapter {
  uploadFile(path: string, data: Uint8Array): Promise<void>;
  downloadFile(path: string): Promise<Uint8Array | null>;
  getFileHash(path: string): Promise<string | null>;
}
