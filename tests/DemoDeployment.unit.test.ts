import fs from 'fs';
import path from 'path';
// @ts-ignore
import yaml from 'js-yaml';

describe('Interactive Public Demo Sandbox & Deployment (WT-62)', () => {
    const rootDir = path.resolve(__dirname, '..');

    test('GitHub Actions deployment workflow (.github/workflows/deploy-demos.yml) is valid', () => {
        const workflowPath = path.join(rootDir, '.github/workflows/deploy-demos.yml');
        expect(fs.existsSync(workflowPath)).toBe(true);

        const content = fs.readFileSync(workflowPath, 'utf8');
        const parsed: any = yaml.load(content);

        expect(parsed).toBeDefined();
        expect(parsed.name).toContain('Deploy Interactive Demos');

        // Check trigger
        expect(parsed.on.push.branches).toContain('master');

        // Check permissions for GitHub Pages
        expect(parsed.permissions.pages).toBe('write');
        expect(parsed.permissions['id-token']).toBe('write');

        // Check steps in build-and-deploy job
        const job = parsed.jobs['build-and-deploy'];
        expect(job).toBeDefined();
        const stepRuns = job.steps.map((s: any) => s.run || s.uses);
        expect(stepRuns.some((r: string) => r && r.includes('build:demos'))).toBe(true);
        expect(stepRuns.some((r: string) => r && r.includes('deploy-pages'))).toBe(true);
    });

    test('Demo portal landing page (demo/index.html) is complete and responsive', () => {
        const indexPath = path.join(rootDir, 'demo/index.html');
        expect(fs.existsSync(indexPath)).toBe(true);

        const html = fs.readFileSync(indexPath, 'utf8');
        expect(html).toContain('viewport');
        expect(html).toContain('Sovereign Social');
        expect(html).toContain('Sovereign Board');
        expect(html).toContain('Sovereign Banky');
        expect(html).toContain('Sovereign Blog');
        expect(html).toContain('WebRTC');
        expect(html).toContain('?debug=inspect');
    });

    test('PWA manifests and service workers exist for all interactive demos', () => {
        const demos = ['social', 'social-local', 'banky', 'board'];
        for (const demo of demos) {
            const manifestPath = path.join(rootDir, 'demo', demo, 'manifest.json');
            expect(fs.existsSync(manifestPath)).toBe(true);

            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            expect(manifest.icons).toBeDefined();
            expect(manifest.icons.length).toBeGreaterThan(0);
            expect(manifest.display).toBe('standalone');

            const swPath = path.join(rootDir, 'demo', demo, 'service-worker.js');
            expect(fs.existsSync(swPath)).toBe(true);

            const indexPath = path.join(rootDir, 'demo', demo, 'index.html');
            const indexHtml = fs.readFileSync(indexPath, 'utf8');
            expect(indexHtml).toContain('serviceWorker');
            expect(indexHtml).toContain('manifest.json');
            expect(indexHtml).toContain('viewport');
        }
    });

    test('All demo applications have offline and fallback handling for remote URLs', () => {
        const boardApp = fs.readFileSync(path.join(rootDir, 'demo/board/src/App.tsx'), 'utf8');
        expect(boardApp).toContain("config.syncMode === 'webrtc'");
        expect(boardApp).toContain("config.syncMode === 'offline'");
        expect(boardApp).toContain('BroadcastChannel');

        const socialApp = fs.readFileSync(path.join(rootDir, 'demo/social/src/App.tsx'), 'utf8');
        expect(socialApp).toContain("syncMode: defaultMode");
        expect(socialApp).toContain("isLocalHost");

        const bankyApp = fs.readFileSync(path.join(rootDir, 'demo/banky/src/App.tsx'), 'utf8');
        expect(bankyApp).toContain("s3: undefined");
        expect(bankyApp).toContain("isLocalHost");
    });

    test('Demo distribution directory contains all required artifacts after build', () => {
        const distDir = path.join(rootDir, 'demo-dist');
        if (!fs.existsSync(distDir)) {
            const { execSync } = require('child_process');
            execSync('node --no-warnings scripts/build-demos.js', { cwd: rootDir, stdio: 'pipe' });
        }
        expect(fs.existsSync(distDir)).toBe(true);
        expect(fs.existsSync(path.join(distDir, 'index.html'))).toBe(true);
        expect(fs.existsSync(path.join(distDir, '.nojekyll'))).toBe(true);

        const subfolders = ['social', 'social-local', 'banky', 'board', 'blog'];
        for (const sub of subfolders) {
            const subPath = path.join(distDir, sub);
            expect(fs.existsSync(subPath)).toBe(true);
            expect(fs.existsSync(path.join(subPath, 'index.html'))).toBe(true);
        }

        // SQLite WASM must be copied to board and blog
        expect(fs.existsSync(path.join(distDir, 'board/sql-wasm.wasm'))).toBe(true);
        expect(fs.existsSync(path.join(distDir, 'blog/sql-wasm.wasm'))).toBe(true);
    });
});
