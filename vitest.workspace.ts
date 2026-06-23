import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/contracts/*',
  'packages/adapters/*',
  'packages/test-fixtures/*',
  'apps/runner',
  'apps/web',
]);
