import fs from 'fs';
import path from 'path';

describe('Public Documentation Portal (VitePress) (WT-63)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const docsDir = path.join(rootDir, 'docs');

    test('VitePress configuration (docs/.vitepress/config.mts) exists and is configured', () => {
        const configPath = path.join(docsDir, '.vitepress/config.mts');
        expect(fs.existsSync(configPath)).toBe(true);

        const configContent = fs.readFileSync(configPath, 'utf8');
        expect(configContent).toContain("title: 'SovereignS3nc'");
        expect(configContent).toContain("provider: 'local'");
        expect(configContent).toContain('/comparison');
        expect(configContent).toContain('/architecture');
        expect(configContent).toContain('/react');
        expect(configContent).toContain('/api');
        expect(configContent).toContain('sidebar:');
    });

    test('Homepage (docs/index.md) contains hero, quickstart, and features', () => {
        const indexPath = path.join(docsDir, 'index.md');
        expect(fs.existsSync(indexPath)).toBe(true);

        const content = fs.readFileSync(indexPath, 'utf8');
        expect(content).toContain('layout: home');
        expect(content).toContain('hero:');
        expect(content).toContain('Quick Start Guide');
        expect(content).toContain('60-Second Quickstart');
        expect(content).toContain('npm install sovereigns3nc');
        expect(content).toContain('@sovereigns3nc/react');
    });

    test('Architecture guide (docs/architecture.md) includes Mermaid flowcharts', () => {
        const archPath = path.join(docsDir, 'architecture.md');
        expect(fs.existsSync(archPath)).toBe(true);

        const content = fs.readFileSync(archPath, 'utf8');
        expect(content).toContain('flowchart TD');
        expect(content).toContain('sequenceDiagram');
        expect(content).toContain('Merkle Tree');
        expect(content).toContain('X25519');
        expect(content).toContain('WebRTC');
    });

    test('Comparison matrix page (docs/comparison.md) compares Supabase, RxDB, and Nostr', () => {
        const compPath = path.join(docsDir, 'comparison.md');
        expect(fs.existsSync(compPath)).toBe(true);

        const content = fs.readFileSync(compPath, 'utf8');
        expect(content).toContain('SovereignS3nc');
        expect(content).toContain('Supabase / Firebase');
        expect(content).toContain('RxDB');
        expect(content).toContain('Nostr');
        expect(content).toContain('Zero-Knowledge');
        expect(content).toContain('Offline-First');
        expect(content).toContain('SQLite');
    });

    test('React documentation (docs/react.md) covers all official reactive hooks', () => {
        const reactPath = path.join(docsDir, 'react.md');
        expect(fs.existsSync(reactPath)).toBe(true);

        const content = fs.readFileSync(reactPath, 'utf8');
        expect(content).toContain('<SovereignProvider>');
        expect(content).toContain('useSovereign()');
        expect(content).toContain('useSyncStatus()');
        expect(content).toContain('useRepository');
        expect(content).toContain('useDirectMessages');
        expect(content).toContain('useFeed');
    });

    test('package.json includes docs scripts', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
        expect(pkg.scripts['docs:dev']).toBe('vitepress dev docs');
        expect(pkg.scripts['docs:build']).toBe('vitepress build docs');
        expect(pkg.scripts['docs:preview']).toBe('vitepress preview docs');
    });

    test('VitePress static build output exists and contains rendered HTML', () => {
        const distDir = path.join(docsDir, '.vitepress/dist');
        if (!fs.existsSync(distDir)) {
            const { execSync } = require('child_process');
            execSync('npx vitepress build docs', { cwd: rootDir, stdio: 'pipe' });
        }
        expect(fs.existsSync(distDir)).toBe(true);
        expect(fs.existsSync(path.join(distDir, 'index.html'))).toBe(true);
        expect(fs.existsSync(path.join(distDir, 'comparison.html'))).toBe(true);
        expect(fs.existsSync(path.join(distDir, 'architecture.html'))).toBe(true);
        expect(fs.existsSync(path.join(distDir, 'react.html'))).toBe(true);
    });
});
