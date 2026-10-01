const baseConfig = require('./jest.config.js');

module.exports = {
  ...baseConfig,
  globalSetup: '<rootDir>/tests/global-setup.ts',
  globalTeardown: '<rootDir>/tests/jest-global-teardown.ts',
  testMatch: ["**/*.integration.ts"],
  testPathIgnorePatterns: ["/node_modules/", "\\.spec\\.ts$"],
};
