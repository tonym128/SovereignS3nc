import { ICryptoAdapter } from '../interfaces/ICryptoAdapter';

export class WebCryptoAdapter implements ICryptoAdapter {
  private keyData: string | Uint8Array;
  private key: CryptoKey | null = null;

  constructor(secretKey: string | Uint8Array) {
    this.keyData = secretKey;
  }

  private get crypto(): Crypto {
      if (typeof window !== 'undefined' && window.crypto) return window.crypto;
      if (typeof self !== 'undefined' && self.crypto) return self.crypto;
      throw new Error('WebCrypto API not available in this environment');
  }

  private async initKey(): Promise<CryptoKey> {
    if (this.key) return this.key;

    if (this.keyData instanceof Uint8Array) {
       this.key = await this.crypto.subtle.importKey(
        'raw',
        this.keyData as BufferSource,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );
    } else {
      const enc = new TextEncoder();
      const keyData = enc.encode(this.keyData);
      
      const hash = await this.crypto.subtle.digest('SHA-256', keyData);
      
      this.key = await this.crypto.subtle.importKey(
        'raw',
        hash,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );
    }
    return this.key;
  }

  async encrypt(data: any): Promise<string> {
    const enc = new TextEncoder();
    const encodedData = enc.encode(JSON.stringify(data));
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const key = await this.initKey();

    const ciphertextWithTag = await this.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encodedData
    );

    const buf = new Uint8Array(ciphertextWithTag);
    const tagLength = 16;
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

    const combined = new Uint8Array(encrypted.length + tag.length);
    combined.set(encrypted);
    combined.set(tag, encrypted.length);

    const decryptedBuf = await this.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as any },
      key,
      combined
    );

    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decryptedBuf));
  }

  async encryptRaw(data: Uint8Array): Promise<Uint8Array> {
    const key = await this.initKey();
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    
    const ciphertextWithTag = await this.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      data as any
    );

    const combined = new Uint8Array(12 + ciphertextWithTag.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertextWithTag), 12);
    return combined;
  }

  async decryptRaw(data: Uint8Array): Promise<Uint8Array> {
    const key = await this.initKey();
    const iv = data.slice(0, 12);
    const ciphertextWithTag = data.slice(12);

    const decryptedBuf = await this.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as any },
      key,
      ciphertextWithTag
    );

    return new Uint8Array(decryptedBuf);
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