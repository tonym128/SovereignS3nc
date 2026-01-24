import * as crypto from 'crypto';
import { ICryptoAdapter } from '../interfaces/ICryptoAdapter';

export class AESCryptoAdapter implements ICryptoAdapter {
  private key: Buffer;
  private algorithm = 'aes-256-gcm';

  constructor(secretKey: string | Buffer) {
    if (Buffer.isBuffer(secretKey)) {
      this.key = secretKey;
    } else if (Buffer.from(secretKey, 'utf-8').length !== 32) {
      this.key = crypto.createHash('sha256').update(secretKey).digest();
    } else {
      this.key = Buffer.from(secretKey, 'utf-8');
    }
  }

  async encrypt(data: any): Promise<string> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    
    const str = JSON.stringify(data);
    let encrypted = cipher.update(str, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = (cipher as any).getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  async decrypt(ciphertext: string): Promise<any> {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format');
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    
    (decipher as any).setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  }

  async encryptRaw(data: Uint8Array): Promise<Uint8Array> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = (cipher as any).getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]);
  }

  async decryptRaw(data: Uint8Array): Promise<Uint8Array> {
    const buf = Buffer.from(data);
    if (buf.length < 28) throw new Error('Invalid ciphertext length');
    
    const iv = buf.slice(0, 12);
    const authTag = buf.slice(12, 28);
    const encrypted = buf.slice(28);

    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    (decipher as any).setAuthTag(authTag);
    
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }
}