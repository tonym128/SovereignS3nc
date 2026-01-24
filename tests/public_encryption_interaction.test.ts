import { SovereignS3nc } from '../src/SovereignS3nc';

describe('Public Key Encryption Interaction', () => {
  let alice: SovereignS3nc;
  let bob: SovereignS3nc;
  let eve: SovereignS3nc;

  const publicPassphrase = 'our-shared-secret-community-key';

  beforeEach(async () => {
    // Alice
    alice = new SovereignS3nc({
      paths: { appId: 'app', userId: 'alice', storeId: 'store' },
      auth: { privatePassphrase: 'alice-private', publicPassphrase },
      syncIntervalMs: 0
    });
    await alice.init();

    // Bob (Same public key)
    bob = new SovereignS3nc({
      paths: { appId: 'app', userId: 'bob', storeId: 'store' },
      auth: { privatePassphrase: 'bob-private', publicPassphrase },
      syncIntervalMs: 0
    });
    await bob.init();

    // Eve (Different public key)
    eve = new SovereignS3nc({
      paths: { appId: 'app', userId: 'eve', storeId: 'store' },
      auth: { privatePassphrase: 'eve-private', publicPassphrase: 'wrong-key' },
      syncIntervalMs: 0
    });
    await eve.init();
  });

  test('Alice should encrypt data that Bob can decrypt', async () => {
    const message = { text: 'Hello Bob', secret: 42 };
    
    // Alice encrypts
    const encrypted = await alice.encryptPublic(message);
    expect(typeof encrypted).toBe('string');
    expect(encrypted).not.toContain('Hello Bob');

    // Bob decrypts
    const decrypted = await bob.decryptPublic(encrypted);
    expect(decrypted).toEqual(message);
  });

  test('Eve should NOT be able to decrypt Alice\'s data', async () => {
    const message = { text: 'Secret for Bob' };
    const encrypted = await alice.encryptPublic(message);

    // Eve tries to decrypt
    // decryptPublic catches errors and returns the original data (ciphertext)
    const result = await eve.decryptPublic(encrypted);
    expect(result).toBe(encrypted);
    expect(result).not.toEqual(message);
  });

  test('Alice can decrypt her own public data', async () => {
    const message = 'Note to self';
    const encrypted = await alice.encryptPublic(message);
    const decrypted = await alice.decryptPublic(encrypted);
    expect(decrypted).toBe(message);
  });
  
  test('encryptPublicRaw/decryptPublicRaw compatibility', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = await alice.encryptPublicRaw(data);
      expect(encrypted).not.toEqual(data);
      
      const decrypted = await bob.decryptPublicRaw(encrypted);
      expect(decrypted).toEqual(data);
      
      // Raw decryption throws on failure
      await expect(eve.decryptPublicRaw(encrypted)).rejects.toThrow();
  });
});