import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';
import { SyncDocument } from '../src/types';

jest.mock('../src/adapters/S3RemoteAdapter');

describe('Document ID Assignment', () => {
  let db: SovereignS3nc;
  const paths = { appId: 'my-app', userId: 'user-1', storeId: 'store-1' };

  beforeEach(() => {
    (S3RemoteAdapter as any).mockClear();
    (S3RemoteAdapter.prototype as any).put = jest.fn().mockResolvedValue('etag');
    (S3RemoteAdapter.prototype as any).get = jest.fn().mockResolvedValue(null);
    (S3RemoteAdapter.prototype as any).listChanges = jest.fn().mockResolvedValue([]);
    
    db = new SovereignS3nc({
      s3: { region: 'test', credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, bucketName: 'bucket' },
      paths: paths,
      syncIntervalMs: 0
    });
  });

  test('should assign a unique ID if none is provided', async () => {
    await db.init();
    
    // Save without ID
    const id1 = await db.save({ content: 'doc 1' });
    const id2 = await db.save({ content: 'doc 2' });

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
    expect(typeof id1).toBe('string');
    expect(id1.length).toBeGreaterThan(0);

    // Verify stored
    const doc1 = await db.get(id1);
    expect(doc1).toBeDefined();
  });

  test('should use the assigned ID for S3 synchronization path', async () => {
    await db.init();
    
    const id = await db.save({ content: 'test path' });
    
    // Trigger sync
    await db.sync();

    // Verify S3Adapter.put was called
    const putMock = (S3RemoteAdapter.prototype as any).put;
    expect(putMock).toHaveBeenCalled();

    // Check the document passed to put()
    const callArgs = putMock.mock.calls[0];
    const docArg: SyncDocument = callArgs[0];
    
    expect(docArg._id).toBe(id);
    
    // Verify the S3 Remote Adapter uses this ID to construct the key.
    // Since we mock the adapter class, we can't check the private logic inside it directly 
    // unless we check what the mock *would* have done, or we assume the previous test covers it.
    // But we can check if our logic sends the correct doc._id.
    
    // To verify the KEY generation, we'd need to test S3RemoteAdapter in isolation 
    // or rely on the fact that S3RemoteAdapter.put is called with the doc that HAS the _id.
  });

  test('should respect provided ID', async () => {
    await db.init();
    const customId = 'my-custom-id';
    
    const id = await db.save({ _id: customId, content: 'custom' });
    
    expect(id).toBe(customId);
    
    const doc = await db.get(customId);
    expect(doc).toBeDefined();
  });
});
