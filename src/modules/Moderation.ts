
import { SovereignS3nc } from '../SovereignS3nc';
import { Logger } from '../utils/Logger';
import { Buffer } from 'buffer';

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
    constructor(private sovereign: SovereignS3nc) {}

    /**
     * Determine if the current user has write access to the admin prefix by probing S3.
     */
    async isAdmin(): Promise<boolean> {
        const adminRemote = (this.sovereign as any).adminRemote;
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
        const adminRemote = (this.sovereign as any).adminRemote;
        const pk = this.sovereign.getConfig().publicEncryptionKey;
        if (adminRemote && pk) {
            try {
                await adminRemote.uploadFile('public_key.json', new TextEncoder().encode(JSON.stringify({ publicKey: pk })));
                Logger.info('[Moderation] Admin public key published.');
            } catch (e: any) {
                Logger.warn(`[Moderation] Failed to publish admin key (Not an admin?): ${e.message}`);
                throw new Error('Permission denied. You do not have admin S3 credentials.');
            }
        }
    }

    /**
     * Submit a report against a user or piece of content.
     * Reports are encrypted with the Admin's public key and saved to 'admin/reports/'.
     */
    async reportContent(targetUserId: string, contentId: string, contentType: 'post' | 'comment' | 'message', reason: string, evidence?: any) {
        const adminRemote = (this.sovereign as any).adminRemote;
        if (!adminRemote) throw new Error("Admin remote not configured.");

        // 1. Get Admin Public Key (Try cache first, then S3)
        let adminPublicKey = this.sovereign.getConfig().adminPublicKey;
        
        if (!adminPublicKey) {
            try {
                const result = await adminRemote.downloadFile('public_key.json');
                if (result && result.data) {
                    const data = JSON.parse(new TextDecoder().decode(result.data));
                    adminPublicKey = data.publicKey;
                } else {
                    throw new Error("Admin public key not found.");
                }
            } catch (e: any) {
                throw new Error(`Failed to fetch admin key: ${e.message}. The system might not have an admin configured.`);
            }
        }

        // 2. Prepare Report
        const report: Report = {
            id: `report-${Math.random().toString(36).substring(7)}`,
            reporterId: this.sovereign.getConfig().paths.userId,
            targetUserId,
            contentId,
            contentType,
            reason,
            timestamp: Date.now(),
            evidence
        };

        const reportData = new TextEncoder().encode(JSON.stringify(report));

        // 3. Encrypt Report for Admin
        const sharedSecret = this.sovereign.deriveSharedSecret(adminPublicKey!);
        const encryptedData = await this.sovereign.encrypt(reportData, sharedSecret);

        // 4. Upload to Admin Remote
        const myPublicKey = this.sovereign.getConfig().publicEncryptionKey;
        // We include PK in filename as fallback for metadata-stripped backends (like RustFS)
        const reportPath = `reports/${myPublicKey}.${report.id}.enc`;
        
        await adminRemote.uploadFile(reportPath, encryptedData, undefined, { 'reporter-pk': myPublicKey! });
        Logger.info(`[Moderation] Report ${report.id} submitted securely.`);
    }

    /**
     * (Admin Only) Fetch and decrypt all pending reports.
     */
    async getReports(): Promise<Report[]> {
        const adminRemote = (this.sovereign as any).adminRemote;
        if (!adminRemote || !adminRemote.listFiles) return [];

        Logger.info('[Moderation] Admin fetching and decrypting reports...');
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
                    const sharedSecret = this.sovereign.deriveSharedSecret(reporterPk);
                    const decrypted = await this.sovereign.decrypt(result.data, sharedSecret);
                    const report: Report = JSON.parse(new TextDecoder().decode(decrypted));
                    reports.push(report);
                }
            } catch (e: any) {
                Logger.warn(`[Moderation] Failed to decrypt report ${file}: ${e.message}`);
            }
        }
        return reports; 
    }

    /**
     * (Admin Only) Deletes a specific file belonging to any user.
     * Path should be relative to the appId root (e.g., 'user-123/public/modules/feed/2026-03-22.db')
     */
    async deleteUserFile(path: string) {
        const rootRemote = (this.sovereign as any).rootRemote;
        if (!rootRemote || !rootRemote.deleteFile) {
            throw new Error("Root remote not configured or missing deleteFile capability.");
        }
        await rootRemote.deleteFile(path);
        Logger.info(`[Moderation] Admin deleted file: ${path}`);
    }

    /**
     * (Admin Only) Deletes a report after processing.
     */
    async deleteReport(reportId: string) {
        const adminRemote = (this.sovereign as any).adminRemote;
        if (!adminRemote || !adminRemote.listFiles || !adminRemote.deleteFile) return;

        // Find the encrypted report file (it contains the PK in the name)
        const files = await adminRemote.listFiles('reports/');
        const reportFile = files.find((f: string) => f.includes(reportId));
        
        if (reportFile) {
            await adminRemote.deleteFile(reportFile);
            Logger.info(`[Moderation] Admin deleted report: ${reportId}`);
        }
    }

    /**
     * (Admin Only) Add a user to the global blacklist.
     */
    async blacklistUser(userId: string) {
        const globalRemote = (this.sovereign as any).globalRemote;
        if (!globalRemote) return;

        const path = 'blacklist.json';
        let blacklist: string[] = [];

        try {
            const result = await globalRemote.downloadFile(path);
            if (result && result.data) {
                blacklist = JSON.parse(new TextDecoder().decode(result.data));
            }
        } catch (e) {}

        if (!blacklist.includes(userId)) {
            blacklist.push(userId);
            try {
                await globalRemote.uploadFile(path, new TextEncoder().encode(JSON.stringify(blacklist)));
                Logger.info(`[Moderation] User ${userId} blacklisted.`);
            } catch (e: any) {
                Logger.warn(`[Moderation] Failed to blacklist user (Not an admin?): ${e.message}`);
                throw new Error('Permission denied. Your S3 credentials do not have write access to the global registry.');
            }
        }
    }

    /**
     * (Admin Only) Removes a user from the global registry.
     */
    async removeFromGlobalRegistry(userId: string) {
        const globalRemote = (this.sovereign as any).globalRemote;
        if (!globalRemote) return;

        const path = 'users.json';
        try {
            const result = await globalRemote.downloadFile(path);
            if (result && result.data) {
                let users: { userId: string, publicKey: string }[] = JSON.parse(new TextDecoder().decode(result.data));
                const filtered = users.filter(u => u.userId !== userId);
                if (filtered.length !== users.length) {
                    await globalRemote.uploadFile(path, new TextEncoder().encode(JSON.stringify(filtered)));
                    Logger.info(`[Moderation] User ${userId} removed from global registry.`);
                }
            }
        } catch (e) {}
    }

    /**
     * (Admin Only) Performs a 'Hard Ban': Blacklists, removes from registry, and deletes ALL associated data.
     */
    async banUser(userId: string) {
        Logger.info(`[Moderation] Banning user ${userId}...`);
        
        // 1. Social Ban
        await this.blacklistUser(userId);
        await this.removeFromGlobalRegistry(userId);
        
        // 2. Infrastructure Wipe (Delete everything under userId/ prefix)
        const rootRemote = (this.sovereign as any).rootRemote;
        if (rootRemote && rootRemote.listFiles && rootRemote.deleteFile) {
            try {
                const userFiles = await rootRemote.listFiles(`${userId}/`);
                for (const file of userFiles) {
                    await rootRemote.deleteFile(file);
                }
                Logger.info(`[Moderation] Deleted ${userFiles.length} files for banned user ${userId}.`);
            } catch (e: any) {
                Logger.warn(`[Moderation] Failed to wipe infrastructure for user ${userId}: ${e.message}`);
            }
        }
        
        Logger.info(`[Moderation] User ${userId} has been banned and their data purged.`);
    }

    /**
     * (Admin Only) Lists all unique user IDs present in the appId namespace.
     */
    async listUsers(): Promise<string[]> {
        const rootRemote = (this.sovereign as any).rootRemote;
        if (!rootRemote || !rootRemote.listFiles) {
            throw new Error("Root remote not configured or missing listFiles capability.");
        }
        
        const files = await rootRemote.listFiles('');
        const users = new Set<string>();
        for (const file of files) {
            const parts = file.split('/');
            if (parts.length > 0 && parts[0] !== '') {
                users.add(parts[0]);
            }
        }
        return Array.from(users).sort();
    }

    /**
     * (Admin Only) Lists all files in the appId namespace, optionally filtered by prefix.
     */
    async listFiles(prefix: string = ''): Promise<string[]> {
        const rootRemote = (this.sovereign as any).rootRemote;
        if (!rootRemote || !rootRemote.listFiles) {
            throw new Error("Root remote not configured or missing listFiles capability.");
        }
        return await rootRemote.listFiles(prefix);
    }

    /**
     * (Admin Only) Exports all data under the appId namespace as a JSON string containing base64 encoded files.
     */
    async exportAllData(): Promise<string> {
        const rootRemote = (this.sovereign as any).rootRemote;
        if (!rootRemote || !rootRemote.listFiles || !rootRemote.downloadFile) {
            throw new Error("Root remote not configured or missing listFiles capability. Are you an admin?");
        }
        
        Logger.info('[Moderation] Exporting all data...');
        const files = await rootRemote.listFiles('');
        const exportData: Record<string, string> = {};
        
        for (const file of files) {
            try {
                const result = await rootRemote.downloadFile(file);
                if (result && result.data) {
                    exportData[file] = Buffer.from(result.data).toString('base64');
                }
            } catch (e: any) {
                Logger.warn(`[Moderation] Failed to export file ${file}: ${e.message}`);
            }
        }
        
        return JSON.stringify(exportData);
    }

    /**
     * (Admin Only) Imports a JSON dump of base64 files and overwrites/creates them on the remote.
     */
    async importAllData(jsonData: string) {
        const rootRemote = (this.sovereign as any).rootRemote;
        if (!rootRemote) throw new Error("Root remote not configured. Are you an admin?");
        
        Logger.info('[Moderation] Importing data...');
        const parsed = JSON.parse(jsonData);
        for (const [path, base64Data] of Object.entries(parsed)) {
            try {
                const data = Buffer.from(base64Data as string, 'base64');
                await rootRemote.uploadFile(path, data);
            } catch (e: any) {
                Logger.warn(`[Moderation] Failed to import file ${path}: ${e.message}`);
            }
        }
        Logger.info('[Moderation] Data import complete.');
    }

    /**
     * (Admin Only) Deletes all files in the appId namespace permanently.
     */
    async burnItToTheGround() {
        const rootRemote = (this.sovereign as any).rootRemote;
        if (!rootRemote || !rootRemote.listFiles || !rootRemote.deleteFile) {
            throw new Error("Root remote not configured or missing deleteFile capability. Are you an admin?");
        }

        Logger.info('[Moderation] Warning: Initiating Burn It To The Ground protocol...');
        const files = await rootRemote.listFiles('');
        for (const file of files) {
            try {
                await rootRemote.deleteFile(file);
            } catch (e: any) {
                Logger.warn(`[Moderation] Failed to delete ${file}: ${e.message}`);
            }
        }
        Logger.info('[Moderation] All data has been deleted from the remote backend.');
    }
}
