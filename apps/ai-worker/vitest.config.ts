import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { name: 'ai-worker', include: ['src/**/*.test.ts'] } });
