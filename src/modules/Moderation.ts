
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
            // Probe: Try to write a small sentinel file to verify write access
            const sentinel = new TextEncoder().encode(JSON.stringify({ lastProbe: Date.now() }));
            await adminRemote.uploadFile('.probe', sentinel);
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

        // 1. Fetch Admin Public Key
        let adminPublicKey = '';
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
        const sharedSecret = this.sovereign.deriveSharedSecret(adminPublicKey);
        const encryptedData = await this.sovereign.encrypt(reportData, sharedSecret);

        // 4. Upload to Admin Remote
        const reportPath = `reports/${report.id}.enc`;
        await adminRemote.uploadFile(reportPath, encryptedData);
        Logger.info(`[Moderation] Report ${report.id} submitted securely.`);
    }

    /**
     * (Admin Only) Fetch and decrypt all pending reports.
     */
    async getReports(): Promise<Report[]> {
        // Since we don't have a listFiles in S3RemoteAdapter yet for arbitrary prefixes cleanly,
        // we might have to rely on a manifest or an external crawler.
        // For a true S3 implementation, you'd listObjectsV2 on `appId/admin/reports/`.
        // We will simulate returning empty for now unless we implement listFiles on the remote adapter.
        Logger.info('[Moderation] Admin fetching reports (Requires S3 ListObjects capability)...');
        return []; 
    }

    /**
     * (Admin Only) Add a user to the global blacklist.
     */
    async blacklistUser(userId: string) {
        const adminRemote = (this.sovereign as any).adminRemote;
        if (!adminRemote) return;

        const path = 'blacklist.json';
        let blacklist: string[] = [];

        try {
            const result = await adminRemote.downloadFile(path);
            if (result && result.data) {
                blacklist = JSON.parse(new TextDecoder().decode(result.data));
            }
        } catch (e) {}

        if (!blacklist.includes(userId)) {
            blacklist.push(userId);
            try {
                await adminRemote.uploadFile(path, new TextEncoder().encode(JSON.stringify(blacklist)));
                Logger.info(`[Moderation] User ${userId} blacklisted.`);
            } catch (e: any) {
                Logger.warn(`[Moderation] Failed to blacklist user (Not an admin?): ${e.message}`);
                throw new Error('Permission denied. You do not have admin S3 credentials.');
            }
        }
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
