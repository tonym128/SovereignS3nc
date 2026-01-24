import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';

jest.mock('../src/adapters/S3RemoteAdapter');

describe('SovereignS3nc Public Sharing', () => {
  let db: SovereignS3nc;
  let mockSharedRemote: any;

  beforeEach(async () => {
    (S3RemoteAdapter as any).mockClear();
    (S3RemoteAdapter.prototype as any).put = jest.fn().mockResolvedValue('etag-123');
    (S3RemoteAdapter.prototype as any).get = jest.fn().mockResolvedValue(null);
    (S3RemoteAdapter.prototype as any).delete = jest.fn().mockResolvedValue(undefined);

    db = new SovereignS3nc({
      s3: {
        region: 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        bucketName: 'test-bucket'
      },
      paths: { appId: 'app', userId: 'user', storeId: 'store' },
      encryptionKey: 'master-key-000000000000000000000000'
    });

    await db.init();
    const mockInstances = (S3RemoteAdapter as any).mock.instances;
    mockSharedRemote = mockInstances[2]; // The shared remote
  });

  test('should share a document publicly and update public index', async () => {
    const id = await db.save({ title: 'public doc' });
    
    // Mock get public.json returning null (first time)
    mockSharedRemote.get.mockImplementation((key: string) => {
      if (key.includes('public')) return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const sharedId = await db.share(id, true);

    // Verify shared doc was PUT
    expect(mockSharedRemote.put).toHaveBeenCalled();
    
    // Find call for public index file
    // It should now be put to 'public/{sharedId}'
    const putCalls = mockSharedRemote.put.mock.calls;
    const publicIndexCall = putCalls.find((call: any) => call[0]._id === `public/${sharedId}`);
    
    expect(publicIndexCall).toBeDefined();
    const indexData = publicIndexCall[0].data;
    // indexData is now just the object { id, key, ... }
    expect(indexData.id).toBe(sharedId);
    expect(indexData.key).toBeDefined();
  });

  test('should unshare and remove from public index', async () => {
    const id = await db.save({ title: 'to unshare' });
    const sharedId = await db.share(id, true);
    
    mockSharedRemote.put.mockClear(); 
    
    // Update delete expectation
    await db.unshare(id);

    // Verify delete of shared doc
    expect(mockSharedRemote.delete).toHaveBeenCalledWith(sharedId, undefined);
    // Verify delete of public index file
    expect(mockSharedRemote.delete).toHaveBeenCalledWith(`public/${sharedId}`);
  });
  
  test('should consume a public share', async () => {
    // We need to verify saveSharedDocToLocal
    // Mock the shared doc fetch
    const fakeKey = '00000000000000000000000000000000'; // 32 chars
    const sharedId = 'shared-123';
    
    // Manually encrypt some data with the fake key to simulate remote content
    const crypto = require('crypto');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(fakeKey), iv);
    let encrypted = cipher.update(JSON.stringify({ title: 'remote content' }), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    const remotePayload = `${iv.toString('hex')}:${authTag}:${encrypted}`;

    mockSharedRemote.get.mockImplementation((key: string) => {
      if (key.includes(sharedId)) {
        return Promise.resolve({
          _id: sharedId,
          data: remotePayload
        });
      }
      return Promise.resolve(null);
    });

    const newId = await db.saveSharedDocToLocal(sharedId, fakeKey);
    
    const savedDoc = await db.get<any>(newId);
    expect(savedDoc).toBeDefined();
    expect(savedDoc.title).toBe('remote content');
  });
});
