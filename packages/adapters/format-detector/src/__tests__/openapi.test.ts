import { describe, expect, it } from 'vitest';
import { detectFormat } from '../index.js';

describe('detectFormat — OpenAPI / Swagger', () => {
  it('detects OpenAPI 3.0', () => {
    const input = {
      openapi: '3.0.3',
      info: { title: 'Test API', version: '1.0.0' },
      paths: { '/users': { get: { responses: { '200': { description: 'OK' } } } } },
    };

    const results = detectFormat(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.format).toBe('openapi');
    expect(results[0]!.confidence).toBe(0.98);
    expect(results[0]!.version).toBe('3.0');
  });

  it('detects OpenAPI 3.1', () => {
    const input = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {},
    };

    const results = detectFormat(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.format).toBe('openapi');
    expect(results[0]!.confidence).toBe(0.98);
    expect(results[0]!.version).toBe('3.1');
  });

  it('detects Swagger 2.0', () => {
    const input = {
      swagger: '2.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: { '/users': { get: { responses: { '200': { description: 'OK' } } } } },
    };

    const results = detectFormat(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.format).toBe('openapi');
    expect(results[0]!.confidence).toBe(0.98);
    expect(results[0]!.version).toBe('2.0');
  });

  it('rejects non-API objects', () => {
    const input = { info: { title: 'No paths' } };
    const results = detectFormat(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.format).toBe('unknown');
  });
});
