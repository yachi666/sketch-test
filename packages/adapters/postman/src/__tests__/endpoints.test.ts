import { describe, expect, it } from 'vitest';
import { flattenItems, mapToEndpoint } from '../mapper/endpoints.js';
import type { PostmanItem } from '../types.js';
import { makeFlatItem, makeSourceContext } from './helpers.js';

// ─── flattenItems ─────────────────────────────────────────────────────

describe('flattenItems', () => {
  it('flattens nested folders with accumulated tags', () => {
    const items: PostmanItem[] = [
      {
        name: 'Users',
        item: [
          {
            name: 'List Users',
            request: { method: 'GET', url: { raw: '/users', path: ['users'] } },
          },
          {
            name: 'Create User',
            request: { method: 'POST', url: { raw: '/users', path: ['users'] } },
          },
        ],
      },
      {
        name: 'Health',
        request: { method: 'GET', url: { raw: '/health', path: ['health'] } },
      },
    ];

    const flat = flattenItems(items);
    expect(flat).toHaveLength(3);
    expect(flat[0]!.tags).toContain('Users');
    expect(flat[2]!.tags).toEqual([]);
    expect(flat[2]!.folderPath).toBe('');
  });

  it('handles deeply nested folders', () => {
    const items: PostmanItem[] = [
      {
        name: 'API',
        item: [
          {
            name: 'v1',
            item: [
              {
                name: 'Get Users',
                request: {
                  method: 'GET',
                  url: { raw: '/api/v1/users', path: ['api', 'v1', 'users'] },
                },
              },
            ],
          },
        ],
      },
    ];

    const flat = flattenItems(items);
    expect(flat).toHaveLength(1);
    expect(flat[0]!.tags).toEqual(['API', 'v1']);
    expect(flat[0]!.folderPath).toBe('API / v1');
  });

  it('skips items without request and without item children', () => {
    const items: PostmanItem[] = [
      { name: 'Empty Item' } as PostmanItem,
      { name: 'Valid Request', request: { method: 'GET', url: { raw: '/ping', path: ['ping'] } } },
    ];

    const flat = flattenItems(items);
    expect(flat).toHaveLength(1);
    expect(flat[0]!.item.name).toBe('Valid Request');
  });

  it('returns empty array for empty input', () => {
    expect(flattenItems([])).toEqual([]);
  });
});

// ─── mapToEndpoint ────────────────────────────────────────────────────

describe('mapToEndpoint', () => {
  const ctx = makeSourceContext();

  it('produces a valid Endpoint from a flat item', () => {
    const { endpoint } = mapToEndpoint(
      {
        item: {
          name: 'Get Users',
          request: {
            method: 'GET',
            url: { raw: 'https://api.example.com/users', path: ['users'] },
          },
        },
        tags: ['Users'],
        folderPath: 'Users',
      },
      ctx,
    );

    expect(endpoint.method).toBe('GET');
    expect(endpoint.path).toBe('/users');
    expect(endpoint.summary).toBe('Get Users');
    expect(endpoint.tags).toContain('Users');
    expect(endpoint.id).toBe('GET-/users');
  });

  it('normalizes Postman path variables from :var to :var', () => {
    const { endpoint } = mapToEndpoint(
      {
        item: {
          name: 'Get User',
          request: {
            method: 'GET',
            url: { raw: '/users/:userId', path: ['users', ':userId'] },
          },
        },
        tags: [],
        folderPath: '',
      },
      ctx,
    );

    expect(endpoint.path).toBe('/users/:userId');
    expect(endpoint.id).toBe('GET-/users/:userId');
  });

  it('maps URL query params to Parameter[]', () => {
    const { endpoint } = mapToEndpoint(
      {
        item: {
          name: 'Search',
          request: {
            method: 'GET',
            url: {
              raw: '/search?q=test&page=1',
              path: ['search'],
              query: [
                { key: 'q', value: 'test' },
                { key: 'page', value: '1' },
              ],
            },
          },
        },
        tags: [],
        folderPath: '',
      },
      ctx,
    );

    const queryParams = endpoint.parameters.filter((p) => p.in === 'query');
    expect(queryParams).toHaveLength(2);
    expect(queryParams[0]!.name).toBe('q');
    expect(queryParams[0]!.example).toBe('test');
    expect(queryParams[1]!.name).toBe('page');
    expect(queryParams[1]!.example).toBe('1');
  });

  it('maps path variables to Parameter[] with in: path', () => {
    const { endpoint } = mapToEndpoint(
      {
        item: {
          name: 'Get User By Id',
          request: {
            method: 'GET',
            url: {
              raw: '/users/:userId',
              path: ['users', ':userId'],
              variable: [{ key: 'userId', value: '42' }],
            },
          },
        },
        tags: [],
        folderPath: '',
      },
      ctx,
    );

    const pathParams = endpoint.parameters.filter((p) => p.in === 'path');
    expect(pathParams).toHaveLength(1);
    expect(pathParams[0]!.name).toBe('userId');
    expect(pathParams[0]!.required).toBe(true);
    expect(pathParams[0]!.example).toBe('42');
  });

  it('maps headers to Parameter[] excluding Content-Type', () => {
    const { endpoint } = mapToEndpoint(
      {
        item: {
          name: 'Auth Request',
          request: {
            method: 'GET',
            url: { raw: '/auth', path: ['auth'] },
            header: [
              { key: 'Authorization', value: 'Bearer token123' },
              { key: 'Content-Type', value: 'application/json' },
              { key: 'X-Custom', value: 'custom-value' },
            ],
          },
        },
        tags: [],
        folderPath: '',
      },
      ctx,
    );

    const headerParams = endpoint.parameters.filter((p) => p.in === 'header');
    expect(headerParams).toHaveLength(2);
    expect(headerParams.find((p) => p.name === 'Authorization')).toBeDefined();
    expect(headerParams.find((p) => p.name === 'X-Custom')).toBeDefined();
    expect(headerParams.find((p) => p.name === 'Content-Type')).toBeUndefined();
  });

  it('maps request body with raw mode and default content type', () => {
    const { endpoint, diagnostics } = mapToEndpoint(
      {
        item: {
          name: 'Create User',
          request: {
            method: 'POST',
            url: { raw: '/users', path: ['users'] },
            body: {
              mode: 'raw',
              raw: '{"name":"John"}',
            },
          },
        },
        tags: [],
        folderPath: '',
      },
      ctx,
    );

    expect(endpoint.requestBodies).toHaveLength(1);
    const body = endpoint.requestBodies[0]!;
    expect(body.content['application/json']).toBeDefined();
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('maps request body with urlencoded mode', () => {
    const { endpoint } = mapToEndpoint(
      {
        item: {
          name: 'Login',
          request: {
            method: 'POST',
            url: { raw: '/login', path: ['login'] },
            body: {
              mode: 'urlencoded',
              urlencoded: [
                { key: 'username', value: 'admin' },
                { key: 'password', value: 'secret' },
              ],
            },
          },
        },
        tags: [],
        folderPath: '',
      },
      ctx,
    );

    expect(endpoint.requestBodies).toHaveLength(1);
    const body = endpoint.requestBodies[0]!;
    expect(body.content['application/x-www-form-urlencoded']).toBeDefined();
  });

  it('skips body when mode is none', () => {
    const { endpoint } = mapToEndpoint(
      {
        item: {
          name: 'Delete',
          request: {
            method: 'DELETE',
            url: { raw: '/items/1', path: ['items', '1'] },
            body: { mode: 'none' },
          },
        },
        tags: [],
        folderPath: '',
      },
      ctx,
    );

    expect(endpoint.requestBodies).toHaveLength(0);
  });

  it('maps response examples', () => {
    const { endpoint } = mapToEndpoint(
      {
        item: {
          name: 'Get User',
          request: {
            method: 'GET',
            url: { raw: '/users/1', path: ['users', '1'] },
          },
          response: [
            {
              name: 'Success',
              status: 'OK',
              code: 200,
              header: [{ key: 'Content-Type', value: 'application/json' }],
              body: '{"id":1,"name":"John"}',
            },
            {
              name: 'Not Found',
              status: 'Not Found',
              code: 404,
              body: '{"error":"not found"}',
            },
          ],
        },
        tags: [],
        folderPath: '',
      },
      ctx,
    );

    expect(endpoint.responses).toHaveLength(2);
    expect(endpoint.responses[0]!.statusCode).toBe(200);
    expect(endpoint.responses[0]!.description).toBe('Success');
    expect(endpoint.responses[0]!.content?.['application/json']?.example).toBe(
      '{"id":1,"name":"John"}',
    );
    expect(endpoint.responses[1]!.statusCode).toBe(404);
  });

  it('produces no responses when item has no stored responses', () => {
    const { endpoint } = mapToEndpoint(
      {
        item: {
          name: 'Simple Get',
          request: { method: 'GET', url: { raw: '/ping', path: ['ping'] } },
        },
        tags: [],
        folderPath: '',
      },
      ctx,
    );

    expect(endpoint.responses).toHaveLength(0);
  });

  it('uses item.description when present', () => {
    const { endpoint } = mapToEndpoint(
      {
        item: {
          name: 'Get Users',
          description: 'Retrieves a paginated list of users',
          request: { method: 'GET', url: { raw: '/users', path: ['users'] } },
        },
        tags: [],
        folderPath: '',
      },
      ctx,
    );

    expect(endpoint.description).toBe('Retrieves a paginated list of users');
  });

  it('handles POST method correctly', () => {
    const { endpoint } = mapToEndpoint(
      {
        item: {
          name: 'Create Item',
          request: { method: 'POST', url: { raw: '/items', path: ['items'] } },
        },
        tags: [],
        folderPath: '',
      },
      ctx,
    );

    expect(endpoint.method).toBe('POST');
    expect(endpoint.id).toBe('POST-/items');
  });

  it('assigns sourceLocation with context metadata', () => {
    const { endpoint } = mapToEndpoint(
      {
        item: {
          name: 'Get Users',
          request: { method: 'GET', url: { raw: '/users', path: ['users'] } },
        },
        tags: [],
        folderPath: '',
      },
      ctx,
    );

    expect(endpoint.sourceLocations).toHaveLength(1);
    expect(endpoint.sourceLocations[0]!.sourceId).toBe(ctx.sourceId);
    expect(endpoint.sourceLocations[0]!.sourceLabel).toBe(ctx.sourceLabel);
    expect(endpoint.sourceLocations[0]!.ingestedAt).toBe(ctx.ingestedAt);
    expect(endpoint.sourceLocations[0]!.location).toBe('Get Users');
  });

  it('handles URL as string (fallback parsing)', () => {
    const { endpoint } = mapToEndpoint(
      {
        item: {
          name: 'String URL',
          request: { method: 'GET', url: 'https://api.example.com/string-url' },
        },
        tags: [],
        folderPath: '',
      },
      ctx,
    );

    expect(endpoint.path).toBe('/string-url');
  });
});

// ─── makeFlatItem helper ─────────────────────────────────────────────

describe('makeFlatItem', () => {
  it('creates a default FlatItem', () => {
    const flat = makeFlatItem();
    expect(flat.item.name).toBe('Test Endpoint');
    expect(flat.item.request?.method).toBe('GET');
    expect(flat.tags).toEqual([]);
    expect(flat.folderPath).toBe('');
  });

  it('allows overriding item properties', () => {
    const flat = makeFlatItem({
      name: 'Custom Endpoint',
    });
    expect(flat.item.name).toBe('Custom Endpoint');
  });
});
