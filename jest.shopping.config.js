const baseConfig = require('./jest.config.js');

module.exports = {
  ...baseConfig,
  testMatch: ['**/tests/shopping_flow.test.ts'],
};
