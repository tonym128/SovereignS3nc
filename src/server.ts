
import * as http from 'http';
import { SovereignS3nc } from './SovereignS3nc';
import { SQLiteNodeStorage } from './adapters/SQLiteNodeStorage';
import { ProfileModule } from './modules/Profile';
import { MessagingModule } from './modules/Messaging';
import { FeedModule } from './modules/Feed';
import { Logger } from './utils/Logger';
import * as path from 'path';

/**
 * SovereignNode is a standalone server that maintains a user's decentralized node.
 * It handles background synchronization, profile discovery, and exposes a minimal status API.
 */
class SovereignNode {
    private sov: SovereignS3nc;
    private profile: ProfileModule;
    private messaging: MessagingModule;
    private feed: FeedModule;
    private config: any;
    private port: number;
    private syncInterval: number;

    constructor(config: any) {
        this.config = config;
        this.port = config.port || 3000;
        this.syncInterval = config.syncIntervalMs || 60000; // Default 1 minute

        const dbPath = config.dbPath || path.join(process.cwd(), 'sovereign.db');
        const storage = new SQLiteNodeStorage(dbPath);

        this.sov = new SovereignS3nc(config, undefined, undefined, undefined, storage);
        this.profile = new ProfileModule(this.sov);
        this.messaging = new MessagingModule(this.sov);
        this.feed = new FeedModule(this.sov);
    }

    async start() {
        Logger.info(`[Server] Starting Sovereign Node for ${this.config.paths.userId}...`);
        await this.sov.init();

        // Initial Sync
        Logger.info('[Server] Performing initial sync...');
        await this.sov.sync();

        // Setup background sync
        setInterval(async () => {
            try {
                Logger.info('[Server] Running background sync...');
                await this.sov.sync();
            } catch (e: any) {
                Logger.error(`[Server] Sync failed: ${e.message}`);
            }
        }, this.syncInterval);

        // Start HTTP status API
        const server = http.createServer(async (req, res) => {
            res.setHeader('Content-Type', 'application/json');

            if (req.url === '/status') {
                const status = {
                    version: SovereignS3nc.VERSION,
                    userId: this.config.paths.userId,
                    lastSync: await this.sov.getStorage().getLastSyncDate(),
                    followingCount: (await this.sov.getFollowing()).length,
                    uptime: process.uptime()
                };
                res.writeHead(200);
                res.end(JSON.stringify(status));
            } else if (req.url === '/sync') {
                // Manual trigger
                this.sov.sync().catch(e => Logger.error(`[Server] Manual sync failed: ${e.message}`));
                res.writeHead(202);
                res.end(JSON.stringify({ message: 'Sync triggered' }));
            } else {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Not Found' }));
            }
        });

        server.listen(this.port, () => {
            Logger.info(`[Server] Status API listening on http://localhost:${this.port}/status`);
        });
    }
}

// Minimal bootstrap if run directly
if (require.main === module) {
    const config = {
        s3: {
            endpoint: process.env.S3_ENDPOINT || 'http://localhost:3900',
            region: process.env.S3_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY || 'GK3ca649176313936569107936',
                secretAccessKey: process.env.S3_SECRET_KEY || 'GSe258284534735914101479'
            },
            bucketName: process.env.S3_BUCKET || 'sovereign',
            forcePathStyle: true
        },
        paths: {
            appId: process.env.APP_ID || 'social-demo',
            userId: process.env.USER_ID || 'server-node',
            storeId: process.env.STORE_ID || 'main'
        },
        password: process.env.PASSWORD || 'server-node-pass',
        port: parseInt(process.env.PORT || '3000'),
        syncIntervalMs: parseInt(process.env.SYNC_INTERVAL || '60000'),
        dbPath: process.env.DB_PATH || path.join(process.cwd(), 'sovereign.db')
    };

    const node = new SovereignNode(config);
    node.start().catch(e => {
        console.error('Failed to start Sovereign Node:', e);
        process.exit(1);
    });
}

export { SovereignNode };
