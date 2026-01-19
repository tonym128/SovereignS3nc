import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const IMAGE_NAME = 'sovereigns3nc-test';
const CONTAINER_NAME = 'sovereigns3nc-test-container';
const PORT_WEB = 8082; // Changed to avoid conflict
const PORT_S3 = 3905;
const PORT_ADMIN = 3904;

// Increase timeout for build
jest.setTimeout(300000); // 5 minutes

describe('Docker Integration Test', () => {
    
    const cleanup = async () => {
        try { await execAsync(`docker rm -f ${CONTAINER_NAME}`); } catch (e) {}
        try { await execAsync(`docker rmi ${IMAGE_NAME}`); } catch (e) {}
        await new Promise(r => setTimeout(r, 2000)); // Wait for ports to release
    };

    beforeAll(async () => {
        await cleanup();
    });

    afterAll(async () => {
        await cleanup();
    });

    test('should build the docker image', async () => {
        console.log('Building Docker image... (this may take a minute)');
        const { stdout, stderr } = await execAsync(`docker build -t ${IMAGE_NAME} .`);
        if (stderr) console.log('Docker build stderr:', stderr);
        console.log('Docker build stdout:', stdout);
    });

    test('should run the container and serve the app', async () => {
        console.log('Starting container...');
        // We map to different ports to avoid conflicts
        await execAsync(`docker run -d --name ${CONTAINER_NAME} -p ${PORT_S3}:3900 -p ${PORT_WEB}:8080 ${IMAGE_NAME}`);

        // Wait for startup (poll logs)
        console.log('Waiting for startup...');
        let ready = false;
        let attempts = 0;
        while (!ready && attempts < 30) {
            await new Promise(r => setTimeout(r, 1000));
            try {
                const { stdout } = await execAsync(`docker logs ${CONTAINER_NAME}`);
                if (stdout.includes('SOVEREIGN S3NC DEMO ENV SETUP COMPLETE')) {
                    ready = true;
                }
            } catch (e) {
                // container might not be ready
            }
            attempts++;
        }

        if (!ready) {
             const logs = await execAsync(`docker logs ${CONTAINER_NAME}`);
             console.error('Container logs:', logs.stdout, logs.stderr);
             throw new Error('Container failed to start within 30 seconds');
        }

        // Verify Web (using curl)
        const webUrl = `http://localhost:${PORT_WEB}/demo/index.html`;
        console.log(`Checking Web URL: ${webUrl}`);
        const webCheck = await execAsync(`curl -s -o /dev/null -w "%{http_code}" ${webUrl}`);
        expect(webCheck.stdout.trim()).toBe('200');

        // Verify S3 (Garage)
        const s3Url = `http://localhost:${PORT_S3}`;
        console.log(`Checking S3 URL: ${s3Url}`);
        // Root of S3 might return 403 or XML. Garage usually returns an XML list of buckets if authorized or 200 OK.
        // Let's check that we can connect.
        try {
            const s3Check = await execAsync(`curl -s -I ${s3Url}`);
            // We accept 200, 403, or 405. Just connection success is enough.
            expect(s3Check.stdout).toBeTruthy();
        } catch (e) {
            throw new Error('Failed to connect to S3 endpoint');
        }

        // Verify credentials in output
        const { stdout } = await execAsync(`docker logs ${CONTAINER_NAME}`);
        expect(stdout).toContain('Access Key:');
        expect(stdout).toContain('Secret Key:');
    });
});
