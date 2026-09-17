import * as crypto from 'crypto';
import { SovereignGroup, GroupMember, GroupPermissions } from '../types';
import { IStorage } from '../interfaces/IStorage';
import { IRemoteAdapter } from '../interfaces/IRemoteAdapter';
import { Logger } from '../utils/Logger';
import { PATHS } from '../utils/Constants';
import { SyncError, AuthError } from '../utils/Errors';
import { env } from '../utils/Environment';

export interface GroupManagerContext {
    userId: string;
    storage: IStorage;
    getPublicRemote: () => IRemoteAdapter | undefined;
    pullUserFile: (userId: string, remotePath: string, publicKey: string, localPath: string, expectEncrypted: boolean) => Promise<boolean>;
    fetchManifest: (userId: string) => Promise<any>;
    encrypt: (data: Uint8Array, key: string) => Promise<Uint8Array>;
    decrypt: (data: Uint8Array, key: string) => Promise<Uint8Array>;
    onGroupUpdate: (groupId: string, userId: string, dateStr: string) => void;
    onGroupMetadataUpdate: (groupId: string, group: SovereignGroup) => void;
}

export class GroupManager {
    constructor(private ctx: GroupManagerContext) {}

    public async createGroup(name: string, members: GroupMember[]): Promise<SovereignGroup> {
        const id = env.generateId(12);
        const sharedKey = crypto.randomBytes(32).toString('hex');
        
        members.forEach(m => {
            if (m.userId === this.ctx.userId) m.status = 'joined';
            else m.status = 'pending';
        });

        const group: SovereignGroup = {
            id,
            name,
            members,
            sharedKey,
            createdAt: Date.now()
        };

        const groupData = new TextEncoder().encode(JSON.stringify(group));
        await this.ctx.storage.saveFile(`${PATHS.PRIVATE_PREFIX}${PATHS.GROUPS_DIR}${id}/info${PATHS.JSON_EXT}`, groupData);
        
        await this.respondToGroup(id, 'joined');

        Logger.info('Group', `Created group ${name} (${id})`);
        return group;
    }

    public async updateGroup(group: SovereignGroup) {
        const groupData = new TextEncoder().encode(JSON.stringify(group));
        await this.ctx.storage.saveFile(`private/groups/${group.id}/info.json`, groupData);
        
        for (const member of group.members) {
            if (member.userId !== this.ctx.userId) {
                this.ctx.onGroupMetadataUpdate(group.id, group);
            }
        }
        
        Logger.info('Group', `Updated group ${group.name} (${group.id})`);
    }

    /**
     * Updates granular permissions for a group member. Caller must be group owner or admin.
     */
    public async setMemberPermissions(groupId: string, targetUserId: string, permissions: GroupPermissions): Promise<SovereignGroup> {
        const infoPath = `${PATHS.PRIVATE_PREFIX}${PATHS.GROUPS_DIR}${groupId}/info${PATHS.JSON_EXT}`;
        const localInfo = await this.ctx.storage.getFile(infoPath);
        if (!localInfo) throw new Error(`Group ${groupId} not found`);

        const group: SovereignGroup = JSON.parse(new TextDecoder().decode(localInfo));
        const caller = group.members.find(m => m.userId === this.ctx.userId);
        if (!caller || (caller.role !== 'owner' && caller.role !== 'admin')) {
            throw new AuthError(`Permission denied: Only group owners or admins can set member permissions`);
        }

        const target = group.members.find(m => m.userId === targetUserId);
        if (!target) throw new Error(`Member ${targetUserId} not found in group ${groupId}`);

        target.permissions = { ...target.permissions, ...permissions };
        await this.updateGroup(group);
        return group;
    }

    /**
     * Updates a member's role (owner, admin, member). Caller must be the group owner.
     */
    public async setMemberRole(groupId: string, targetUserId: string, role: 'owner' | 'admin' | 'member'): Promise<SovereignGroup> {
        const infoPath = `${PATHS.PRIVATE_PREFIX}${PATHS.GROUPS_DIR}${groupId}/info${PATHS.JSON_EXT}`;
        const localInfo = await this.ctx.storage.getFile(infoPath);
        if (!localInfo) throw new Error(`Group ${groupId} not found`);

        const group: SovereignGroup = JSON.parse(new TextDecoder().decode(localInfo));
        const caller = group.members.find(m => m.userId === this.ctx.userId);
        if (!caller || caller.role !== 'owner') {
            throw new AuthError(`Permission denied: Only the group owner can change member roles`);
        }

        const target = group.members.find(m => m.userId === targetUserId);
        if (!target) throw new Error(`Member ${targetUserId} not found in group ${groupId}`);

        target.role = role;
        await this.updateGroup(group);
        return group;
    }

    public async joinGroup(group: SovereignGroup) {
        group.members.forEach(m => {
            if (!m.status) m.status = 'pending';
        });

        const groupData = new TextEncoder().encode(JSON.stringify(group));
        await this.ctx.storage.saveFile(`private/groups/${group.id}/info.json`, groupData);
        
        Logger.info('Group', `Received and saved metadata for group ${group.name} (${group.id})`);
    }

    public async respondToGroup(groupId: string, status: 'joined' | 'declined') {
        const statusData = new TextEncoder().encode(JSON.stringify({ status, updatedAt: Date.now() }));
        const path = `${PATHS.PUBLIC_PREFIX}${PATHS.GROUPS_DIR}${groupId}/status${PATHS.JSON_EXT}`;
        await this.ctx.storage.saveFile(path, statusData);
        
        const infoPath = `${PATHS.PRIVATE_PREFIX}${PATHS.GROUPS_DIR}${groupId}/info${PATHS.JSON_EXT}`;
        const localInfo = await this.ctx.storage.getFile(infoPath);
        if (localInfo) {
            const group: SovereignGroup = JSON.parse(new TextDecoder().decode(localInfo));
            const me = group.members.find(m => m.userId === this.ctx.userId);
            if (me) {
                me.status = status;
                await this.ctx.storage.saveFile(infoPath, new TextEncoder().encode(JSON.stringify(group)));
            }
        }

        Logger.info('Group', `Responded to group ${groupId} with ${status}`);
    }

    public async leaveGroup(groupId: string) {
        const statusData = new TextEncoder().encode(JSON.stringify({ status: 'left', updatedAt: Date.now() }));
        const path = `${PATHS.PUBLIC_PREFIX}${PATHS.GROUPS_DIR}${groupId}/status${PATHS.JSON_EXT}`;
        await this.ctx.storage.saveFile(path, statusData);

        const infoPath = `${PATHS.PRIVATE_PREFIX}${PATHS.GROUPS_DIR}${groupId}/info${PATHS.JSON_EXT}`;
        await this.ctx.storage.deleteFile(infoPath);

        Logger.info('Group', `Left group ${groupId}`);
    }

    public async getGroupMembersWithStatus(groupId: string): Promise<GroupMember[]> {
        const infoPath = `${PATHS.PRIVATE_PREFIX}${PATHS.GROUPS_DIR}${groupId}/info${PATHS.JSON_EXT}`;
        const localInfo = await this.ctx.storage.getFile(infoPath);
        if (!localInfo) return [];

        const group: SovereignGroup = JSON.parse(new TextDecoder().decode(localInfo));
        
        for (const member of group.members) {
            let statusPath: string;
            if (member.userId === this.ctx.userId) {
                statusPath = `public/groups/${groupId}/status.json`;
            } else {
                statusPath = `followed/${member.userId}/groups/${groupId}/status.json`;
            }

            const statusData = await this.ctx.storage.getFile(statusPath);
            if (statusData) {
                try {
                    const { status } = JSON.parse(new TextDecoder().decode(statusData));
                    member.status = status;
                } catch(e) {}
            }
        }

        return group.members;
    }

    public async getGroups(): Promise<SovereignGroup[]> {
        const files = await this.ctx.storage.listFiles(`${PATHS.PRIVATE_PREFIX}${PATHS.GROUPS_DIR}`);
        const groups: SovereignGroup[] = [];
        for (const file of files) {
            if (file.endsWith('info.json')) {
                const data = await this.ctx.storage.getFile(file);
                if (data) {
                    const group = JSON.parse(new TextDecoder().decode(data));
                    group.members = await this.getGroupMembersWithStatus(group.id);
                    groups.push(group);
                }
            }
        }
        return groups;
    }

    public async syncGroups(today: string) {
        const files = await this.ctx.storage.listFiles(`${PATHS.PRIVATE_PREFIX}${PATHS.GROUPS_DIR}`);
        const groups: SovereignGroup[] = [];
        for (const file of files) {
            if (file.endsWith('info.json')) {
                const data = await this.ctx.storage.getFile(file);
                if (data) groups.push(JSON.parse(new TextDecoder().decode(data)));
            }
        }

        const publicRemote = this.ctx.getPublicRemote();

        for (const group of groups) {
            try {
                Logger.info('Sync', `Syncing group ${group.name} (${group.id})`);
                
                const isOwner = group.members.find(m => m.userId === this.ctx.userId)?.role === 'owner';

            if (isOwner && publicRemote) {
                const infoData = new TextEncoder().encode(JSON.stringify(group));
                const encryptedInfo = await this.ctx.encrypt(infoData, group.sharedKey);
                await publicRemote.uploadFile(`${PATHS.PUBLIC_PREFIX}${PATHS.GROUPS_DIR}${group.id}/info${PATHS.ENC_EXT}`, encryptedInfo);
            }

            const owner = group.members.find(m => m.role === 'owner');
            if (owner && owner.userId !== this.ctx.userId) {
                const remoteInfoPath = `${PATHS.PUBLIC_PREFIX}${PATHS.GROUPS_DIR}${group.id}/info${PATHS.ENC_EXT}`;
                const localInfoPath = `${PATHS.FOLLOWED_PREFIX}${owner.userId}/${PATHS.GROUPS_DIR}${group.id}/info${PATHS.ENC_EXT}`;
                const changed = await this.ctx.pullUserFile(owner.userId, remoteInfoPath, '', localInfoPath, false);
                if (changed) {
                    const encryptedData = await this.ctx.storage.getFile(localInfoPath);
                    if (encryptedData) {
                        try {
                            const decrypted = await this.ctx.decrypt(encryptedData, group.sharedKey);
                            const updatedGroup = JSON.parse(new TextDecoder().decode(decrypted));
                            await this.updateGroup(updatedGroup);
                            Object.assign(group, updatedGroup);
                        } catch (e: any) {
                            Logger.warn('Sync', `Failed to decrypt group info update: ${e.message}`);
                        }
                    }
                }
            }

            const me = group.members.find(m => m.userId === this.ctx.userId);
            if (!me || me.status === 'left' || me.status === 'declined') {
                Logger.info('Sync', `Skipping group ${group.id} sync: I am no longer an active member.`);
                continue;
            }

            const myStatusPath = `${PATHS.PUBLIC_PREFIX}${PATHS.GROUPS_DIR}${group.id}/status${PATHS.JSON_EXT}`;
            const myStatusData = await this.ctx.storage.getFile(myStatusPath);
            if (myStatusData && publicRemote) {
                await publicRemote.uploadFile(myStatusPath, myStatusData);
            }

            let anyMemberStatusChanged = false;
            for (const member of group.members) {
                if (member.userId === this.ctx.userId) continue;

                const remoteStatusPath = `${PATHS.PUBLIC_PREFIX}${PATHS.GROUPS_DIR}${group.id}/status${PATHS.JSON_EXT}`;
                const localStatusPath = `${PATHS.FOLLOWED_PREFIX}${member.userId}/${PATHS.GROUPS_DIR}${group.id}/status${PATHS.JSON_EXT}`;
                await this.ctx.pullUserFile(member.userId, remoteStatusPath, '', localStatusPath, false); 

                const statusData = await this.ctx.storage.getFile(localStatusPath);
                if (statusData) {
                    try {
                        const { status } = JSON.parse(new TextDecoder().decode(statusData));
                        if (member.status !== status) {
                            member.status = status;
                            anyMemberStatusChanged = true;
                        }
                    } catch(e) {}
                }

                if (member.status === 'joined') {
                    const manifest = await this.ctx.fetchManifest(member.userId);
                    if (manifest && manifest.groups[group.id]) {
                        for (const dateStr of manifest.groups[group.id]) {
                            const remotePath = `${PATHS.PUBLIC_PREFIX}${PATHS.GROUPS_DIR}${group.id}/${dateStr}${PATHS.DB_EXT}`;
                            const localPath = `${PATHS.FOLLOWED_PREFIX}${member.userId}/${PATHS.GROUPS_DIR}${group.id}/${dateStr}${PATHS.DB_EXT}`;
                            
                            const changed = await this.ctx.pullUserFile(member.userId, remotePath, group.sharedKey, localPath, false);
                            if (changed) {
                                this.ctx.onGroupUpdate(group.id, member.userId, dateStr);
                            }
                        }
                    }
                }
            }

            if (anyMemberStatusChanged) {
                await this.updateGroup(group);
            }
        } catch (e: any) {
            Logger.warn('Sync', `syncGroups failed for group ${group.id}: ${e.message}`);
            throw new SyncError(`syncGroups failed for group ${group.id}: ${e.message}`);
        }
        }
    }
}
