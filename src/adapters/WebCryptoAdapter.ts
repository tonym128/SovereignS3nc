import { ICryptoAdapter } from '../interfaces/ICryptoAdapter';

export class WebCryptoAdapter implements ICryptoAdapter {
  private keyStr: string;
  private key: CryptoKey | null = null;

  constructor(secretKey: string) {
    this.keyStr = secretKey;
  }

  private async initKey(): Promise<CryptoKey> {
    if (this.key) return this.key;

    const enc = new TextEncoder();
    const keyData = enc.encode(this.keyStr);
    
    // Hash to 32 bytes (SHA-256)
    const hash = await window.crypto.subtle.digest('SHA-256', keyData);
    
    this.key = await window.crypto.subtle.importKey(
      'raw',
      hash,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    return this.key;
  }

  async encrypt(data: any): Promise<string> {
    const key = await this.initKey();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encodedData = enc.encode(JSON.stringify(data));

    const ciphertextWithTag = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encodedData
    );

    // WebCrypto returns Ciphertext + Tag appended
    const buf = new Uint8Array(ciphertextWithTag);
    const tagLength = 16; // AES-GCM tag length is usually 128 bits (16 bytes)
    const ciphertext = buf.slice(0, buf.length - tagLength);
    const tag = buf.slice(buf.length - tagLength);

    return `${this.toHex(iv)}:${this.toHex(tag)}:${this.toHex(ciphertext)}`;
  }

  async decrypt(ciphertextStr: string): Promise<any> {
    const key = await this.initKey();
    const parts = ciphertextStr.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format');
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = this.fromHex(ivHex);
    const tag = this.fromHex(authTagHex);
    const encrypted = this.fromHex(encryptedHex);

    // Combine encrypted + tag for WebCrypto
    const combined = new Uint8Array(encrypted.length + tag.length);
    combined.set(encrypted);
    combined.set(tag, encrypted.length);

    const decryptedBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as any },
      key,
      combined
    );

    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decryptedBuf));
  }

  private toHex(arr: Uint8Array): string {
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private fromHex(hex: string): Uint8Array {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      arr[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return arr;
  }
}
