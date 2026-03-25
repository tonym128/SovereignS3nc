import { SovereignS3nc } from '../src/SovereignS3nc';
import { NodeStorage } from '../src/adapters/NodeStorage';
import * as path from 'path';
import * as fs from 'fs-extra';
import { FeedModule, Post } from '../src/modules/Feed';
import { ProfileModule, Profile } from '../src/modules/Profile';
import initSqlJs from 'sql.js';

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.log('Usage: npx ts-node scripts/static-export.ts <userId> <appId> <outputDir> [dataDir]');
        process.exit(1);
    }

    const [userId, appId, outputDir, dataDir] = args;
    
    // Default baseDir if dataDir not provided
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const defaultBaseDir = path.join(homeDir, '.sovereigns3nc', appId, userId);
    const baseDir = dataDir ? path.resolve(dataDir) : defaultBaseDir;

    console.log(`Exporting data for user: ${userId}, app: ${appId}`);
    console.log(`Source data: ${baseDir}`);
    console.log(`Output directory: ${outputDir}`);

    if (!fs.existsSync(baseDir)) {
        console.error(`Data directory not found: ${baseDir}`);
        process.exit(1);
    }

    await fs.ensureDir(outputDir);

    // Initialize SQL.js for Node
    (globalThis as any).initSqlJs = initSqlJs;

    const storage = new NodeStorage(baseDir);
    const sov = new SovereignS3nc({
        paths: {
            userId,
            appId,
            storeId: 'data'
        },
        offline: true
    }, undefined, undefined, undefined, storage);

    await sov.init();

    const profileModule = new ProfileModule(sov);
    const feedModule = new FeedModule(sov);

    // 1. Export Profile
    const profile = await profileModule.getProfile(userId);
    if (profile) {
        await fs.writeJSON(path.join(outputDir, 'profile.json'), profile, { spaces: 2 });
        console.log('Exported profile.json');
    } else {
        console.warn('Profile not found.');
    }

    // 2. Export Feed
    const feedPrefix = sov.getModulePath('feed', '', 'public');
    const files = await sov.getStorage().listFiles(feedPrefix);
    const dbFiles = files.filter(f => f.endsWith('.db'));
    
    const allPosts: Post[] = [];
    for (const dbFile of dbFiles) {
        // dbFile is like "public/modules/feed/2024-03-25.db"
        const fileName = path.basename(dbFile);
        const dateStr = fileName.replace('.db', '');
        const posts = await feedModule.getPosts(dateStr, 'public');
        allPosts.push(...posts);
    }

    allPosts.sort((a, b) => b.timestamp - a.timestamp);
    console.log(`Found ${allPosts.length} posts.`);

    // 3. Export Blobs (images)
    const blobsOutputDir = path.join(outputDir, 'blobs');
    await fs.ensureDir(blobsOutputDir);

    for (const post of allPosts) {
        if (post.image && post.image.startsWith('public/blobs/')) {
            const blobPath = post.image;
            const blobName = path.basename(blobPath);
            const blobData = await sov.getStorage().getFile(blobPath);
            
            if (blobData) {
                await fs.writeFile(path.join(blobsOutputDir, blobName), blobData);
                // Update post image path to be relative for static serving
                post.image = `blobs/${blobName}`;
            } else {
                console.warn(`Blob not found in storage: ${blobPath}`);
            }
        }
    }

    // Save feed.json with relative image paths
    await fs.writeJSON(path.join(outputDir, 'feed.json'), allPosts, { spaces: 2 });
    console.log(`Exported feed.json with ${allPosts.length} posts.`);

    console.log('Export complete.');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
