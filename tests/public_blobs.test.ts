import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3BlobAdapter } from '../src/adapters/S3BlobAdapter';

jest.mock('../src/adapters/S3BlobAdapter');

describe('SovereignS3nc Public vs Private Blobs', () => {
  let db: SovereignS3nc;
  let mockBlobAdapter: any;

  beforeEach(async () => {
    (S3BlobAdapter as any).mockClear();
    (S3BlobAdapter.prototype as any).upload = jest.fn().mockResolvedValue('etag-blob');
    // Mock download to return whatever was uploaded last
    (S3BlobAdapter.prototype as any).download = jest.fn().mockImplementation((id) => {
       // Find the upload call for this ID?
       // Simplification: We will mock return values in tests
       return Promise.resolve(new Uint8Array([]));
    });

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

  test('should encrypt private blobs by default', async () => {
    const data = new Uint8Array([1, 2, 3]);
    await db.storage.upload('private.bin', data);

    const uploadCall = mockBlobAdapter.upload.mock.calls[0];
    const uploadedData = uploadCall[1];

    // Encrypted data should be larger/different
    expect(uploadedData).not.toEqual(data);
    expect(uploadedData.length).toBeGreaterThan(data.length);
  });

  test('should NOT encrypt public blobs', async () => {
    const data = new Uint8Array([1, 2, 3]);
    await db.storage.upload('public-avatar.png', data, 'image/png', true); // isPublic = true

    const uploadCall = mockBlobAdapter.upload.mock.calls[0];
    const uploadedData = uploadCall[1];

    // Public data should be identical to input
    expect(uploadedData).toEqual(data);
  });

  test('should correctly download public blob without decryption', async () => {
    const data = new Uint8Array([10, 20, 30]);
    // 1. Upload public
    const meta = await db.storage.upload('public.bin', data, 'application/octet-stream', true);
    
    // 2. Mock download returning RAW data (since it wasn't encrypted)
    mockBlobAdapter.download.mockResolvedValueOnce(data);

    // 3. Download
    const result = await db.storage.download(meta._id);
    
    // Should match exactly
    expect(result).toEqual(data);
  });
});
