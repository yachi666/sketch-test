import { describe, expect, it } from 'vitest';
import { detectFormat } from '../index.js';

describe('detectFormat — Postman Collection', () => {
  it('detects Postman v2.1 collection with high confidence', () => {
    const input = {
      info: {
        name: 'Test API',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'Get Users',
          request: { method: 'GET', url: { raw: 'https://api.example.com/users' } },
        },
      ],
    };

    const results = detectFormat(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.format).toBe('postman-collection');
    expect(results[0]!.confidence).toBeGreaterThanOrEqual(0.95);
    expect(results[0]!.version).toBe('2.1');
  });

  it('detects Postman v2.0 collection with high confidence', () => {
    const input = {
      info: {
        name: 'Test API',
        schema: 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json',
      },
      item: [],
    };

    const results = detectFormat(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.format).toBe('postman-collection');
    expect(results[0]!.confidence).toBeGreaterThanOrEqual(0.95);
    expect(results[0]!.version).toBe('2.0');
  });

  it('detects Postman v1 collection', () => {
    const input = {
      name: 'Legacy API',
      requests: [{ name: 'Get Users', method: 'GET', url: 'https://api.example.com/users' }],
      folders: [{ name: 'Users' }],
    };

    const results = detectFormat(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.format).toBe('postman-collection');
    expect(results[0]!.confidence).toBe(0.75);
    expect(results[0]!.version).toBe('1');
  });

  it('detects Postman Environment', () => {
    const result = detectFormat({
      id: 'env-id',
      name: 'Production',
      values: [{ key: 'baseUrl', value: 'https://api.example.com', enabled: true }],
      _postman_variable_scope: 'environment',
    });
    const match = result.find((r) => r.format === 'postman-environment');
    expect(match).toBeDefined();
    expect(match!.confidence).toBe(0.85);
  });

  it('returns multiple candidates for ambiguous Postman v1 input', () => {
    // A Postman v1 doc looks like a generic object — may overlap with OpenAPI
    const input = {
      name: 'Ambiguous',
      requests: [],
      folders: [],
      swagger: '2.0',
    };

    const results = detectFormat(input);
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Swagger 2.0 should rank higher than Postman v1 with empty requests
    expect(results[0]!.format).toBe('openapi');
  });
});
