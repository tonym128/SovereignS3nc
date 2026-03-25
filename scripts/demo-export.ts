import { SovereignS3nc } from '../src/SovereignS3nc';
import { NodeStorage } from '../src/adapters/NodeStorage';
import { FeedModule } from '../src/modules/Feed';
import { ProfileModule } from '../src/modules/Profile';
import * as path from 'path';
import * as fs from 'fs-extra';
import initSqlJs from 'sql.js';
import { execSync } from 'child_process';

async function runDemo() {
    const userId = 'demo-user';
    const appId = 'demo-app';
    const tempDataDir = path.resolve('./temp-data');
    const exportOutputDir = path.resolve('./export-output');

    console.log('--- Starting Demo Run ---');
    
    // Cleanup
    if (fs.existsSync(tempDataDir)) fs.removeSync(tempDataDir);
    if (fs.existsSync(exportOutputDir)) fs.removeSync(exportOutputDir);

    // Initialize SQL.js
    (globalThis as any).initSqlJs = initSqlJs;

    console.log('1. Populating mock data...');
    const storage = new NodeStorage(tempDataDir);
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

    // Update profile
    await profileModule.updateProfile('Demo User', 'This is a demo bio');
    console.log('Profile updated.');

    // Create a mock image
    const mockImage = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]); // Small fake PNG header
    
    // Post something
    await feedModule.post('Hello from the demo!', true);
    await feedModule.post('Check out this image!', true, mockImage);
    console.log('Posts created.');

    console.log('2. Running static-export.ts...');
    // We run it via ts-node
    try {
        const cmd = `npx ts-node scripts/static-export.ts ${userId} ${appId} ${exportOutputDir} ${tempDataDir}`;
        console.log(`Executing: ${cmd}`);
        execSync(cmd, { stdio: 'inherit' });
    } catch (e) {
        console.error('Export script failed:', e);
        process.exit(1);
    }

    console.log('3. Verifying output...');
    const profileJson = path.join(exportOutputDir, 'profile.json');
    const feedJson = path.join(exportOutputDir, 'feed.json');
    const blobsDir = path.join(exportOutputDir, 'blobs');

    if (!fs.existsSync(profileJson)) throw new Error('profile.json missing');
    if (!fs.existsSync(feedJson)) throw new Error('feed.json missing');
    if (!fs.existsSync(blobsDir)) throw new Error('blobs directory missing');

    const profile = fs.readJSONSync(profileJson);
    const feed = fs.readJSONSync(feedJson);
    const blobs = fs.readdirSync(blobsDir);

    console.log('Profile:', profile);
    console.log('Feed count:', feed.length);
    console.log('Blobs found:', blobs);

    if (profile.name !== 'Demo User') throw new Error('Profile name mismatch');
    if (feed.length !== 2) throw new Error('Feed length mismatch');
    if (blobs.length !== 1) throw new Error('Blob count mismatch');

    console.log('--- Demo Successful! ---');
    
    // Cleanup
    if (fs.existsSync(tempDataDir)) fs.removeSync(tempDataDir);
    if (fs.existsSync(exportOutputDir)) fs.removeSync(exportOutputDir);
}

runDemo().catch(err => {
    console.error('Demo failed:', err);
    process.exit(1);
});
