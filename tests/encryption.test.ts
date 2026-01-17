import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';

jest.mock('../src/adapters/S3RemoteAdapter');

describe('SovereignS3nc Encryption', () => {
  let db: SovereignS3nc;
  const encryptionKey = 'my-super-secret-key-that-is-long';

  beforeEach(() => {
    (S3RemoteAdapter as any).mockClear();
    (S3RemoteAdapter.prototype as any).put = jest.fn().mockResolvedValue('etag');
    (S3RemoteAdapter.prototype as any).get = jest.fn().mockResolvedValue(null);
    (S3RemoteAdapter.prototype as any).listChanges = jest.fn().mockResolvedValue([]);
    
    db = new SovereignS3nc({
      s3: { region: 'test', credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, bucketName: 'bucket' },
      paths: { appId: 'app', userId: 'user', storeId: 'store' },
      syncIntervalMs: 0,
      encryptionKey: encryptionKey
    });
  });

  test('should transparently encrypt and decrypt data', async () => {
    await db.init();
    
    // Save plain data
    const id = await db.save({ secret: 'message' });
    
    // Retrieve plain data
    const doc = await db.get<any>(id);
    expect(doc.secret).toBe('message');

    // Verify internal storage is encrypted
    const rawDoc = await (db as any).localStore.get(id);
    expect(typeof rawDoc.data).toBe('string');
    expect(rawDoc.data).not.toContain('message'); // Should be ciphertext
    expect(rawDoc.data).toContain(':'); // IV:Tag:Cipher format
  });

  test('should sync encrypted data', async () => {
    await db.init();
    await db.save({ secret: 'sync me' });
    
    await db.sync();

    // Verify put was called with ENCRYPTED data
    const putMock = (S3RemoteAdapter.prototype as any).put;
    const callArgs = putMock.mock.calls[0];
    const sentDoc = callArgs[0];

    expect(typeof sentDoc.data).toBe('string');
    expect(sentDoc.data).not.toContain('sync me');
  });

  test('should export decrypted data', async () => {
    await db.init();
    await db.save({ secret: 'export me' });
    
          const json = await db.exportData();    const parsed = JSON.parse(json);
    
    // Export should be plain text
    expect(parsed[0].data.secret).toBe('export me');
  });

  test('should import and encrypt data', async () => {
    await db.init();
    
    // Import plain data
    const importData = [{ _id: 'imp-1', data: { secret: 'imported' }, _updatedAt: 100 }];
    await db.importData(JSON.stringify(importData));

    // Verify stored as encrypted
    const raw = await (db as any).localStore.get('imp-1');
    expect(typeof raw.data).toBe('string');
    expect(raw.data).not.toContain('imported');

    // Verify retrieval works
    const doc = await db.get<any>('imp-1');
    expect(doc.secret).toBe('imported');
  });
});
