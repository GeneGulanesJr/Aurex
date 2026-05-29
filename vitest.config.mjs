export default {
  resolve: {
    extensions: ['.ts', '.js', '.mjs', '.cjs', '.json'],
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/.git/**',
      '**/.worktrees/**',
      '**/bench/results/**',
      '**/bench/realworld/results/**',
    ],
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    retry: 2,
    reporters: ['verbose'],
    // Test files share the same SQLite DB (~/.pi/memory/memory.db).
    // Parallel file execution causes race conditions when tests in
    // Test/ and .worktrees/*/test/ try to create/remove the same repos
    // Or reindex the same doc repos simultaneously.
    fileParallelism: false,
  },
};
