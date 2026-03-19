import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: '**/*.test.ts',
  globalSetup: require.resolve('./tests/global-setup'),
  fullyParallel: false, // For multi-user contention, it's better to run specs sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Let's keep it simple with 1 worker to avoid resource contention on the local Garage instance
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8888',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  timeout: 120000,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
