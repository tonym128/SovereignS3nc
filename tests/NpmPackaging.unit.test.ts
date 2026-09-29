import * as fs from 'fs';
import * as path from 'path';

describe('npm Package & Exports Verification (Item 4)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const packageJsonPath = path.join(rootDir, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    test('package.json contains all required npm distribution metadata', () => {
        expect(packageJson.name).toBe('sovereigns3nc');
        expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
        expect(packageJson.description).toBeTruthy();
        expect(packageJson.license).toBe('ISC');
        expect(packageJson.author).toBeTruthy();
        expect(packageJson.repository).toBeDefined();
        expect(packageJson.repository.url).toContain('SovereignS3nc');
        expect(packageJson.homepage).toBeDefined();
        expect(packageJson.bugs).toBeDefined();
        expect(Array.isArray(packageJson.keywords)).toBe(true);
        expect(packageJson.keywords.length).toBeGreaterThan(3);
    });

    test('package.json entrypoints point to real generated files', () => {
        expect(fs.existsSync(path.join(rootDir, packageJson.main))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, packageJson.module))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, packageJson.browser))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, packageJson.types))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, packageJson.unpkg))).toBe(true);
    });

    test('package.json exports map specifies valid target paths', () => {
        expect(packageJson.exports).toBeDefined();
        expect(packageJson.exports['.']).toBeDefined();

        const rootExport = packageJson.exports['.'];
        expect(fs.existsSync(path.join(rootDir, rootExport.types))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, rootExport.import))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, rootExport.require))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, rootExport.browser))).toBe(true);

        const reactExport = packageJson.exports['./react'];
        expect(reactExport).toBeDefined();
        expect(fs.existsSync(path.join(rootDir, reactExport.types))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, reactExport.import))).toBe(true);
        expect(fs.existsSync(path.join(rootDir, reactExport.require))).toBe(true);

        expect(packageJson.exports['./package.json']).toBe('./package.json');
    });

    test('published files array is strictly bounded and includes LICENSE', () => {
        expect(packageJson.files).toBeDefined();
        expect(packageJson.files).toContain('dist');
        expect(packageJson.files).toContain('README.md');
        expect(packageJson.files).toContain('LICENSE');
        // docs site and internal AI files should not be packaged in npm tarball
        expect(packageJson.files).not.toContain('docs');
        expect(packageJson.files).not.toContain('GEMINI.md');
        expect(packageJson.files).not.toContain('AGENT.md');

        const licensePath = path.join(rootDir, 'LICENSE');
        expect(fs.existsSync(licensePath)).toBe(true);
        const licenseContent = fs.readFileSync(licensePath, 'utf8');
        expect(licenseContent).toContain('ISC License');
        expect(licenseContent).toContain('Tony Mobily');
    });

    test('core package imports load all primary exports', () => {
        const core = require(path.join(rootDir, packageJson.main));
        expect(core.SovereignS3nc).toBeDefined();
        expect(core.DailyDatabase).toBeDefined();
        expect(core.FeedModule).toBeDefined();
        expect(core.MessagingModule).toBeDefined();
        expect(core.ProfileModule).toBeDefined();
        expect(core.Repository).toBeDefined();
        expect(core.Logger).toBeDefined();
    });

    test('react subpath exports load all hooks and providers', () => {
        const reactPkg = require(path.join(rootDir, packageJson.exports['./react'].require));
        expect(reactPkg.SovereignProvider).toBeDefined();
        expect(reactPkg.useSovereign).toBeDefined();
        expect(reactPkg.useFeed).toBeDefined();
        expect(reactPkg.useDirectMessages).toBeDefined();
        expect(reactPkg.useRepository).toBeDefined();
        expect(reactPkg.useSyncStatus).toBeDefined();
    });

    test('automated publishing workflow exists and is configured for npm release', () => {
        const workflowPath = path.join(rootDir, '.github/workflows/publish.yml');
        expect(fs.existsSync(workflowPath)).toBe(true);
        const workflowContent = fs.readFileSync(workflowPath, 'utf8');
        expect(workflowContent).toContain('npm publish');
        expect(workflowContent).toContain('NPM_TOKEN');
        expect(workflowContent).toContain('registry-url');
    });
});
