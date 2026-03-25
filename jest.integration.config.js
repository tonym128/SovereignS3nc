const baseConfig = require('./jest.config.js');

module.exports = {
  ...baseConfig,
  globalSetup: '<rootDir>/tests/global-setup.ts',
  testMatch: ["**/admin.integration.ts"],
  testPathIgnorePatterns: ["/node_modules/", "\\.spec\\.ts$"],
};
