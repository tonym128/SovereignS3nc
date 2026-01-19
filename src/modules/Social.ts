import { merge } from 'ts-deepmerge';
import { v4 as uuidv4 } from 'uuid';
import { SovereignS3nc } from '../SovereignS3nc';
import { SovereignAddress, SyncDocument } from '../types';

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

  async getFeed(): Promise<Post[]> {
    const myPosts = await this.db.collection('posts').getAll<Post>();
    const followedDocs = await this.db.collection('followed_content').getAll<any>();
    
    // Filter followed docs to only be Posts (have text, no postId)
    const followedPosts = followedDocs.filter(d => d.text !== undefined && d.postId === undefined);
    
    const allPosts = [...myPosts, ...followedPosts];
    
    // Deduplicate by ID
    const uniquePosts = Array.from(new Map(allPosts.map(p => [p._id, p])).values());
    
    return uniquePosts.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getComments(postId: string): Promise<Comment[]> {
    const myComments = await this.db.collection('comments').getAll<Comment>();
    const followedDocs = await this.db.collection('followed_content').getAll<any>();
    
    // Filter followed docs to be Comments (have text AND postId)
    const followedComments = followedDocs.filter(d => d.text !== undefined && d.postId !== undefined) as Comment[];

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
      
      try {
          const doc = await this.db.globalRemote.get('directory');
          let directory: SovereignAddress[] = [];
          let currentDoc = doc;

          if (doc && doc.data) {
              directory = doc.data as SovereignAddress[];
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
          
          // Optimistic locking? Simple LWW for now as per instructions "eventual consistency"
          await this.db.globalRemote.put(newDoc);

      } catch (e) {
          console.error('Failed to join global directory', e);
      }
  }
}
