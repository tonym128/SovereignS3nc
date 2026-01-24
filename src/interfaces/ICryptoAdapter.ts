export interface ICryptoAdapter {
  encrypt(data: any): Promise<string>;
  decrypt(ciphertext: string): Promise<any>;
  encryptRaw(data: Uint8Array): Promise<Uint8Array>;
  decryptRaw(ciphertext: Uint8Array): Promise<Uint8Array>;
}