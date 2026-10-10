import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { importPostmanCollectionV3 } from '../index.js';
import { parsePostmanV3Bundle } from '../parser/v3.js';

const bundle = {
  files: {
    'definition.yaml': `name: Orders\ndescription: Exercisable collection\nvariables:\n  - name: baseUrl\n    default: https://api.example.test\n`,
    'orders/create.request.yaml': `name: Create order\nrequest:\n  method: POST\n  url: '{{baseUrl}}/orders'\n  headers:\n    Content-Type: application/json\n  body:\n    mode: raw\n    content: '{"sku":"abc"}'\n`,
    'orders/create.resources/scripts/pre-request.js': `pm.variables.set('requestId', 'fixed-id');`,
    'orders/create.resources/scripts/test.js': `pm.test('created', () => {\n  pm.response.to.have.status(201);\n});`,
    'orders/create.resources/examples/created.json': '{"id":"order-1"}',
    'orders/create.resources/extensions/custom-resource.txt': 'preserve me',
  },
} as const;

describe('Postman Collection v3 bundle import', () => {
  test('preserves all v3 files and execution resources while projecting HTTP requests', () => {
    const parsed = parsePostmanV3Bundle(bundle);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.collection?.item).toHaveLength(1);
    expect(parsed.executionModel).toMatchObject({
      format: 'v3.0',
      collection: {
        name: 'Orders',
        variables: [{ key: 'baseUrl', value: 'https://api.example.test' }],
      },
    });
    expect(parsed.executionModel?.resources).toHaveLength(Object.keys(bundle.files).length);
    expect(parsed.executionModel?.requests[0]).toMatchObject({
      itemPath: 'orders/create',
      method: 'POST',
      scripts: [
        { listen: 'prerequest', source: "pm.variables.set('requestId', 'fixed-id');" },
        { listen: 'test' },
      ],
      examples: [{ sourcePath: 'orders/create.resources/examples/created.json' }],
    });
  });

  test('returns the canonical projection plus the complete migration manifest', () => {
    const result = importPostmanCollectionV3(bundle, {
      sourceLabel: 'postman/orders',
      sourceHash: createHash('sha256').update('orders').digest('hex'),
    });

    expect(result.success).toBe(true);
    expect(result.model?.endpoints).toHaveLength(1);
    expect(result.model?.endpoints[0]).toMatchObject({ method: 'POST', path: '/orders' });
    expect(result.executionModel?.resources.map((resource) => resource.path)).toContain(
      'orders/create.resources/extensions/custom-resource.txt',
    );
    expect(result.model?.metadata.extra?.['postmanExecution']).toMatchObject({ format: 'v3.0' });
  });

  test('rejects traversal paths before they can become source resources', () => {
    const parsed = parsePostmanV3Bundle({
      files: { '../outside.request.yaml': 'method: GET\nurl: https://api.example.test/health' },
    });

    expect(parsed.collection).toBeNull();
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'POSTMAN_V3_INVALID_PATH' }),
    );
  });

  test('uses numeric fractional indexes before paths and retains folders as workflow topology', () => {
    const parsed = parsePostmanV3Bundle({
      files: {
        'definition.yaml': 'name: Ordered\n',
        'a/second.request.yaml': 'index: 20\nmethod: GET\nurl: https://api.example.test/second\n',
        'a/first.request.yaml': 'index: 10\nmethod: GET\nurl: https://api.example.test/first\n',
      },
    });
    expect(parsed.executionModel?.requests.map((request) => request.itemPath)).toEqual([
      'a/first',
      'a/second',
    ]);
    expect(parsed.collection?.item[0]).toMatchObject({
      name: 'a',
      item: [{ name: 'first' }, { name: 'second' }],
    });
  });
});
