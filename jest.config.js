module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts', '!**/tests/**/*.integration.test.ts'],
  forceExit: true, // often needed for S3 mocks or timers
};
