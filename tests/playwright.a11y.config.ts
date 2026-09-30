import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: '.',
  testMatch: '**/accessibility.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/a11y-results.json' }]
  ],
  use: {
    baseURL: 'http://127.0.0.1:8899',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  timeout: 60000,
  webServer: {
    command: 'node scripts/serve-demo-dist.js',
    cwd: path.resolve(__dirname, '..'),
    port: 8899,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
