import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'generation-protocol', include: ['src/**/*.test.ts'] },
});
