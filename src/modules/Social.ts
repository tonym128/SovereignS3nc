import { merge } from 'ts-deepmerge';
import { v4 as uuidv4 } from 'uuid';
import { SovereignS3nc } from '../SovereignS3nc';
import { SovereignAddress } from '../types';

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
    const followedPosts = await this.db.collection('followed_content').getAll<Post>();
    const allPosts = [...myPosts, ...followedPosts].filter(p => p.text !== undefined);
    return allPosts.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getComments(postId: string): Promise<Comment[]> {
    const comments = await this.db.collection('comments').getAll<Comment>();
    return comments
        .filter(c => c.postId === postId)
        .sort((a, b) => a.createdAt - b.createdAt);
  }
}
