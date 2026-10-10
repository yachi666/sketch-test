import { expect, test } from 'vitest';
import { isActiveRun, statusLabel, statusTone } from './run-status';

test('uses persisted and historical states without counting cancelled or lost as active', () => {
  for (const status of ['pending', 'claimed', 'queued', 'leased', 'running'])
    expect(isActiveRun(status)).toBe(true);
  for (const status of ['cancelled', 'lost', 'orphaned', 'inconclusive', 'passed', 'failed'])
    expect(isActiveRun(status)).toBe(false);
  expect(statusLabel('claimed')).toBe('已分配');
  expect(statusTone('cancelled')).toBe('neutral');
  expect(statusTone('error')).toBe('warning');
  expect(statusTone('failed')).toBe('failed');
});
