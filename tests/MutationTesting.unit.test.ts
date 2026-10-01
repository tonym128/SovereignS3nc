import fs from 'fs';
import path from 'path';
import { CRYPTO_MUTANTS, runMutationTests } from '../scripts/mutation-test';

describe('Mutation Testing for Crypto Modules (WT-64 / Item 20)', () => {
    const rootDir = path.resolve(__dirname, '..');

    test('Stryker configuration (stryker.config.json) exists and targets crypto modules with >= 80% threshold', () => {
        const configPath = path.join(rootDir, 'stryker.config.json');
        expect(fs.existsSync(configPath)).toBe(true);

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        expect(config.testRunner).toBe('jest');
        expect(config.mutate).toContain('src/core/KeyManager.ts');
        expect(config.mutate).toContain('src/utils/nodeCrypto.ts');
        expect(config.thresholds.high).toBeGreaterThanOrEqual(80);
        expect(config.thresholds.break).toBeGreaterThanOrEqual(75);
    });

    test('package.json configures npm run test:mutation script', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
        expect(pkg.scripts['test:mutation']).toBe('ts-node scripts/mutation-test.ts');
    });

    test('all crypto mutants have matching targets in KeyManager.ts', () => {
        const keyManagerSrc = fs.readFileSync(path.join(rootDir, 'src/core/KeyManager.ts'), 'utf8');
        for (const mutant of CRYPTO_MUTANTS) {
            expect(keyManagerSrc).toContain(mutant.original);
        }
    });

    test('mutation testing executes against crypto modules and exceeds 80% mutation score', () => {
        const result = runMutationTests(rootDir);
        expect(result.total).toBeGreaterThanOrEqual(10);
        expect(result.mutationScore).toBeGreaterThanOrEqual(80);
        expect(result.killed).toBeGreaterThanOrEqual(8);
    }, 180000); // Allow sufficient time for all mutant test runs
});
