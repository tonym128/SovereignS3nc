import { SovereignConfig } from '../types';
import { IStorage } from '../interfaces/IStorage';
import { IRemoteAdapter } from '../interfaces/IRemoteAdapter';
import { Logger } from '../utils/Logger';
import { SovereignS3nc } from '../SovereignS3nc';
import { PATHS, DEFAULTS } from '../utils/Constants';
import { NetworkError } from '../utils/Errors';

export interface GlobalRegistryContext {
    config: SovereignConfig;
    storage: IStorage;
    getGlobalRemote: () => IRemoteAdapter | undefined;
}

export class GlobalRegistry {
    constructor(private ctx: GlobalRegistryContext) {}

    public async ensureGlobalRegistration() {
        const globalRemote = this.ctx.getGlobalRemote();
        if (!globalRemote) return;
        const remotePath = PATHS.USERS_REGISTRY;
        const myUserId = this.ctx.config.paths.userId;
        const myPublicKey = this.ctx.config.publicEncryptionKey!;
        
        Logger.info('Discovery', `Checking global registry at ${remotePath}`);
        let userList: { userId: string, publicKey: string }[] = [];
        let remoteData: Uint8Array | null = null;
        
        try {
            const result = await globalRemote.downloadFile(remotePath, undefined, DEFAULTS.NETWORK_TIMEOUT);
            if (result && result.data) remoteData = result.data;
        } catch (e: any) {
            Logger.warn('Discovery', `Could not reach global registry (offline?): ${e.message}`);
            return; 
        }
        
        if (remoteData) {
            try {
                userList = JSON.parse(new TextDecoder().decode(remoteData));
            } catch (e) {
                Logger.warn('Discovery', 'Global user registry corrupted. Resetting.');
                userList = [];
            }
        }
        
        if (!userList.find(u => u.userId === myUserId) || userList.find(u => u.userId === myUserId)?.publicKey !== myPublicKey) {
            Logger.info('Discovery', `Registering/Updating user ${myUserId} in global registry.`);
            const existing = userList.find(u => u.userId === myUserId);
            if (existing) {
                existing.publicKey = myPublicKey;
            } else {
                userList.push({ userId: myUserId, publicKey: myPublicKey });
            }
            const newData = new TextEncoder().encode(JSON.stringify(userList));
            try {
                await globalRemote.uploadFile(remotePath, newData);
            } catch (e: any) {
                Logger.warn('Discovery', `Failed to update global registry: ${e.message}`);
            }
        }
    }

    public async updateFollowingPublicKeys() {
        try {
            const registry = await this.getPublicRegistry();
            const following = await this.ctx.storage.getFollowing();
            
            for (const user of registry) {
                const existing = following.find(f => f.userId === user.userId);
                if (existing && existing.publicKey !== user.publicKey) {
                    Logger.info('Discovery', `Updating public key for followed user ${user.userId}`);
                    await this.ctx.storage.followUser(user.userId, existing.lastSync, user.publicKey);
                }
            }
        } catch (e: any) {
            Logger.warn('Discovery', `Failed to update following public keys: ${e.message}`);
        }
    }

    public async getPublicRegistry(): Promise<{userId: string, publicKey: string}[]> {
        const globalRemote = this.ctx.getGlobalRemote();
        if (!globalRemote) return [];
        Logger.info('Discovery', 'Fetching public registry...');
        const remotePath = PATHS.USERS_REGISTRY;
        const result = await globalRemote.downloadFile(remotePath, undefined, DEFAULTS.NETWORK_TIMEOUT);
        if (!result || !result.data) return [];
        try {
            return JSON.parse(new TextDecoder().decode(result.data));
        } catch (e) {
            return [];
        }
    }

    public async discoverUsers(): Promise<{ userId: string, publicKey: string }[] | null> {
        const globalRemote = this.ctx.getGlobalRemote();
        if (!globalRemote) return null;
        const remotePath = PATHS.USERS_REGISTRY;
        let remoteData: Uint8Array | null = null;
        try {
            const result = await globalRemote.downloadFile(remotePath, undefined, DEFAULTS.NETWORK_TIMEOUT);
            if (result && result.data) remoteData = result.data;
        } catch (e: any) {
            Logger.warn('Discovery', 'Failed to download global registry (offline?)', e.message);
            return null;
        }
        
        if (!remoteData) return null;

        try {
            const users: { userId: string, publicKey: string }[] = JSON.parse(new TextDecoder().decode(remoteData));
            const blacklist = this.ctx.config.blacklist || [];
            return users.filter(u => !blacklist.includes(u.userId));
        } catch (e) {
            Logger.warn('Discovery', 'Failed to parse global registry', e);
            return null;
        }
    }

    public async autoFollowUsers(userList: { userId: string, publicKey: string }[]) {
        try {
            const following = await this.ctx.storage.getFollowing();
            const followingIds = following.map(u => u.userId);

            for (const user of userList) {
                if (user.userId !== this.ctx.config.paths.userId && !followingIds.includes(user.userId)) {
                    const startDate = new Date();
                    startDate.setUTCDate(startDate.getUTCDate() - 7);
                    const lastSyncStr = SovereignS3nc.getDateStr(startDate);
                    
                    Logger.info('Discovery', `Discovered new user ${user.userId}, starting from ${lastSyncStr}`);
                    await this.ctx.storage.followUser(user.userId, lastSyncStr, user.publicKey);
                }
            }
        } catch (e) {
            Logger.warn('Discovery', 'autoFollowUsers failed', e);
        }
    }
}
