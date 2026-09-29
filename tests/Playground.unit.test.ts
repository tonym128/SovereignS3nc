import fs from 'fs';
import path from 'path';
// @ts-ignore
import yaml from 'js-yaml';
import * as Sovereign from '../src';
import { PaginationCursor, paginateItems } from '../src/core/Pagination';

describe('Item 11: Hosted Interactive Playground & Cloud Sandboxes', () => {
    const rootDir = path.resolve(__dirname, '..');

    test('1. demo/playground/index.html exists and includes complete interactive features', () => {
        const playgroundPath = path.join(rootDir, 'demo/playground/index.html');
        expect(fs.existsSync(playgroundPath)).toBe(true);

        const html = fs.readFileSync(playgroundPath, 'utf8');
        // Structure and branding
        expect(html).toContain('SovereignS3nc');
        expect(html).toContain('Playground');
        expect(html).toContain('codeEditor');
        expect(html).toContain('consoleOutput');
        expect(html).toContain('storageView');
        expect(html).toContain('resultOutput');

        // Preset recipes
        expect(html).toContain('RECIPES');
        expect(html).toContain('quickstart:');
        expect(html).toContain('e2ee:');
        expect(html).toContain('sqlite:');
        expect(html).toContain('pagination:');
        expect(html).toContain('inspector:');

        // Cloud sandbox integration
        expect(html).toContain('stackblitzForm');
        expect(html).toContain('https://stackblitz.com/run');
        expect(html).toContain('codesandbox.io');

        // Storage inspection & execution controls
        expect(html).toContain('runBtn');
        expect(html).toContain('refreshStorageBtn');
        expect(html).toContain('clearStorageBtn');
        expect(html).toContain('Ctrl+↵');
    });

    test('2. demo/index.html features the playground, StackBlitz, and live runner', () => {
        const indexPath = path.join(rootDir, 'demo/index.html');
        expect(fs.existsSync(indexPath)).toBe(true);

        const html = fs.readFileSync(indexPath, 'utf8');
        // Navigation & hero links
        expect(html).toContain('href="./playground/"');
        expect(html).toContain('StackBlitz');
        expect(html).toContain('Try In-Browser Playground');

        // Card in application grid
        expect(html).toContain('Interactive API Playground');

        // Embedded live runner
        expect(html).toContain('homeRunBtn');
        expect(html).toContain('homeCode');
        expect(html).toContain('homeOutput');
        expect(html).toContain('sovereigns3nc.global.js');
    });

    test('3. examples/quickstart contains valid starter files for StackBlitz / CodeSandbox', () => {
        const quickstartDir = path.join(rootDir, 'examples/quickstart');
        expect(fs.existsSync(quickstartDir)).toBe(true);

        // package.json
        const pkgPath = path.join(quickstartDir, 'package.json');
        expect(fs.existsSync(pkgPath)).toBe(true);
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        expect(pkg.name).toBe('sovereigns3nc-quickstart');
        expect(pkg.dependencies.sovereigns3nc).toBeDefined();
        expect(pkg.dependencies['@sovereigns3nc/react']).toBeDefined();
        expect(pkg.dependencies.react).toBeDefined();

        // stackblitz.json
        const sbPath = path.join(quickstartDir, 'stackblitz.json');
        expect(fs.existsSync(sbPath)).toBe(true);
        const sbConfig = JSON.parse(fs.readFileSync(sbPath, 'utf8'));
        expect(sbConfig.startCommand).toBe('npm run dev');
        expect(sbConfig.installDependencies).toBe(true);

        // tsconfig.json & vite.config.ts
        expect(fs.existsSync(path.join(quickstartDir, 'tsconfig.json'))).toBe(true);
        expect(fs.existsSync(path.join(quickstartDir, 'vite.config.ts'))).toBe(true);
        expect(fs.existsSync(path.join(quickstartDir, 'index.html'))).toBe(true);

        // React components
        const mainPath = path.join(quickstartDir, 'src/main.tsx');
        expect(fs.existsSync(mainPath)).toBe(true);
        const mainContent = fs.readFileSync(mainPath, 'utf8');
        expect(mainContent).toContain('SovereignProvider');

        const appPath = path.join(quickstartDir, 'src/App.tsx');
        expect(fs.existsSync(appPath)).toBe(true);
        const appContent = fs.readFileSync(appPath, 'utf8');
        expect(appContent).toContain('useSovereign');
        expect(appContent).toContain('useProfile');
        expect(appContent).toContain('useFeed');
        expect(appContent).toContain('useSyncStatus');

        // README.md with StackBlitz badges
        const readmePath = path.join(quickstartDir, 'README.md');
        expect(fs.existsSync(readmePath)).toBe(true);
        const readmeContent = fs.readFileSync(readmePath, 'utf8');
        expect(readmeContent).toContain('stackblitz.com');
        expect(readmeContent).toContain('codesandbox.io');
    });

    test('4. Playground recipes are syntactically valid and executable', async () => {
        // Test Recipe 4 (Pagination) execution
        const items = [];
        const now = 1700000000000;
        for (let i = 1; i <= 20; i++) {
            items.push({
                id: `post_${i.toString().padStart(2, '0')}`,
                timestamp: now - (i * 1000),
                title: `Post #${i}`
            });
        }
        const page1 = paginateItems(items, { limit: 5 });
        expect(page1.items.length).toBe(5);
        expect(page1.hasMore).toBe(true);
        expect(page1.nextCursor).toBeDefined();

        const decoded = PaginationCursor.decode(page1.nextCursor!);
        expect(decoded).toBeDefined();
        expect(decoded?.i).toBe('post_05');

        const page2 = paginateItems(items, { cursor: page1.nextCursor || undefined, limit: 5 });
        expect(page2.items.length).toBe(5);
        expect(page2.items[0].id).toBe('post_06');

        // Test Recipe 2 (E2EE crypto properties) execution
        const alice = new Sovereign.SovereignS3nc({
            userId: 'alice-test',
            password: 'alice-secret-password-123',
            syncMode: 'offline'
        });
        await alice.init();

        const bob = new Sovereign.SovereignS3nc({
            userId: 'bob-test',
            password: 'bob-secret-password-456',
            syncMode: 'offline'
        });
        await bob.init();

        expect(alice.getPublicKey()).toBeDefined();
        expect(bob.getPublicKey()).toBeDefined();

        const secretAlice = alice.deriveSharedSecret(bob.getPublicKey()!);
        const secretBob = bob.deriveSharedSecret(alice.getPublicKey()!);
        expect(secretAlice).toBe(secretBob);

        const plaintext = 'Zero-trust SovereignS3nc message';
        const ciphertext = await alice.encrypt(plaintext, secretAlice);
        expect(ciphertext).toBeInstanceOf(Uint8Array);

        const decryptedBytes = await bob.decrypt(ciphertext, secretBob);
        const decrypted = new TextDecoder().decode(decryptedBytes);
        expect(decrypted).toBe(plaintext);
    });

    test('5. scripts/build-demos.js correctly packages playground and sandbox distribution', () => {
        const buildScript = fs.readFileSync(path.join(rootDir, 'scripts/build-demos.js'), 'utf8');
        expect(buildScript).toContain('demo/playground');
        expect(buildScript).toContain('sovereigns3nc.global.js');
        expect(buildScript).toContain('examples/quickstart');
        expect(buildScript).toContain('sql-wasm.wasm');

        const distDir = path.join(rootDir, 'demo-dist');
        if (fs.existsSync(distDir)) {
            expect(fs.existsSync(path.join(distDir, 'playground/index.html'))).toBe(true);
            expect(fs.existsSync(path.join(distDir, 'playground/sovereigns3nc.global.js'))).toBe(true);
            expect(fs.existsSync(path.join(distDir, 'examples/quickstart/package.json'))).toBe(true);
            expect(fs.existsSync(path.join(distDir, 'examples/quickstart/src/App.tsx'))).toBe(true);
            expect(fs.existsSync(path.join(distDir, 'sovereigns3nc.global.js'))).toBe(true);
        }
    });

    test('6. GitHub Actions deployment workflow (.github/workflows/deploy-demos.yml) handles playground deployment', () => {
        const workflowPath = path.join(rootDir, '.github/workflows/deploy-demos.yml');
        expect(fs.existsSync(workflowPath)).toBe(true);

        const content = fs.readFileSync(workflowPath, 'utf8');
        const parsed: any = yaml.load(content);

        expect(parsed).toBeDefined();
        expect(parsed.name).toContain('Playground');
        expect(parsed.permissions.pages).toBe('write');
        expect(parsed.permissions['id-token']).toBe('write');

        const job = parsed.jobs['build-and-deploy'];
        expect(job).toBeDefined();
        const stepRuns = job.steps.map((s: any) => s.run || s.uses);
        expect(stepRuns.some((r: string) => r && r.includes('build:demos'))).toBe(true);
        expect(stepRuns.some((r: string) => r && r.includes('deploy-pages'))).toBe(true);
    });

    test('7. Core index.ts exports IndexedDBStorage and WebRTCRemoteAdapter', () => {
        expect(Sovereign.IndexedDBStorage).toBeDefined();
        expect(Sovereign.WebRTCRemoteAdapter).toBeDefined();
        expect(Sovereign.SovereignS3nc).toBeDefined();
        expect(Sovereign.DailyDatabase).toBeDefined();
        expect(Sovereign.Repository).toBeDefined();
        expect(Sovereign.PaginationCursor).toBeDefined();
    });
});
