
import { SovereignS3nc } from '../SovereignS3nc';
import { Logger } from '../utils/Logger';
import { MediaUtils } from '../utils/MediaUtils';
import { PATHS, DEFAULTS } from '../utils/Constants';
import { ModuleError } from '../utils/Errors';

export interface Profile {
    userId: string;
    name: string;
    bio: string;
    avatar?: string;
    updatedAt: number;
}

export class ProfileModule {
    private readonly MODULE_NAME = 'profile';

    constructor(private db: SovereignS3nc) {}

    /**
     * Updates the current user's profile.
     */
    async updateProfile(name: string, bio: string, avatar?: string) {
        if (name.length > DEFAULTS.MAX_NAME_LENGTH) {
            throw new ModuleError('profile', `Name exceeds maximum length of ${DEFAULTS.MAX_NAME_LENGTH} characters`);
        }
        if (bio.length > DEFAULTS.MAX_BIO_LENGTH) {
            throw new ModuleError('profile', `Bio exceeds maximum length of ${DEFAULTS.MAX_BIO_LENGTH} characters`);
        }
        
        let finalAvatar = avatar;
        if (avatar && avatar.startsWith('data:image')) {
            try {
                // Compress to stay under 100KB for the profile JSON
                finalAvatar = await MediaUtils.compressImage(avatar, 100 * 1024);
            } catch (e: any) {
                Logger.warn('Profile', `Failed to compress avatar: ${e.message}`);
            }
        }
        
        const profile: Profile = { 
            name, 
            bio, 
            avatar: finalAvatar, 
            updatedAt: Date.now(), 
            userId: this.db.getConfig().paths.userId 
        };
        
        const data = new TextEncoder().encode(JSON.stringify(profile));
        await this.db.getStorage().savePublicUserFile(data);
        
        // Notify of update (using its own namespace now)
        this.db.emit(`${this.MODULE_NAME}:update`, { path: PATHS.USER_PROFILE });
    }

    /**
     * Retrieves a profile for a given user.
     */
    async getProfile(userId?: string): Promise<Profile | null> {
        const myId = this.db.getConfig().paths.userId;
        const targetId = userId || myId;
        
        if (targetId === myId) {
            const data = await this.db.getStorage().getPublicUserFile();
            return data ? JSON.parse(new TextDecoder().decode(data)) : null;
        }
        
        // Followed profiles are stored by the profile module now at a specific path.
        const path = this.db.getModulePath(this.MODULE_NAME, `${targetId}/profile`, 'followed');
        const data = await this.db.getStorage().getFile(path);

        if (data) {
            return JSON.parse(new TextDecoder().decode(data));
        }
        return null;
    }

    /**
     * Syncs profiles of followed users from their remotes.
     */
    async syncOtherProfiles() {
        const following = await this.db.getFollowing();
        for (const user of following) {
            try {
                const userRemote = this.db.createRemote(user.userId);
                const cachedEtag = await this.db.getStorage().getGenericRemoteHashCache(`${user.userId}:${PATHS.USER_PROFILE}`);
                const result = await userRemote.downloadFile(PATHS.USER_PROFILE, cachedEtag || undefined);
                
                if (result && !result.notModified && result.data) {
                    const data = result.data;
                    let finalData = data;
                    
                    // Profiles can be encrypted or public
                    try {
                        JSON.parse(new TextDecoder().decode(data));
                    } catch (e) {
                        try {
                            finalData = await this.db.decrypt(data, user.publicKey);
                        } catch (de) {
                            continue; // Skip if decryption fails
                        }
                    }
                    
                    const localPath = this.db.getModulePath(this.MODULE_NAME, `${user.userId}/profile`, 'followed');
                    await this.db.getStorage().saveFile(localPath, finalData);
                    
                    if (result.etag) {
                        await this.db.getStorage().setGenericRemoteHashCache(`${user.userId}:${PATHS.USER_PROFILE}`, result.etag);
                    }
                    
                    this.db.emit(`${this.MODULE_NAME}:update`, { path: localPath, userId: user.userId });
                }
            } catch (e: any) {
                Logger.debug('Profile', `Failed to sync profile for ${user.userId}: ${e.message}`);
            }
        }
    }

    /**
     * Follow a new user.
     */
    async follow(userId: string) {
        // Delegate to core for now, but we can move logic here later
        await this.db.follow(userId);
        await this.syncOtherProfiles();
    }

    /**
     * Unfollow a user.
     */
    async unfollow(userId: string) {
        await this.db.unfollow(userId);
    }

    /**
     * Get list of followed users.
     */
    async getFollowing() {
        return this.db.getFollowing();
    }
}
