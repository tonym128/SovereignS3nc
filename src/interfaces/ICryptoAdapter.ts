export interface ICryptoAdapter {
  encrypt(data: any): Promise<string>;
  decrypt(ciphertext: string): Promise<any>;
}
