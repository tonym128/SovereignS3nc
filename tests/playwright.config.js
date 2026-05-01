"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
exports.default = (0, test_1.defineConfig)({
    testDir: '.',
    testIgnore: '**/*.test.ts',
    globalSetup: require.resolve('./global-setup'),
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
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
            use: { ...test_1.devices['Desktop Chrome'] },
        },
    ],
});
//# sourceMappingURL=playwright.config.js.map