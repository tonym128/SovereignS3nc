export interface IBlobAdapter {
  upload(id: string, data: Uint8Array, contentType?: string): Promise<string>; // Returns ETag/Identifier
  download(id: string): Promise<Uint8Array | null>;
  delete(id: string): Promise<void>;
}
