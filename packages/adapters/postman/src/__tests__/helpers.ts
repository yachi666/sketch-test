/**
 * @sketch-test/adapter-postman — Test helpers for endpoint mapping
 *
 * Utilities for constructing synthetic Postman test data in mapper tests.
 */

import type {
  ContentHash,
  EntityId,
  Instant,
  SemanticVersion,
} from '@sketch-test/contracts-common';
import type { FlatItem } from '../mapper/endpoints.js';

/**
 * Create a minimal SourceContext for testing.
 *
 * Uses fixed values so all test output is deterministic.
 */
export function makeSourceContext() {
  return {
    sourceId: 'test-source' as EntityId,
    sourceLabel: 'test-collection.json',
    sourceVersion: '1.0.0' as SemanticVersion,
    sourceHash: '0'.repeat(64) as ContentHash,
    ingestedAt: '2026-06-23T00:00:00.000Z' as Instant,
  };
}

/**
 * Create a minimal FlatItem for testing.
 *
 * Defaults to a GET /test endpoint with no tags. Override any field
 * by passing partial properties (spread onto the item).
 */
export function makeFlatItem(overrides: Record<string, unknown> = {}): FlatItem {
  return {
    item: {
      name: 'Test Endpoint',
      request: {
        method: 'GET',
        url: { raw: '/test', path: ['test'] },
      },
      ...overrides,
    },
    tags: [] as string[],
    folderPath: '',
  };
}
