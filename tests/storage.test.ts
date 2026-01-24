import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3BlobAdapter } from '../src/adapters/S3BlobAdapter';

jest.mock('../src/adapters/S3BlobAdapter');

describe('SovereignS3nc Blob Storage', () => {
  let db: SovereignS3nc;
  let mockBlobAdapter: any;

  beforeEach(async () => {
    (S3BlobAdapter as any).mockClear();
    (S3BlobAdapter.prototype as any).upload = jest.fn().mockResolvedValue('etag-blob');
    (S3BlobAdapter.prototype as any).download = jest.fn().mockImplementation((id) => Promise.resolve(new Uint8Array([1, 2, 3])));

    db = new SovereignS3nc({
      s3: {
        region: 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        bucketName: 'test-bucket'
      },
      paths: { appId: 'app', userId: 'me', storeId: 'store' },
      encryptionKey: 'master-key-000000000000000000000000'
    });

    await db.init();
    mockBlobAdapter = (S3BlobAdapter as any).mock.instances[0];
  });

  test('should upload and encrypt a blob', async () => {
    const data = new Uint8Array([10, 20, 30]);
    const meta = await db.storage.upload('test.bin', data, 'application/octet-stream');
    
    expect(meta.name).toBe('test.bin');
    expect(meta.size).toBe(3);
    
    // Verify it was uploaded to S3
    expect(mockBlobAdapter.upload).toHaveBeenCalled();
    const uploadCall = mockBlobAdapter.upload.mock.calls[0];
    const uploadedData = uploadCall[1];
    
    // Since encryption is on, uploadedData should be different from original
    expect(uploadedData).not.toEqual(data);
    expect(uploadedData.length).toBeGreaterThan(data.length); // Due to IV/Tag
  });

  test('should download and decrypt a blob', async () => {
    const originalData = new Uint8Array([1, 2, 3, 4, 5]);
    const meta = await db.storage.upload('original.bin', originalData);
    
    // Mock S3 returning the encrypted data we just "uploaded"
    const encryptedData = mockBlobAdapter.upload.mock.calls[0][1];
    mockBlobAdapter.download.mockResolvedValueOnce(encryptedData);

    const downloadedData = await db.storage.download(meta._id);
    expect(downloadedData).toEqual(originalData);
  });

  test('should list blobs', async () => {
    await db.storage.upload('file1.txt', new Uint8Array([1]));
    await db.storage.upload('file2.txt', new Uint8Array([2]));
    
    const list = await db.storage.list();
    expect(list).toHaveLength(2);
    expect(list.map(f => f.name)).toContain('file1.txt');
    expect(list.map(f => f.name)).toContain('file2.txt');
  });
});
