import { existsSync, globSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const projects = globSync([
  'packages/contracts/*',
  'packages/adapters/*',
  'packages/test-fixtures/*',
  'apps/*',
]);

export default defineConfig({
  test: {
    projects: projects.map((root) => {
      const config = `${root}/vitest.config.ts`;
      if (existsSync(config)) return config;
      return {
        test: {
          name: root,
          root,
          include: ['src/**/*.test.{ts,tsx}'],
        },
      };
    }),
  },
});
