import fs from 'fs';
import path from 'path';
const yaml = require('js-yaml');

describe('CI Pipeline Stages & Robustness (WT-65 / Item 22)', () => {
    const rootDir = path.resolve(__dirname, '..');
    const ciPath = path.join(rootDir, '.github/workflows/ci.yml');

    test('CI workflow file exists and is valid YAML', () => {
        expect(fs.existsSync(ciPath)).toBe(true);

        const content = fs.readFileSync(ciPath, 'utf8');
        const parsed: any = yaml.load(content);
        expect(parsed).toBeDefined();
        expect(parsed.name).toBe('CI Pipeline');
        expect(parsed.jobs).toBeDefined();
    });

    test('CI pipeline contains all required jobs per review recommendation', () => {
        const content = fs.readFileSync(ciPath, 'utf8');
        const parsed: any = yaml.load(content);
        const jobKeys = Object.keys(parsed.jobs);

        expect(jobKeys).toContain('lint-and-typecheck');
        expect(jobKeys).toContain('unit-and-mutation-tests');
        expect(jobKeys).toContain('build-and-pack');
        expect(jobKeys).toContain('integration-tests');
        expect(jobKeys).toContain('browser-and-a11y-tests');
        expect(jobKeys).toContain('perf-audit');
    });

    test('integration tests job configures S3 service container and port 9000', () => {
        const content = fs.readFileSync(ciPath, 'utf8');
        const parsed: any = yaml.load(content);
        const intJob = parsed.jobs['integration-tests'];

        expect(intJob).toBeDefined();
        expect(intJob.services).toBeDefined();
        expect(intJob.services.minio).toBeDefined();
        expect(intJob.services.minio.ports).toContain('9000:9000');
    });

    test('browser tests job includes Playwright and accessibility audit', () => {
        const content = fs.readFileSync(ciPath, 'utf8');
        const parsed: any = yaml.load(content);
        const browserJob = parsed.jobs['browser-and-a11y-tests'];

        expect(browserJob).toBeDefined();
        const stepCommands = browserJob.steps
            .map((s: any) => s.run || '')
            .join('\n');

        expect(stepCommands).toContain('playwright install');
        expect(stepCommands).toContain('test:a11y');
        expect(stepCommands).toContain('test:browser');
    });

    test('performance audit job runs perf:audit against built assets', () => {
        const content = fs.readFileSync(ciPath, 'utf8');
        const parsed: any = yaml.load(content);
        const perfJob = parsed.jobs['perf-audit'];

        expect(perfJob).toBeDefined();
        const stepCommands = perfJob.steps
            .map((s: any) => s.run || '')
            .join('\n');

        expect(stepCommands).toContain('scripts/perf-audit.ts');
    });
});
