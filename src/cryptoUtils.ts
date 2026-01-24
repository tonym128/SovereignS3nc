import { ICryptoAdapter } from './interfaces/ICryptoAdapter';
import { AESCryptoAdapter } from './adapters/AESCryptoAdapter';
import { WebCryptoAdapter } from './adapters/WebCryptoAdapter';
import { nodeCrypto } from './utils/nodeCrypto';

export async function deriveKey(passphrase: string, salt: string): Promise<Uint8Array | Buffer> {
  const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
  const iterations = 100000;
  const keyLength = 32;

  if (isBrowser) {
    const enc = new TextEncoder();
    const passwordKey = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    const derivedBits = await window.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: enc.encode(salt),
        iterations,
        hash: 'SHA-256'
      },
      passwordKey,
      keyLength * 8
    );

    return new Uint8Array(derivedBits);
  } else {
    const crypto = await nodeCrypto();
    if (!crypto) throw new Error('Node crypto module not available');
    
    return new Promise((resolve, reject) => {
        crypto.pbkdf2(passphrase, salt, iterations, keyLength, 'sha256', (err, derivedKey) => {
            if (err) reject(err);
            else resolve(derivedKey);
        });
    });
  }
}

export function createCryptoAdapter(key: Uint8Array | Buffer): ICryptoAdapter {
    const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
    if (isBrowser) {
        return new WebCryptoAdapter(key as Uint8Array);
    } else {
        return new AESCryptoAdapter(key as Buffer);
    }
}
