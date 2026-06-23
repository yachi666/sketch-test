/**
 * @sketch-test/adapter-postman — Golden integration tests
 *
 * Tests the full importPostmanCollection pipeline against the Postman Echo
 * fixture. Verifies parsing, mapping, variable resolution, auth extraction,
 * workflow hints, Zod validation, and error handling.
 */
import { CanonicalApiModelSchema } from '@sketch-test/canonical-api-model';
import type { ContentHash, SemanticVersion } from '@sketch-test/contracts-common';
import { describe, expect, it } from 'vitest';
import { importPostmanCollection } from '../index.js';
import { POSTMAN_ECHO_COLLECTION } from './fixtures/postman-echo.js';

const SOURCE_LABEL = 'postman-echo.json';
const SOURCE_HASH =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as ContentHash;
const PARSER_VERSION = '0.1.0' as SemanticVersion;

const OPTIONS = {
  sourceLabel: SOURCE_LABEL,
  sourceHash: SOURCE_HASH,
  parserVersion: PARSER_VERSION,
};

describe('importPostmanCollection', () => {
  // 1. Happy path: collection imports successfully
  it('succeeds with a valid Postman Echo collection', () => {
    const result = importPostmanCollection(POSTMAN_ECHO_COLLECTION, OPTIONS);
    expect(result.success).toBe(true);
    expect(result.model).not.toBeNull();
  });

  // 2. Model passes CanonicalApiModelSchema Zod validation
  it('produces a model that passes CanonicalApiModelSchema validation', () => {
    const result = importPostmanCollection(POSTMAN_ECHO_COLLECTION, OPTIONS);
    const parsed = CanonicalApiModelSchema.safeParse(result.model);
    expect(parsed.success).toBe(true);
  });

  // 3. Correct endpoint count (GET /get, POST /post, GET /basic-auth, GET /{{path}})
  it('maps the correct number of endpoints', () => {
    const result = importPostmanCollection(POSTMAN_ECHO_COLLECTION, OPTIONS);
    expect(result.model!.endpoints).toHaveLength(4);
  });

  // 4. Endpoint IDs are deterministic (stable identifiers)
  it('produces deterministic endpoint IDs', () => {
    const result = importPostmanCollection(POSTMAN_ECHO_COLLECTION, OPTIONS);
    const ids = result.model!.endpoints.map((e) => e.id).sort();
    expect(ids).toEqual(['GET-/basic-auth', 'GET-/get', 'GET-/{{path}}', 'POST-/post']);
  });

  // 5. Source locations present on all endpoints
  it('adds source locations to all endpoints', () => {
    const result = importPostmanCollection(POSTMAN_ECHO_COLLECTION, OPTIONS);
    expect(result.model!.endpoints.length).toBeGreaterThan(0);
    for (const ep of result.model!.endpoints) {
      expect(ep.sourceLocations.length).toBeGreaterThanOrEqual(1);
      expect(ep.sourceLocations[0]!.sourceId).toBe('postman-postman-echo-json');
      expect(ep.sourceLocations[0]!.sourceLabel).toBe(SOURCE_LABEL);
    }
  });

  // 6. Variables resolved — collection-level variables in metadata.extra
  it('includes resolved collection variables in metadata.extra', () => {
    const result = importPostmanCollection(POSTMAN_ECHO_COLLECTION, OPTIONS);
    const extra = result.model!.metadata.extra as Record<string, unknown> | undefined;
    expect(extra).toBeDefined();
    expect(extra!['variableScope']).toEqual({
      path: 'get',
      baseUrl: 'https://postman-echo.com',
    });
  });

  // 7. Auth extraction — collection-level auth (none in fixture, only item-level)
  it('produces no API-level security schemes when auth is item-level only', () => {
    const result = importPostmanCollection(POSTMAN_ECHO_COLLECTION, OPTIONS);
    expect(result.model!.securitySchemes).toHaveLength(0);
  });

  // 8. Tags from folder structure — fixture has no folders, so no tags
  it('produces no tags when collection has no folders', () => {
    const result = importPostmanCollection(POSTMAN_ECHO_COLLECTION, OPTIONS);
    const epsWithTags = result.model!.endpoints.filter((e) => e.tags);
    expect(epsWithTags).toHaveLength(0);
  });

  // 9. Empty collection → success: false with EMPTY_COLLECTION diagnostic
  it('fails with EMPTY_COLLECTION when item array is missing', () => {
    const empty = {
      info: {
        name: 'Empty',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
    };
    const result = importPostmanCollection(empty, OPTIONS);
    expect(result.success).toBe(false);
    expect(result.model).toBeNull();
    expect(result.diagnostics.some((d) => d.code === 'EMPTY_COLLECTION')).toBe(true);
  });

  // 10. Invalid input → success: false with PARSE_ERROR diagnostic
  it('fails with PARSE_ERROR when input is not a valid object', () => {
    const result = importPostmanCollection(null, OPTIONS);
    expect(result.success).toBe(false);
    expect(result.model).toBeNull();
    expect(result.diagnostics.some((d) => d.code === 'PARSE_ERROR')).toBe(true);
  });
});
