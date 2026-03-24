const baseConfig = require('./jest.integration.config.js');

module.exports = {
  ...baseConfig,
  globalSetup: '<rootDir>/tests/global-setup-rustfs.ts',
  testMatch: ["**/rustfs_admin.integration.ts"],
};
