module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 120000,
  moduleNameMapper: {
    '^sovereigns3nc$': '<rootDir>/src/index.ts',
    '^@sovereigns3nc/react$': '<rootDir>/packages/react/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "\\.spec\\.ts$", "\\.integration\\.ts$"],
  rootDir: '..',
};
