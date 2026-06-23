/**
 * @sketch-test/adapter-har — fixture tests
 *
 * Tests the HAR adapter with a minimal representative HAR 1.2 fixture.
 */
import { describe, it, expect } from 'vitest';
import { CanonicalApiModelSchema } from '@sketch-test/canonical-api-model';
import { importHar } from '../index.js';
import type { ContentHash, SemanticVersion } from '@sketch-test/contracts-common';

// ─── Fixtures ───────────────────────────────────────────────────────

const SOURCE_LABEL = 'test-api.har';
const SOURCE_HASH =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' as ContentHash;

/** A minimal HAR 1.2 with two entries: GET /users and POST /users. */
const MINIMAL_HAR = {
  log: {
    version: '1.2',
    entries: [
      {
        request: {
          method: 'GET',
          url: 'https://api.example.com/users',
          headers: [{ name: 'Accept', value: 'application/json' }],
          queryString: [{ name: 'page', value: '1' }],
        },
        response: {
          status: 200,
          statusText: 'OK',
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          content: {
            mimeType: 'application/json',
            text: '[{"id":1,"name":"Alice"}]',
          },
        },
      },
      {
        request: {
          method: 'POST',
          url: 'https://api.example.com/users',
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          postData: {
            mimeType: 'application/json',
            text: '{"name":"Bob"}',
          },
        },
        response: {
          status: 201,
          statusText: 'Created',
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          content: {
            mimeType: 'application/json',
            text: '{"id":2,"name":"Bob"}',
          },
        },
      },
    ],
  },
};

describe('HAR Adapter', () => {
  describe('happy path', () => {
    it('imports a minimal HAR successfully', () => {
      const result = importHar(MINIMAL_HAR, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      expect(result.success).toBe(true);
      expect(result.model).not.toBeNull();
      expect(result.diagnostics).toHaveLength(0);
    });

    it('produces the correct endpoint count', () => {
      const result = importHar(MINIMAL_HAR, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      expect(result.model!.endpoints).toHaveLength(2);
    });

    it('maps method and path correctly', () => {
      const result = importHar(MINIMAL_HAR, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      const [ep0, ep1] = result.model!.endpoints;

      expect(ep0!.method).toBe('GET');
      expect(ep0!.path).toBe('/users');
      expect(ep1!.method).toBe('POST');
      expect(ep1!.path).toBe('/users');
    });

    it('passes Zod validation against CanonicalApiModelSchema', () => {
      const result = importHar(MINIMAL_HAR, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      const parsed = CanonicalApiModelSchema.parse(result.model);
      expect(parsed).toBeDefined();
      expect(parsed.schemaVersion).toBe('sketch-test.canonical-api/v1');
    });

    it('produces stable endpoint ids', () => {
      const result = importHar(MINIMAL_HAR, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      expect(result.model!.endpoints[0]!.id).toBe('GET-/users');
      expect(result.model!.endpoints[1]!.id).toBe('POST-/users');
    });

    it('maps query string parameters', () => {
      const result = importHar(MINIMAL_HAR, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      const params = result.model!.endpoints[0]!.parameters;
      // One Accept header + one page query param
      expect(params).toHaveLength(2);

      const queryParam = params.find((p) => p.name === 'page');
      expect(queryParam).toBeDefined();
      expect(queryParam!.in).toBe('query');
    });

    it('maps request headers as parameters', () => {
      const result = importHar(MINIMAL_HAR, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      const params = result.model!.endpoints[1]!.parameters;
      const headerParam = params.find((p) => p.name === 'Content-Type');
      expect(headerParam).toBeDefined();
      expect(headerParam!.in).toBe('header');
    });

    it('maps request body for POST entries', () => {
      const result = importHar(MINIMAL_HAR, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      const ep1 = result.model!.endpoints[1]!;
      expect(ep1.requestBodies).toHaveLength(1);
      expect(ep1.requestBodies[0]!.required).toBe(true);
      expect(ep1.requestBodies[0]!.content['application/json']).toBeDefined();
      expect(ep1.requestBodies[0]!.content['application/json']!.example).toBe('{"name":"Bob"}');
    });

    it('maps response status, content, and headers', () => {
      const result = importHar(MINIMAL_HAR, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      const ep0 = result.model!.endpoints[0]!;
      expect(ep0.responses).toHaveLength(1);
      expect(ep0.responses[0]!.statusCode).toBe(200);
      expect(ep0.responses[0]!.description).toBe('OK');
      expect(ep0.responses[0]!.content!['application/json']).toBeDefined();
      expect(ep0.responses[0]!.content!['application/json']!.example).toBe(
        '[{"id":1,"name":"Alice"}]',
      );
    });

    it('assigns source locations to every endpoint', () => {
      const result = importHar(MINIMAL_HAR, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      for (const ep of result.model!.endpoints) {
        expect(ep.sourceLocations).toHaveLength(1);
        expect(ep.sourceLocations[0]!.sourceLabel).toBe(SOURCE_LABEL);
        expect(ep.sourceLocations[0]!.location).toMatch(/^log\.entries\[\d+\]\.request$/);
      }
    });

    it('sets metadata correctly', () => {
      const result = importHar(MINIMAL_HAR, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
        parserVersion: '1.0.0' as SemanticVersion,
      });

      const meta = result.model!.metadata;
      expect(meta.sourceLabel).toBe(SOURCE_LABEL);
      expect(meta.sourceHash).toBe(SOURCE_HASH);
      expect(meta.parserName).toBe('@sketch-test/adapter-har');
      expect(meta.parserVersion).toBe('1.0.0');
      expect(meta.sourceType).toBe('manual');
    });

    it('uses default parser version when not provided', () => {
      const result = importHar(MINIMAL_HAR, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      expect(result.model!.metadata.parserVersion).toBe('0.1.0');
    });

    it('handles response without content', () => {
      const har = {
        log: {
          version: '1.2',
          entries: [
            {
              request: { method: 'DELETE', url: 'https://api.example.com/users/1' },
              response: { status: 204, statusText: 'No Content' },
            },
          ],
        },
      };

      const result = importHar(har, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      expect(result.success).toBe(true);
      expect(result.model!.endpoints[0]!.responses[0]!.statusCode).toBe(204);
      expect(result.model!.endpoints[0]!.responses[0]!.content).toBeUndefined();
    });
  });

  describe('error cases', () => {
    it('rejects non-object input', () => {
      const result = importHar('not an object', {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      expect(result.success).toBe(false);
      expect(result.model).toBeNull();
      expect(result.diagnostics[0]!.code).toBe('INVALID_HAR');
    });

    it('rejects null input', () => {
      const result = importHar(null, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      expect(result.success).toBe(false);
      expect(result.model).toBeNull();
    });

    it('rejects missing log.entries', () => {
      const result = importHar(
        { log: {} },
        {
          sourceLabel: SOURCE_LABEL,
          sourceHash: SOURCE_HASH,
        },
      );

      expect(result.success).toBe(false);
      expect(result.model).toBeNull();
      expect(result.diagnostics[0]!.code).toBe('INVALID_HAR_STRUCTURE');
    });

    it('rejects empty entries array', () => {
      const result = importHar(
        { log: { version: '1.2', entries: [] } },
        {
          sourceLabel: SOURCE_LABEL,
          sourceHash: SOURCE_HASH,
        },
      );

      expect(result.success).toBe(false);
      expect(result.model).toBeNull();
      expect(result.diagnostics[0]!.code).toBe('EMPTY_HAR');
    });

    it('skips entries with unsupported HTTP methods', () => {
      const har = {
        log: {
          version: '1.2',
          entries: [
            {
              request: { method: 'CONNECT', url: 'https://api.example.com/tunnel' },
              response: { status: 200, statusText: 'OK' },
            },
            {
              request: { method: 'GET', url: 'https://api.example.com/health' },
              response: { status: 200, statusText: 'OK' },
            },
          ],
        },
      };

      const result = importHar(har, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      expect(result.success).toBe(true);
      expect(result.model!.endpoints).toHaveLength(1);
      expect(result.model!.endpoints[0]!.method).toBe('GET');
      // Should have a warning diagnostic for the CONNECT method
      const methodWarnings = result.diagnostics.filter((d) => d.code === 'UNSUPPORTED_HTTP_METHOD');
      expect(methodWarnings).toHaveLength(1);
    });

    it('fails when no valid endpoints remain after filtering', () => {
      const har = {
        log: {
          version: '1.2',
          entries: [
            {
              request: { method: 'CONNECT', url: 'https://api.example.com/tunnel' },
              response: { status: 200, statusText: 'OK' },
            },
          ],
        },
      };

      const result = importHar(har, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      expect(result.success).toBe(false);
      expect(result.model).toBeNull();
      const noEndpoints = result.diagnostics.find((d) => d.code === 'NO_VALID_ENDPOINTS');
      expect(noEndpoints).toBeDefined();
    });

    it('warns on entries missing request or response', () => {
      const har = {
        log: {
          version: '1.2',
          entries: [
            {
              request: { method: 'GET', url: 'https://api.example.com/ok' },
              response: { status: 200, statusText: 'OK' },
            },
            {} as unknown as { request?: unknown; response?: unknown },
          ],
        },
      };

      const result = importHar(har, {
        sourceLabel: SOURCE_LABEL,
        sourceHash: SOURCE_HASH,
      });

      expect(result.success).toBe(true);
      expect(result.model!.endpoints).toHaveLength(1);
      const invalidWarnings = result.diagnostics.filter((d) => d.code === 'INVALID_HAR_ENTRY');
      expect(invalidWarnings).toHaveLength(1);
    });
  });
});
