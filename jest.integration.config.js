module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 180000, // Longer timeout for live integration tests
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  globalSetup: '<rootDir>/tests/jest-global-setup.ts',
  globalTeardown: '<rootDir>/tests/jest-global-teardown.ts',
  testMatch: ["**/*.integration.ts"],
  testPathIgnorePatterns: ["/node_modules/"],
};
