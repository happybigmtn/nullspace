import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 120000, // 2 minutes for cross-service tests
    hookTimeout: 180000, // 3 minutes for setup/teardown
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    reporters: ['verbose'],
    pool: 'forks', // Use separate processes to avoid state leakage
    poolOptions: {
      forks: {
        singleFork: true, // Run tests sequentially for cross-service reliability
      },
    },
  },
});
