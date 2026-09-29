import { SovereignS3nc } from '../SovereignS3nc';
import { IModuleContext } from '../interfaces/IModuleContext';
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
    private context: IModuleContext;

    constructor(contextOrDb: IModuleContext | SovereignS3nc) {
        this.context = 'sovereign' in contextOrDb
            ? (contextOrDb as IModuleContext)
            : (contextOrDb as SovereignS3nc).createModuleContext(this.MODULE_NAME);
    }

    /**
     * Backward-compatible reference to the host SovereignS3nc instance.
     */
    public get db(): SovereignS3nc {
        return this.context.sovereign;
    }

    public get sovereign(): SovereignS3nc {
        return this.context.sovereign;
    }

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
            userId: this.context.userId 
        };
        
        const data = new TextEncoder().encode(JSON.stringify(profile));
        await this.context.storage.savePublicUserFile(data);
    }

    /**
     * Retrieves a profile for a given user.
     */
    async getProfile(userId?: string): Promise<Profile | null> {
        const myId = this.context.userId;
        const targetId = userId || myId;
        
        if (targetId === myId) {
            const data = await this.context.storage.getPublicUserFile();
            return data ? JSON.parse(new TextDecoder().decode(data)) : null;
        }
        
        // Followed profiles are stored by the profile module at a scoped followed path.
        const data = await this.context.storage.getFile(`${targetId}/profile`, 'followed');
        if (data) {
            return JSON.parse(new TextDecoder().decode(data));
        }
        return null;
    }

    /**
     * Syncs profiles of followed users from their remotes.
     */
    async syncOtherProfiles() {
        const following = await this.context.getFollowing();
        for (const user of following) {
            try {
                const userRemote = this.context.remotes.createRemote(user.userId);
                const cachedEtag = await this.context.storage.raw.getGenericRemoteHashCache(`${user.userId}:${PATHS.USER_PROFILE}`);
                const result = await userRemote.downloadFile(PATHS.USER_PROFILE, cachedEtag || undefined);
                
                if (result && !result.notModified && result.data) {
                    const data = result.data;
                    let finalData = data;
                    
                    // Profiles can be encrypted or public
                    try {
                        JSON.parse(new TextDecoder().decode(data));
                    } catch (e) {
                        try {
                            finalData = await this.context.decrypt(data, user.publicKey);
                        } catch (de) {
                            continue; // Skip if decryption fails
                        }
                    }
                    
                    await this.context.storage.saveFile(`${user.userId}/profile`, finalData, 'followed');
                    
                    if (result.etag) {
                        await this.context.storage.raw.setGenericRemoteHashCache(`${user.userId}:${PATHS.USER_PROFILE}`, result.etag);
                    }
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
        await this.context.follow(userId);
        await this.syncOtherProfiles();
    }

    /**
     * Unfollow a user.
     */
    async unfollow(userId: string) {
        await this.context.unfollow(userId);
    }

    /**
     * Get list of followed users.
     */
    async getFollowing() {
        return this.context.getFollowing();
    }
}
