import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/components/__tests__/**/*.test.{ts,tsx,js,jsx}',
      'src/components/casino/3d/physics/**/*.test.{ts,tsx,js,jsx}',
      'src/components/casino/3d/cards/**/*.test.{ts,tsx,js,jsx}',
      'src/hooks/__tests__/**/*.test.{ts,tsx,js,jsx}',
      'src/security/**/*.test.{ts,tsx,js,jsx}',
      'src/services/games/**/*.test.{ts,tsx,js,jsx}',
      'src/utils/**/*.test.{ts,tsx,js,jsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      exclude: ['node_modules', 'dist', 'tests', 'wasm', 'scripts'],
    },
  },
});
