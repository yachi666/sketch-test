import { describe, expect, it } from 'vitest';
import { resolveVariables, expandTemplate } from '../mapper/variables.js';
import type { PostmanVariable } from '../types.js';

// ─── resolveVariables ───────────────────────────────────────────────────

describe('resolveVariables', () => {
  it('merges collection and environment variables with env priority', () => {
    const scope = resolveVariables(
      [{ key: 'baseUrl', value: 'http://localhost' }],
      [{ key: 'baseUrl', value: 'https://prod.example.com' }],
    );

    expect(scope.variables.get('baseUrl')).toBe('https://prod.example.com');
    expect(scope.variables.size).toBe(1);
  });

  it('skips disabled environment variables', () => {
    const scope = resolveVariables(
      [{ key: 'host', value: 'http://localhost' }],
      [{ key: 'host', value: 'http://prod', disabled: true }],
    );

    expect(scope.variables.get('host')).toBe('http://localhost');
  });

  it('skips disabled collection variables', () => {
    const scope = resolveVariables(
      [{ key: 'host', value: 'http://localhost', disabled: true }],
      [{ key: 'host', value: 'http://prod' }],
    );

    expect(scope.variables.get('host')).toBe('http://prod');
  });

  it('merges disjoint collection and environment variables', () => {
    const scope = resolveVariables(
      [{ key: 'host', value: 'http://localhost' }],
      [{ key: 'port', value: '8080' }],
    );

    expect(scope.variables.get('host')).toBe('http://localhost');
    expect(scope.variables.get('port')).toBe('8080');
    expect(scope.variables.size).toBe(2);
  });

  it('returns empty scope for empty collection and env vars', () => {
    const scope = resolveVariables([], []);

    expect(scope.variables.size).toBe(0);
    expect(scope.dynamicVariables).toEqual([]);
    expect(scope.unresolved).toEqual([]);
  });

  it('returns empty scope when both inputs are undefined', () => {
    const scope = resolveVariables(undefined, undefined);

    expect(scope.variables.size).toBe(0);
    expect(scope.dynamicVariables).toEqual([]);
    expect(scope.unresolved).toEqual([]);
  });

  it('returns empty scope when both inputs are null', () => {
    const scope = resolveVariables(undefined, undefined);

    expect(scope.variables.size).toBe(0);
  });

  it('handles collection vars with undefined envVars', () => {
    const scope = resolveVariables([{ key: 'host', value: 'http://localhost' }]);

    expect(scope.variables.get('host')).toBe('http://localhost');
    expect(scope.variables.size).toBe(1);
  });

  it('initializes dynamicVariables and unresolved as empty arrays', () => {
    const scope = resolveVariables(
      [{ key: 'host', value: 'http://localhost' }],
      [{ key: 'port', value: '8080' }],
    );

    expect(scope.dynamicVariables).toEqual([]);
    expect(scope.unresolved).toEqual([]);
  });
});

// ─── expandTemplate ─────────────────────────────────────────────────────

describe('expandTemplate', () => {
  it('replaces a known variable with its resolved value', () => {
    const scope = resolveVariables([{ key: 'baseUrl', value: 'http://localhost' }]);

    const result = expandTemplate('{{baseUrl}}/api/users', scope);

    expect(result).toBe('http://localhost/api/users');
  });

  it('env overrides collection when expanding', () => {
    const scope = resolveVariables(
      [{ key: 'baseUrl', value: 'http://localhost' }],
      [{ key: 'baseUrl', value: 'https://prod.example.com' }],
    );

    const result = expandTemplate('{{baseUrl}}/api/users', scope);

    expect(result).toBe('https://prod.example.com/api/users');
  });

  it('preserves unresolvable variables as {{varName}}', () => {
    const scope = resolveVariables([], []);

    const result = expandTemplate('{{unknownVar}}/path', scope);

    expect(result).toBe('{{unknownVar}}/path');
  });

  it('adds unresolvable variables to scope.unresolved', () => {
    const scope = resolveVariables([], []);

    expandTemplate('{{unknownVar}}/path', scope);

    expect(scope.unresolved).toContain('unknownVar');
  });

  it('tracks multiple unique unresolved variables', () => {
    const scope = resolveVariables([], []);

    expandTemplate('{{foo}}/{{bar}}/{{foo}}', scope);

    expect(scope.unresolved).toHaveLength(2);
    expect(scope.unresolved).toContain('foo');
    expect(scope.unresolved).toContain('bar');
  });

  it('skips disabled env vars during expansion', () => {
    const scope = resolveVariables(
      [{ key: 'host', value: 'http://localhost' }],
      [{ key: 'host', value: 'http://prod', disabled: true }],
    );

    const result = expandTemplate('{{host}}/api', scope);

    expect(result).toBe('http://localhost/api');
  });

  it('detects $randomInt as dynamic variable', () => {
    const scope = resolveVariables([]);

    const result = expandTemplate('/users/{{$randomInt}}', scope);

    expect(result).toBe('/users/{{$randomInt}}');
    expect(scope.dynamicVariables).toContain('$randomInt');
  });

  it('detects $guid as dynamic variable', () => {
    const scope = resolveVariables([]);

    const result = expandTemplate('/users/{{$guid}}', scope);

    expect(result).toBe('/users/{{$guid}}');
    expect(scope.dynamicVariables).toContain('$guid');
  });

  it('detects $timestamp as dynamic variable', () => {
    const scope = resolveVariables([]);

    const result = expandTemplate('/users/{{$timestamp}}', scope);

    expect(result).toBe('/users/{{$timestamp}}');
    expect(scope.dynamicVariables).toContain('$timestamp');
  });

  it('detects $randomUUID as dynamic variable', () => {
    const scope = resolveVariables([]);

    const result = expandTemplate('/users/{{$randomUUID}}', scope);

    expect(result).toBe('/users/{{$randomUUID}}');
    expect(scope.dynamicVariables).toContain('$randomUUID');
  });

  it('detects $randomFirstName as dynamic variable', () => {
    const scope = resolveVariables([]);

    const result = expandTemplate('/users/{{$randomFirstName}}', scope);

    expect(result).toBe('/users/{{$randomFirstName}}');
    expect(scope.dynamicVariables).toContain('$randomFirstName');
  });

  it('tracks multiple unique dynamic variables', () => {
    const scope = resolveVariables([]);

    expandTemplate('{{$randomInt}}/{{$guid}}/{{$randomInt}}', scope);

    expect(scope.dynamicVariables).toHaveLength(2);
    expect(scope.dynamicVariables).toContain('$randomInt');
    expect(scope.dynamicVariables).toContain('$guid');
  });

  it('expands multiple variables in one string', () => {
    const scope = resolveVariables([
      { key: 'scheme', value: 'https' },
      { key: 'host', value: 'api.example.com' },
      { key: 'path', value: 'users' },
    ]);

    const result = expandTemplate('{{scheme}}://{{host}}/{{path}}', scope);

    expect(result).toBe('https://api.example.com/users');
  });

  it('handles template string with no variable patterns', () => {
    const scope = resolveVariables([{ key: 'host', value: 'localhost' }]);

    const result = expandTemplate('/plain/path', scope);

    expect(result).toBe('/plain/path');
  });

  it('handles empty template string', () => {
    const scope = resolveVariables([]);

    const result = expandTemplate('', scope);

    expect(result).toBe('');
  });

  it('keeps {{unknownVar}} when known variable has different casing', () => {
    const scope = resolveVariables([{ key: 'Host', value: 'localhost' }]);

    const result = expandTemplate('{{host}}/path', scope);

    expect(result).toBe('{{host}}/path');
    expect(scope.unresolved).toContain('host');
  });

  it('preserves complex URL with mixed resolved, dynamic, and unresolved vars', () => {
    const scope = resolveVariables(
      [{ key: 'baseUrl', value: 'https://api.example.com' }],
      [{ key: 'apiKey', value: 'abc-123' }],
    );

    const result = expandTemplate(
      '{{baseUrl}}/users/{{$randomInt}}?key={{apiKey}}&token={{unknownToken}}',
      scope,
    );

    expect(result).toBe(
      'https://api.example.com/users/{{$randomInt}}?key=abc-123&token={{unknownToken}}',
    );
    expect(scope.dynamicVariables).toContain('$randomInt');
    expect(scope.unresolved).toContain('unknownToken');
  });
});
