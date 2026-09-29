import { SovereignS3nc } from '../SovereignS3nc';
import { IModuleContext } from '../interfaces/IModuleContext';
import { Logger } from '../utils/Logger';
import { Buffer } from 'buffer';
import { PATHS } from '../utils/Constants';
import { AuthError, SovereignError } from '../utils/Errors';
import { env } from '../utils/Environment';

export interface Report {
    id: string;
    reporterId: string;
    targetUserId: string;
    contentId: string;
    contentType: 'post' | 'comment' | 'message';
    reason: string;
    timestamp: number;
    evidence?: any; // The actual content being reported
}

export class ModerationModule {
    private readonly MODULE_NAME = 'moderation';
    private context: IModuleContext;

    constructor(contextOrSov: IModuleContext | SovereignS3nc) {
        this.context = 'sovereign' in contextOrSov
            ? (contextOrSov as IModuleContext)
            : (contextOrSov as SovereignS3nc).createModuleContext(this.MODULE_NAME);
    }

    /**
     * Backward-compatible reference to the host SovereignS3nc instance.
     */
    public get sovereign(): SovereignS3nc {
        return this.context.sovereign;
    }

    /**
     * Determine if the current user has write access to the admin prefix by probing S3.
     */
    async isAdmin(): Promise<boolean> {
        const adminRemote = this.context.remotes.getAdminRemote();
        if (!adminRemote) return false;
        
        try {
            // Probe: Try to write to the protected 'data' subfolder
            // Regular users only have access to 'reports/' and the public key
            const sentinel = new TextEncoder().encode(JSON.stringify({ lastProbe: Date.now() }));
            await adminRemote.uploadFile('data/admin.probe', sentinel);
            return true;
        } catch (e: any) {
            // 403 Forbidden or 405 Method Not Allowed means we are NOT an admin
            return false;
        }
    }

    /**
     * (Admin Only) Publishes the admin's public key so users can encrypt reports to them.
     */
    async publishAdminKey() {
        const adminRemote = this.context.remotes.getAdminRemote();
        const pk = this.context.publicKey;
        if (adminRemote && pk) {
            try {
                await adminRemote.uploadFile(PATHS.ADMIN_PUBLIC_KEY, new TextEncoder().encode(JSON.stringify({ publicKey: pk })));
                Logger.info('Moderation', 'Admin public key published.');
            } catch (e: any) {
                Logger.warn('Moderation', `Failed to publish admin key (Not an admin?): ${e.message}`);
                throw new AuthError('Permission denied. You do not have admin S3 credentials.');
            }
        }
    }

    /**
     * Submit a report against a user or piece of content.
     * Reports are encrypted with the Admin's public key and saved to 'admin/reports/'.
     */
    async reportContent(targetUserId: string, contentId: string, contentType: 'post' | 'comment' | 'message', reason: string, evidence?: any) {
        const adminRemote = this.context.remotes.getAdminRemote();
        if (!adminRemote) throw new SovereignError('CONFIG_ERROR', 'Admin remote not configured.');

        // 1. Get Admin Public Key (Try cache first, then S3)
        let adminPublicKey = this.context.adminPublicKey;
        
        if (!adminPublicKey) {
            try {
                const result = await adminRemote.downloadFile(PATHS.ADMIN_PUBLIC_KEY);
                if (result && result.data) {
                    const data = JSON.parse(new TextDecoder().decode(result.data));
                    adminPublicKey = data.publicKey;
                } else {
                    throw new AuthError('Admin public key not found.');
                }
            } catch (e: any) {
                if (e instanceof AuthError) throw e;
                throw new AuthError(`Failed to fetch admin key: ${e.message}. The system might not have an admin configured.`);
            }
        }

        // 2. Prepare Report
        const report: Report = {
            id: `report-${env.generateId(12)}`,
            reporterId: this.context.userId,
            targetUserId,
            contentId,
            contentType,
            reason,
            timestamp: Date.now(),
            evidence
        };

        const reportData = new TextEncoder().encode(JSON.stringify(report));

        // 3. Encrypt Report for Admin
        const sharedSecret = this.context.deriveSharedSecret(adminPublicKey!);
        const encryptedData = await this.context.encrypt(reportData, sharedSecret);

        // 4. Upload to Admin Remote
        const myPublicKey = this.context.publicKey;
        // We include PK in filename as fallback for metadata-stripped backends (like RustFS)
        const reportPath = `reports/${myPublicKey}.${report.id}.enc`;
        
        await adminRemote.uploadFile(reportPath, encryptedData, undefined, { 'reporter-pk': myPublicKey! });
        Logger.info('Moderation', `Report ${report.id} submitted securely.`);
    }

    /**
     * (Admin Only) Fetch and decrypt all pending reports.
     */
    async getReports(): Promise<Report[]> {
        const adminRemote = this.context.remotes.getAdminRemote();
        if (!adminRemote || !adminRemote.listFiles) return [];

        Logger.info('Moderation', 'Admin fetching and decrypting reports...');
        const files = await adminRemote.listFiles('reports/');
        const reports: Report[] = [];

        for (const file of files) {
            if (!file.endsWith('.enc')) continue;
            try {
                // Try to get reporter PK from filename first (most reliable on RustFS)
                // path is reports/PUBLIC_KEY.report-id.enc
                let reporterPk: string | null = null;
                const fileName = file.split('/').pop() || '';
                const parts = fileName.split('.');
                if (parts.length >= 3) {
                    reporterPk = parts[0];
                }

                // Fallback to metadata if filename didn't work
                if (!reporterPk && adminRemote.getFileMetadata) {
                    reporterPk = await adminRemote.getFileMetadata(file, 'reporter-pk');
                }
                
                const result = await adminRemote.downloadFile(file);
                
                if (result && result.data && reporterPk) {
                    const sharedSecret = this.context.deriveSharedSecret(reporterPk);
                    const decrypted = await this.context.decrypt(result.data, sharedSecret);
                    const report: Report = JSON.parse(new TextDecoder().decode(decrypted));
                    reports.push(report);
                }
            } catch (e: any) {
                Logger.warn('Moderation', `Failed to decrypt report ${file}: ${e.message}`);
            }
        }
        return reports; 
    }

    /**
     * (Admin Only) Deletes a specific file belonging to any user.
     * Path should be relative to the appId root (e.g., 'user-123/public/modules/feed/2026-03-22.db')
     */
    async deleteUserFile(path: string) {
        const rootRemote = this.context.remotes.getRootRemote();
        if (!rootRemote || !rootRemote.deleteFile) {
            throw new SovereignError('CONFIG_ERROR', 'Root remote not configured or missing deleteFile capability.');
        }
        await rootRemote.deleteFile(path);
        Logger.info('Moderation', `Admin deleted file: ${path}`);
    }

    /**
     * (Admin Only) Deletes a report after processing.
     */
    async deleteReport(reportId: string) {
        const adminRemote = this.context.remotes.getAdminRemote();
        if (!adminRemote || !adminRemote.listFiles || !adminRemote.deleteFile) return;

        // Find the encrypted report file (it contains the PK in the name)
        const files = await adminRemote.listFiles('reports/');
        const reportFile = files.find((f: string) => f.includes(reportId));
        
        if (reportFile) {
            await adminRemote.deleteFile(reportFile);
            Logger.info('Moderation', `Admin deleted report: ${reportId}`);
        }
    }

    /**
     * (Admin Only) Add a user to the global blacklist.
     */
    async blacklistUser(userId: string) {
        const globalRemote = this.context.remotes.getGlobalRemote();
        if (!globalRemote) return;

        const path = PATHS.BLACKLIST;
        let blacklist: string[] = [];

        try {
            const result = await globalRemote.downloadFile(path);
            if (result && result.data) {
                blacklist = JSON.parse(new TextDecoder().decode(result.data));
            }
        } catch (e: any) {
            Logger.debug('Moderation', `Could not download blacklist: ${e.message}`);
        }

        if (!blacklist.includes(userId)) {
            blacklist.push(userId);
            try {
                await globalRemote.uploadFile(path, new TextEncoder().encode(JSON.stringify(blacklist)));
                Logger.info('Moderation', `User ${userId} blacklisted.`);
            } catch (e: any) {
                Logger.warn('Moderation', `Failed to blacklist user (Not an admin?): ${e.message}`);
                throw new AuthError('Permission denied. Your S3 credentials do not have write access to the global registry.');
            }
        }
    }

    /**
     * (Admin Only) Removes a user from the global registry.
     */
    async removeFromGlobalRegistry(userId: string) {
        const globalRemote = this.context.remotes.getGlobalRemote();
        if (!globalRemote) return;

        const path = PATHS.USERS_REGISTRY;
        try {
            const result = await globalRemote.downloadFile(path);
            if (result && result.data) {
                let users: { userId: string, publicKey: string }[] = JSON.parse(new TextDecoder().decode(result.data));
                const filtered = users.filter(u => u.userId !== userId);
                if (filtered.length !== users.length) {
                    await globalRemote.uploadFile(path, new TextEncoder().encode(JSON.stringify(filtered)));
                    Logger.info('Moderation', `User ${userId} removed from global registry.`);
                }
            }
        } catch (e: any) {
            Logger.warn('Moderation', `Failed to update global registry during user removal: ${e.message}`);
        }

        try {
            const entryPath = `${PATHS.REGISTRY_ENTRIES_PREFIX}${userId}.json`;
            if (globalRemote.deleteFile) {
                await globalRemote.deleteFile(entryPath);
                Logger.info('Moderation', `User ${userId} entry removed from V2 global registry.`);
            }
        } catch (e: any) {
            Logger.warn('Moderation', `Failed to delete entry from V2 global registry: ${e.message}`);
        }
    }

    /**
     * (Admin Only) Performs a 'Hard Ban': Blacklists, removes from registry, and deletes ALL associated data.
     */
    async banUser(userId: string) {
        Logger.info('Moderation', `Banning user ${userId}...`);
        
        // 1. Social Ban
        await this.blacklistUser(userId);
        await this.removeFromGlobalRegistry(userId);
        
        // 2. Infrastructure Wipe (Delete everything under userId/ prefix)
        const rootRemote = this.context.remotes.getRootRemote();
        if (rootRemote && rootRemote.listFiles && rootRemote.deleteFile) {
            try {
                const userFiles = await rootRemote.listFiles(`${userId}/`);
                for (const file of userFiles) {
                    await rootRemote.deleteFile(file);
                }
                Logger.info('Moderation', `Deleted ${userFiles.length} files for banned user ${userId}.`);
            } catch (e: any) {
                Logger.warn('Moderation', `Failed to wipe infrastructure for user ${userId}: ${e.message}`);
            }
        }
        
        Logger.info('Moderation', `User ${userId} has been banned and their data purged.`);
    }

    /**
     * (Admin Only) Request a user to delete a specific post.
     * This is an E2EE request sent to the user's public prefix.
     */
    async requestPostDeletion(targetUserId: string, postId: string, date: string) {
        const rootRemote = this.context.remotes.getRootRemote();
        if (!rootRemote) throw new SovereignError('CONFIG_ERROR', 'Root remote not configured.');

        // 1. Get Target User Public Key
        const registry = await this.context.getPublicRegistry();
        const user = registry.find(u => u.userId === targetUserId);
        if (!user || !user.publicKey) throw new AuthError(`User ${targetUserId} not found or has no public key.`);

        // 2. Prepare Request
        const request = {
            action: 'delete_post',
            module: 'feed',
            postId,
            date,
            timestamp: Date.now()
        };

        const requestData = new TextEncoder().encode(JSON.stringify(request));

        // 3. Encrypt Request for User
        const sharedSecret = this.context.deriveSharedSecret(user.publicKey);
        const encryptedData = await this.context.encrypt(requestData, sharedSecret);

        // 4. Upload to User's Public Prefix
        // Path: [targetUserId]/[storeId]/public/moderation/requests/[postId].enc
        const storeId = this.context.storeId;
        const path = `${targetUserId}/${storeId}/public/moderation/requests/${postId}.enc`;
        await rootRemote.uploadFile(path, encryptedData);
        Logger.info('Moderation', `Deletion request for post ${postId} sent to user ${targetUserId}.`);
    }

    /**
     * (Admin Only) Lists all unique user IDs present in the appId namespace.
     * Combines literal directory names, global registry entries, and hashed private folders.
     */
    async listUsers(): Promise<string[]> {
        const rootRemote = this.context.remotes.getRootRemote();
        const globalRemote = this.context.remotes.getGlobalRemote();
        if (!rootRemote || !rootRemote.listFiles) {
            throw new SovereignError('CONFIG_ERROR', 'Root remote not configured or missing listFiles capability.');
        }
        
        const users = new Set<string>();

        // 1. Get from Global Registry (Source of truth for literal names)
        if (globalRemote) {
            try {
                const result = await globalRemote.downloadFile(PATHS.USERS_REGISTRY);
                if (result && result.data) {
                    const registry: { userId: string }[] = JSON.parse(new TextDecoder().decode(result.data));
                    registry.forEach(u => users.add(u.userId));
                }
            } catch (e: any) {
                Logger.debug('Moderation', `Could not fetch registry users during listAllUsers: ${e.message}`);
            }
        }

        // 2. Get from S3 Directory Listing (Finds literal names AND hashes)
        const files = await rootRemote.listFiles('');
        for (const file of files) {
            const parts = file.split('/');
            if (parts.length > 0 && parts[0] !== '') {
                users.add(parts[0]);
            }
        }

        // Filter out system folders
        users.delete('global');
        users.delete('admin');

        return Array.from(users).sort();
    }

    /**
     * (Admin Only) Lists all files in the appId namespace, optionally filtered by prefix.
     */
    async listFiles(prefix: string = ''): Promise<string[]> {
        const rootRemote = this.context.remotes.getRootRemote();
        if (!rootRemote || !rootRemote.listFiles) {
            throw new SovereignError('CONFIG_ERROR', 'Root remote not configured or missing listFiles capability.');
        }
        return await rootRemote.listFiles(prefix);
    }

    /**
     * (Admin Only) Exports all data under the appId namespace as a JSON string containing base64 encoded files.
     */
    async exportAllData(): Promise<string> {
        const rootRemote = this.context.remotes.getRootRemote();
        if (!rootRemote || !rootRemote.listFiles || !rootRemote.downloadFile) {
            throw new SovereignError('CONFIG_ERROR', 'Root remote not configured or missing listFiles capability. Are you an admin?');
        }
        
        Logger.info('Moderation', 'Exporting all data...');
        const files = await rootRemote.listFiles('');
        const exportData: Record<string, string> = {};
        
        for (const file of files) {
            try {
                const result = await rootRemote.downloadFile(file);
                if (result && result.data) {
                    exportData[file] = Buffer.from(result.data).toString('base64');
                }
            } catch (e: any) {
                Logger.warn('Moderation', `Failed to export file ${file}: ${e.message}`);
            }
        }
        
        return JSON.stringify(exportData);
    }

    /**
     * (Admin Only) Imports a JSON dump of base64 files and overwrites/creates them on the remote.
     */
    async importAllData(jsonData: string) {
        const rootRemote = this.context.remotes.getRootRemote();
        if (!rootRemote) throw new SovereignError('CONFIG_ERROR', 'Root remote not configured. Are you an admin?');
        
        Logger.info('Moderation', 'Importing data...');
        const parsed = JSON.parse(jsonData);
        for (const [path, base64Data] of Object.entries(parsed)) {
            try {
                const data = Buffer.from(base64Data as string, 'base64');
                await rootRemote.uploadFile(path, data);
            } catch (e: any) {
                Logger.warn('Moderation', `Failed to import file ${path}: ${e.message}`);
            }
        }
        Logger.info('Moderation', 'Data import complete.');
    }

    /**
     * (Admin Only) Deletes all files in the appId namespace permanently.
     */
    async burnItToTheGround() {
        const rootRemote = this.context.remotes.getRootRemote();
        if (!rootRemote || !rootRemote.listFiles || !rootRemote.deleteFile) {
            throw new SovereignError('CONFIG_ERROR', 'Root remote not configured or missing deleteFile capability. Are you an admin?');
        }

        Logger.info('Moderation', 'Warning: Initiating Burn It To The Ground protocol...');
        const files = await rootRemote.listFiles('');
        for (const file of files) {
            try {
                await rootRemote.deleteFile(file);
            } catch (e: any) {
                Logger.warn('Moderation', `Failed to delete ${file}: ${e.message}`);
            }
        }
        Logger.info('Moderation', 'All data has been deleted from the remote backend.');
    }
}
