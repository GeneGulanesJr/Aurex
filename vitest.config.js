const { defineConfig } = require('vitest/config');
const path = require('path');

module.exports = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['*.js'],
      exclude: ['vitest.config.js', 'test/**', 'scripts/**', 'node_modules/**'],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 50,
        branches: 40,
        functions: 50,
        lines: 50,
      },
    },
  },
});
