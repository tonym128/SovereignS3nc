import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';

jest.mock('../src/adapters/S3RemoteAdapter');

describe('SovereignS3nc Manifest Mode', () => {
  let db: SovereignS3nc;
  let mockRemote: any;

  beforeEach(async () => {
    (S3RemoteAdapter as any).mockClear();
    // Default mocks
    (S3RemoteAdapter.prototype as any).put = jest.fn().mockResolvedValue('etag-123');
    (S3RemoteAdapter.prototype as any).get = jest.fn().mockResolvedValue(null);
    (S3RemoteAdapter.prototype as any).listChanges = jest.fn().mockResolvedValue([]);
    (S3RemoteAdapter.prototype as any).delete = jest.fn().mockResolvedValue(undefined);

    db = new SovereignS3nc({
      s3: {
        region: 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        bucketName: 'test-bucket'
      },
      paths: { appId: 'app', userId: 'user', storeId: 'store' },
      useManifest: true // ENABLE MANIFEST
    });

    await db.init();
    mockRemote = (S3RemoteAdapter as any).mock.instances[0];
  });

  test('should initialize adapters with useManifest=true', () => {
    // Check constructor arguments of the mock
    const args = (S3RemoteAdapter as any).mock.calls[0];
    expect(args[2]).toBe(true); // 3rd arg is useManifest
  });

  // Note: We cannot easily test the INTERNAL behavior of S3RemoteAdapter (updating manifest.json)
  // because we mocked the entire class.
  // Ideally, we should have an integration test for S3RemoteAdapter itself, or use a partial mock.
  // However, verifying the configuration propagation ensures the library attempts to use it.
});
