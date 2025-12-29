import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Vitest handles .js -> .ts resolution automatically with TypeScript
  },
  resolve: {
    // Ensure .js imports resolve to .ts source files during test
    extensions: ['.ts', '.js', '.json'],
  },
});
