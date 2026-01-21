import { SovereignS3nc } from '../src/SovereignS3nc';
import { S3RemoteAdapter } from '../src/adapters/S3RemoteAdapter';
import { S3BlobAdapter } from '../src/adapters/S3BlobAdapter';
import { Post } from '../src/modules/Social';

jest.mock('../src/adapters/S3RemoteAdapter');
jest.mock('../src/adapters/S3BlobAdapter');

describe('Social Fixes', () => {
  let db: SovereignS3nc;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Mock S3RemoteAdapter methods
    (S3RemoteAdapter.prototype as any).put = jest.fn().mockResolvedValue('etag-123');
    (S3RemoteAdapter.prototype as any).get = jest.fn().mockResolvedValue(null);
    (S3RemoteAdapter.prototype as any).listChanges = jest.fn().mockResolvedValue([]);
    (S3RemoteAdapter.prototype as any).delete = jest.fn().mockResolvedValue(undefined);

    // Mock S3BlobAdapter methods
    (S3BlobAdapter.prototype as any).upload = jest.fn().mockResolvedValue(undefined);
    (S3BlobAdapter.prototype as any).download = jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    (S3BlobAdapter.prototype as any).delete = jest.fn().mockResolvedValue(undefined);

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
  });

  test('getFeed should normalize followed posts (fix "Me" label and deduplication)', async () => {
      // 1. Inject a "Followed Post" into local storage directly
      // This simulates what pullFollowedContent does: saves with prefix and original content (where authorId='me')
      const originalId = 'post-123';
      const friendId = 'friend-user';
      const followedId = `follow_${friendId}_${originalId}`;
      
      const rawPost = {
          _id: followedId,
          text: 'Friend Post',
          authorId: 'me', // Original author set this to 'me' in their DB
          createdAt: 1000
      };

      // We bypass db.save because it might overwrite _id or do other things. 
      // We use the collection directly but we want to simulate the "raw" followed content.
      // However, db.collection('followed_content').save() will treat it as a doc.
      // We just need to ensure it gets into the store.
      await db.collection('followed_content').save(rawPost);

      // 2. Call getFeed
      const feed = await db.social.getFeed();
      
      // 3. Verify
      const post = feed.find(p => p.text === 'Friend Post');
      expect(post).toBeDefined();
      
      // Fix 1: Author should be rewritten to friendId
      expect(post?.authorId).toBe(friendId);
      
      // Fix 2: ID should be restored to originalId
      expect(post?._id).toBe(originalId);
  });

  test('getFeed should deduplicate local and followed-self posts', async () => {
      const originalId = 'my-post-1';
      
      // 1. My local post
      await db.collection('posts').save({
          _id: originalId,
          text: 'My Post',
          authorId: 'me',
          createdAt: 2000
      });

      // 2. My post synced back via "following myself" (simulated)
      // ID would be follow_me_my-post-1
      const followedId = `follow_me_${originalId}`;
      await db.collection('followed_content').save({
          _id: followedId,
          text: 'My Post', // Same text
          authorId: 'me',
          createdAt: 2000
      });

      // 3. Get Feed
      const feed = await db.social.getFeed();
      
      // 4. Verify only one instance exists
      const myPosts = feed.filter(p => p._id === originalId);
      expect(myPosts).toHaveLength(1);
      
      // And the author is 'me' (normalized from follow_me_... -> me, or kept from local)
      expect(myPosts[0].authorId).toBe('me');
  });

  test('getBlob should use correct config for followed user', async () => {
      const friendAddr = {
          region: 'us-west-2',
          bucket: 'friend-bucket',
          appId: 'friend-app',
          userId: 'friend-user'
      };
      
      const blobId = 'blob-xyz';
      
      await db.social.getBlob(blobId, friendAddr);
      
      const constructorCalls = (S3BlobAdapter as any).mock.calls;
      // Get the last call. Since beforeEach creates one for `db`, we look at the latest.
      const lastCall = constructorCalls[constructorCalls.length - 1];
      
      expect(lastCall[0].bucketName).toBe('friend-bucket');
      expect(lastCall[0].region).toBe('us-west-2');
      expect(lastCall[1].userId).toBe('friend-user');
  });

  test('getAllComments should normalize followed comments', async () => {
    // 1. Inject a "Followed Comment"
    const originalId = 'comment-abc';
    const friendId = 'friend-user';
    const followedId = `follow_${friendId}_${originalId}`;
    
    await db.collection('followed_content').save({
        _id: followedId,
        postId: 'post-1',
        text: 'Friend Comment',
        authorId: 'me', // Original local author was 'me'
        createdAt: 3000
    });

    // 2. Call getAllComments
    const comments = await db.social.getAllComments();
    
    // 3. Verify
    const comment = comments.find(c => c._id === originalId);
    expect(comment).toBeDefined();
    expect(comment?.text).toBe('Friend Comment');
    expect(comment?.authorId).toBe(friendId); // Should be normalized
  });
});
