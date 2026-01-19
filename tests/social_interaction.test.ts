import { exec } from 'child_process';
import { promisify } from 'util';
import { SovereignS3nc } from '../src/SovereignS3nc';
import { SovereignConfig } from '../src/types';
import { Post, Comment, Profile } from '../src/modules/Social';

const execAsync = promisify(exec);

const IMAGE_NAME = 'sovereigns3nc-test';
const CONTAINER_NAME = 'sovereigns3nc-social-test';
const PORT_WEB = 8083;
const PORT_S3 = 3906;
const BUCKET_NAME = 'sovereign-demo';

// Increase timeout for docker operations
jest.setTimeout(300000);

describe('Social Network Integration Test', () => {
    
    let accessKey: string;
    let secretKey: string;

    const cleanup = async () => {
        try { await execAsync(`docker rm -f ${CONTAINER_NAME}`); } catch (e) {}
    };

    beforeAll(async () => {
        // Always build to ensure latest changes (especially start.sh line endings) are included
        console.log('Building Docker image...');
        await execAsync(`docker build -t ${IMAGE_NAME} .`);
        
        await cleanup();

        console.log('Starting container...');
        await execAsync(`docker run -d --name ${CONTAINER_NAME} -p ${PORT_S3}:3900 -p ${PORT_WEB}:8080 ${IMAGE_NAME}`);

        console.log('Waiting for startup...');
        let ready = false;
        let attempts = 0;
        let lastStdout = '';
        while (!ready && attempts < 60) {
            await new Promise(r => setTimeout(r, 1000));
            try {
                const { stdout } = await execAsync(`docker logs ${CONTAINER_NAME}`);
                lastStdout = stdout;
                if (stdout.includes('SOVEREIGN S3NC DEMO ENV SETUP COMPLETE')) {
                    ready = true;
                }
            } catch (e) { } // Ignore errors during startup checks
            attempts++;
        }
        
        if (!ready) {
             const logs = await execAsync(`docker logs ${CONTAINER_NAME}`);
             console.error('Container logs:', logs.stdout, logs.stderr);
             throw new Error('Container failed to start');
        }

        // Extract Credentials
        const accessKeyMatch = lastStdout.match(/Access Key:\s+(.+)/);
        const secretKeyMatch = lastStdout.match(/Secret Key:\s+(.+)/);

        if (!accessKeyMatch || !secretKeyMatch) {
            throw new Error('Failed to extract credentials from container logs');
        }

        accessKey = accessKeyMatch[1].trim();
        secretKey = secretKeyMatch[1].trim();
        console.log(`Extracted Credentials: ${accessKey} / ***`);
    });

    afterAll(async () => {
        await cleanup();
    });

    const createConfig = (userId: string): SovereignConfig => ({
        s3: {
            endpoint: `http://localhost:${PORT_S3}`,
            region: 'us-east-1',
            bucketName: BUCKET_NAME,
            credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
            forcePathStyle: true
        },
        paths: {
            appId: 'social-app',
            userId: userId,
            storeId: 'social'
        },
        encryptionKey: 'test-secret-key-must-be-32-bytes!',
        syncIntervalMs: 0
    });

    test('Two users should be able to interact via S3', async () => {
        // 1. Setup Users
        const userA = new SovereignS3nc(createConfig('userA'));
        const userB = new SovereignS3nc(createConfig('userB'));

        await userA.init();
        await userB.init();

        // 2. User A Profile & Post
        console.log('User A: Updating profile and posting...');
        await userA.profile.update({ displayName: 'Alice', bio: 'I am Alice' });
        
        const postA_id = await userA.collection('posts').save<Post>({
            _id: 'post_a_1',
            text: 'Hello from Alice',
            authorId: 'me',
            createdAt: Date.now()
        });
        
        // Share post publicly 
        await userA.share(postA_id, true, 'posts'); 
        
        // Sync User A to S3
        const statsA = await userA.sync();
        expect(statsA.pushed).toBeGreaterThan(0);
        
        // 3. User B Profile & Follow
        console.log('User B: Updating profile and following Alice...');
        await userB.profile.update({ displayName: 'Bob' });
        
        // Address of User A
        const addressA = {
            endpoint: `http://localhost:${PORT_S3}`,
            region: 'us-east-1',
            bucket: BUCKET_NAME,
            appId: 'social-app',
            userId: 'userA'
        };
        await userB.social.follow(addressA);

        await new Promise(r => setTimeout(r, 2000)); // Wait for S3 consistency

        // Sync User B (should pull User A's content)
        const statsB = await userB.sync();
        expect(statsB.pulled).toBeGreaterThan(0); 

        // 4. Verify User B sees User A's post
        const feedB = await userB.social.getFeed();
        const postFromAlice = feedB.find(p => p.text === 'Hello from Alice');
        expect(postFromAlice).toBeDefined();
        
        // 5. User B Comments on Alice's Post
        // User A must follow User B to see the comment if it's shared by B
        const addressB = {
            endpoint: `http://localhost:${PORT_S3}`,
            region: 'us-east-1',
            bucket: BUCKET_NAME,
            appId: 'social-app',
            userId: 'userB'
        };
        await userA.social.follow(addressB);

        console.log('User B: Commenting on Alice\'s post...');
        const commentId = await userB.collection('comments').save<Comment>({
            _id: 'comment_b_1',
            text: 'Nice post Alice!',
            postId: 'post_a_1', 
            authorId: 'me',
            createdAt: Date.now()
        });
        
        await userB.share(commentId, true, 'comments');
        await userB.sync();

        // 6. User A Syncs and sees comment
        console.log('User A: Syncing to see comments...');
        await userA.sync(); 
        
        const commentsA = await userA.social.getComments('post_a_1');
        const commentFromBob = commentsA.find(c => c.text === 'Nice post Alice!');
        
        expect(commentFromBob).toBeDefined();
        
        console.log('Interaction verified successfully!');
    });
});