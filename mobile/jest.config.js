module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  moduleNameMapper: {
    '^@permissions/(.*)$': '<rootDir>/src/permissions/$1',
    '^@permissions$': '<rootDir>/src/permissions',
  },
  testMatch: ['**/__tests__/**/*.(test|spec).(ts|tsx|js|jsx)', '**/*.(test|spec).(ts|tsx|js|jsx)'],
  collectCoverageFrom: [
    '**/*.{ts,tsx}',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!**/*.config.js',
  ],
  // Memory optimization: Limit concurrent workers and enable cache
  maxWorkers: '50%',
  cache: true,
  cacheDirectory: '.jest-cache',
  // Force garbage collection between test suites to prevent memory buildup
  globals: {
    'ts-jest': {
      isolatedModules: true,
    },
  },
  // Bail on first failure in CI to save resources
  bail: process.env.CI ? 1 : false,
};
