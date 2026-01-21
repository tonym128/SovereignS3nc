import { merge } from 'ts-deepmerge';
import { v4 as uuidv4 } from 'uuid';
import { SovereignS3nc } from '../SovereignS3nc';
import { SovereignAddress, SyncDocument } from '../types';
import { S3BlobAdapter } from '../adapters/S3BlobAdapter';
import { OCIBlobAdapter } from '../adapters/OCIBlobAdapter';

export interface Profile {
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  publicKey?: string;
  address: SovereignAddress;
}

export interface Post {
  _id: string;
  text: string;
  authorId: string;
  createdAt: number;
  attachments?: string[];
}

export interface Comment {
  _id: string;
  postId: string;
  parentId?: string;
  text: string;
  authorId: string;
  createdAt: number;
}

export class ProfileManager {
  constructor(private db: SovereignS3nc) {}

  async get(): Promise<Profile | null> {
    return this.db.get<Profile>('me', 'profiles');
  }

  async update(data: Partial<Profile>): Promise<void> {
    const current = await this.get() || {
      displayName: '',
      address: this.db.getAddress()
    } as Profile;

    const updated = merge(current, data) as Profile;
    await this.db.save(updated, 'profiles', 'me');
    await this.db.share('me', true, 'profiles'); 
  }
}

export class SocialManager {
  constructor(private db: SovereignS3nc) {}

  async follow(address: SovereignAddress | string): Promise<void> {
    const addr = typeof address === 'string' ? this.parseAddress(address) : address;
    const id = `${addr.appId}.${addr.userId}`;
    await this.db.save(addr, '_social_following', id);
  }

  async unfollow(id: string): Promise<void> {
    await this.db.delete(id, '_social_following');
  }

  async getFollowing(): Promise<SovereignAddress[]> {
    return this.db.getAll<SovereignAddress>('_social_following');
  }

  async getBlob(blobId: string, address: SovereignAddress): Promise<Uint8Array | null> {
      let adapter;
      if (this.db.config.s3) {
          adapter = new S3BlobAdapter({
              ...this.db.config.s3,
              bucketName: address.bucket || this.db.config.s3.bucketName,
              endpoint: address.endpoint || this.db.config.s3.endpoint,
              region: address.region || this.db.config.s3.region
          }, {
              appId: address.appId,
              userId: address.userId,
              storeId: 'social'
          });
      } else if (this.db.config.ociParUrl) {
          adapter = new OCIBlobAdapter(this.db.config.ociParUrl, {
              appId: address.appId,
              userId: address.userId,
              storeId: 'social'
          });
      }
      
      if (adapter) {
          return adapter.download(blobId);
      }
      return null;
  }

  private parseAddress(addrStr: string): SovereignAddress {
    if (addrStr.startsWith('s3://')) {
        const parts = addrStr.substring(5).split('/');
        return {
            bucket: parts[0],
            appId: parts[1],
            userId: parts[2],
            region: 'us-east-1' 
        };
    }
    throw new Error('Invalid address format');
  }

  private normalizeFollowedContent<T extends { _id: string, authorId: string }>(doc: T): T {
    // Check if this is a followed document (id format: follow_userId_originalId)
    if (doc._id.startsWith('follow_')) {
      const parts = doc._id.split('_');
      if (parts.length >= 3) {
        const userId = parts[1];
        const originalId = parts.slice(2).join('_');
        
        // Return a copy with corrected author and ID
        return {
          ...doc,
          _id: originalId,
          authorId: userId
        };
      }
    }
    return doc;
  }

  async getFeed(): Promise<Post[]> {
    const myPosts = await this.db.collection('posts').getAll<Post>();
    const followedDocs = await this.db.collection('followed_content').getAll<any>();
    
    // Filter followed docs to only be Posts (have text, no postId)
    const followedPostsRaw = followedDocs.filter(d => d.text !== undefined && d.postId === undefined);
    const followedPosts = followedPostsRaw.map(p => this.normalizeFollowedContent<Post>(p));
    
    const allPosts = [...myPosts, ...followedPosts];
    
    // Deduplicate by ID (Last Write Wins for display if duplicates exist)
    const uniquePostsMap = new Map<string, Post>();
    for (const p of allPosts) {
        // If we have duplicates (e.g. local and followed-self), prefer the one that is NOT from followed content (my local copy)
        // OR simply rely on map overwriting. 
        // If I follow myself, I have local copy (author=me) and followed copy (author=me after normalization).
        // They are identical.
        uniquePostsMap.set(p._id, p);
    }
    
    const uniquePosts = Array.from(uniquePostsMap.values());
    
    return uniquePosts.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getComments(postId: string): Promise<Comment[]> {
    const myComments = await this.db.collection('comments').getAll<Comment>();
    const followedDocs = await this.db.collection('followed_content').getAll<any>();
    
    // Filter followed docs to be Comments (have text AND postId)
    const followedCommentsRaw = followedDocs.filter(d => d.text !== undefined && d.postId !== undefined) as Comment[];
    const followedComments = followedCommentsRaw.map(c => this.normalizeFollowedContent<Comment>(c));

    const allComments = [...myComments, ...followedComments];

    return allComments
        .filter(c => c.postId === postId)
        .sort((a, b) => a.createdAt - b.createdAt);
  }

  async getGlobalDirectory(): Promise<SovereignAddress[]> {
    if (!this.db.globalRemote) return [];
    
    try {
        const doc = await this.db.globalRemote.get('directory');
        if (doc && doc.data) {
            return doc.data as SovereignAddress[];
        }
    } catch (e) {
        console.warn('Failed to fetch global directory', e);
    }
    return [];
  }

  async joinGlobalDirectory(): Promise<void> {
      if (!this.db.globalRemote) return;

      const myAddress = this.db.getAddress();
      let directory: SovereignAddress[] = [];
      let doc: SyncDocument | null = null;
      
      try {
          doc = await this.db.globalRemote.get('directory');
          if (doc && doc.data) {
              directory = doc.data as SovereignAddress[];
          }
      } catch (e) {
          // If fetch fails, it might be 404 masked by CORS (common in some S3 impls)
          // OR it really is the first run.
          // We proceed to add ourselves. If this is a real network error, the subsequent PUT will fail too.
          console.warn('Could not fetch global directory (likely first run or CORS 404). Bootstrapping...');
      }

      // Check if I am already there with same details
      const existingIndex = directory.findIndex(a => a.userId === myAddress.userId && a.appId === myAddress.appId);
      
      if (existingIndex >= 0) {
          const existing = directory[existingIndex];
          // If details match, no need to update
          if (existing.bucket === myAddress.bucket && existing.endpoint === myAddress.endpoint) {
              return;
          }
          // Update
          directory[existingIndex] = myAddress;
      } else {
          // Add
          directory.push(myAddress);
      }

      // Save back
      const newDoc: SyncDocument = {
          _id: 'directory',
          _updatedAt: Date.now(),
          _rev: uuidv4(),
          data: directory
      };
      
      try {
          await this.db.globalRemote.put(newDoc);
      } catch (e) {
          console.error('Failed to update global directory', e);
      }
  }
}
