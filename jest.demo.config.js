const baseConfig = require('./jest.config.js');

module.exports = {
  ...baseConfig,
  testMatch: ['**/tests/demo.integration.test.ts'],
};
