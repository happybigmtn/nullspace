import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/components/casino/3d/physics/**/*.test.ts',
      'src/components/casino/3d/cards/**/*.test.ts',
      'src/utils/**/*.test.ts',
    ],
  },
});
