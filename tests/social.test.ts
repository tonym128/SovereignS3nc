import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';

jest.mock('../src/adapters/S3RemoteAdapter');

describe('SovereignS3nc Social & Profiles', () => {
  let db: SovereignS3nc;
  let mockRemote: any;
  let mockSharedRemote: any;

  beforeEach(async () => {
    (S3RemoteAdapter as any).mockClear();
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
      paths: { appId: 'app', userId: 'me', storeId: 'store' },
      encryptionKey: 'master-key-000000000000000000000000'
    });

    await db.init();
    const mockInstances = (S3RemoteAdapter as any).mock.instances;
    mockRemote = mockInstances[0];
    mockSharedRemote = mockInstances[1];
  });

  test('should update and retrieve profile', async () => {
    await db.profile.update({ displayName: 'Tony Stark', bio: 'I am Iron Man' });
    
    const profile = await db.profile.get();
    expect(profile?.displayName).toBe('Tony Stark');
    expect(profile?.bio).toBe('I am Iron Man');
    expect(profile?.address.userId).toBe('me');

    // Verify it was shared publicly (unencrypted)
    expect(mockSharedRemote.put).toHaveBeenCalled();
    const shareCall = mockSharedRemote.put.mock.calls.find((c: any) => !c[0]._id.startsWith('public/'));
    expect(shareCall).toBeDefined();
    // Shared data should be the decrypted profile
    expect(shareCall[0].data.displayName).toBe('Tony Stark');
  });

  test('should follow and unfollow users', async () => {
    const friendAddr = 's3://test-bucket/app/friend-id';
    await db.social.follow(friendAddr);

    const following = await db.social.getFollowing();
    expect(following).toHaveLength(1);
    expect(following[0].userId).toBe('friend-id');

    await db.social.unfollow('app.friend-id');
    const followingAfter = await db.social.getFollowing();
    expect(followingAfter).toHaveLength(0);
  });

  test('should pull content from followed users during sync', async () => {
    const friendAddr = {
        region: 'us-east-1',
        bucket: 'test-bucket',
        appId: 'app',
        userId: 'friend-id'
    };
    await db.social.follow(friendAddr);

    // Mock friend's public index
    const sharedDocId = 'shared-doc-id';
    (S3RemoteAdapter.prototype as any).listChanges.mockImplementationOnce(() => Promise.resolve([])); // My changes
    (S3RemoteAdapter.prototype as any).listChanges.mockImplementationOnce(() => Promise.resolve([
        { id: `public/${sharedDocId}`, key: `app/shared/shared/public/${sharedDocId}.json`, lastModified: new Date() }
    ])); // Friend's public index

    // Mock friend's index doc and content doc
    (S3RemoteAdapter.prototype as any).get.mockImplementation((id: string) => {
        if (id === `public/${sharedDocId}`) {
            return Promise.resolve({
                data: { id: sharedDocId, collection: 'posts', updatedAt: Date.now() }
            });
        }
        if (id === sharedDocId) {
            return Promise.resolve({
                data: { text: 'Hello from friend' }
            });
        }
        return Promise.resolve(null);
    });

    await db.sync();

    const feed = await db.getAll<any>('followed_content');
    expect(feed).toHaveLength(1);
    expect(feed[0].text).toBe('Hello from friend');
  });
});
