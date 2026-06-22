/**
 * OpenAPI Adapter golden tests.
 *
 * Uses the Hermetic Fixture Server's OpenAPI spec as the primary
 * golden fixture. The adapter must produce a valid CanonicalApiModel
 * with correct endpoint counts, schema references, and diagnostics.
 */

import { CanonicalApiModelSchema } from '@tap/canonical-api-model';
import { describe, expect, test } from 'vitest';
import { importOpenApi, type OpenApiDocument } from '../index';

// ─── Fixture Server OpenAPI Spec (minimal inline copy) ────────────

const FIXTURE_OPENAPI: OpenApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Hermetic Fixture API',
    version: '1.0.0',
    description: 'Deterministic REST API for TAP integration testing.',
  },
  servers: [{ url: 'http://127.0.0.1:3800', description: 'Fixture Server' }],
  paths: {
    '/api/users': {
      post: {
        operationId: 'createUser',
        summary: '创建用户',
        tags: ['Users'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateUserRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: '创建成功',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/UserResponse' } },
            },
          },
          '400': { description: '参数校验失败' },
          '409': { description: '邮箱已注册' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        operationId: 'login',
        summary: '用户登录',
        tags: ['Auth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginRequest' },
            },
          },
        },
        responses: {
          '200': { description: '登录成功' },
          '401': { description: '认证失败' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        operationId: 'getCurrentUser',
        summary: '获取当前用户',
        tags: ['Auth'],
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: '成功' },
          '401': { description: '未登录' },
        },
      },
    },
    '/api/users/{userId}': {
      get: {
        operationId: 'getUser',
        summary: '查询用户',
        tags: ['Users'],
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: '成功' },
          '404': { description: '用户不存在' },
        },
      },
    },
    '/api/orders': {
      post: {
        operationId: 'createOrder',
        summary: '创建订单',
        tags: ['Orders'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateOrderRequest' },
            },
          },
        },
        responses: {
          '201': { description: '创建成功' },
          '400': { description: '参数校验失败' },
          '401': { description: '未登录' },
          '422': { description: '金额不合法' },
        },
      },
    },
    '/api/orders/{orderId}': {
      get: {
        operationId: 'getOrder',
        summary: '查询订单',
        tags: ['Orders'],
        parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: '成功' },
          '404': { description: '订单不存在' },
        },
      },
      delete: {
        operationId: 'cancelOrder',
        summary: '取消订单',
        tags: ['Orders'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: '取消成功' },
          '404': { description: '订单不存在' },
        },
      },
    },
    '/api/payments': {
      post: {
        operationId: 'createPayment',
        summary: '支付订单',
        tags: ['Payments'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreatePaymentRequest' },
            },
          },
        },
        responses: {
          '200': { description: '支付成功' },
          '400': { description: '支付失败' },
          '404': { description: '订单不存在' },
          '409': { description: '订单已支付' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'token' },
    },
    schemas: {
      CreateUserRequest: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 64 },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 6, maxLength: 128 },
        },
      },
      UserResponse: {
        type: 'object',
        properties: {
          code: { type: 'integer' },
          data: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              name: { type: 'string' },
              email: { type: 'string' },
            },
          },
          message: { type: 'string' },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      },
      CreateOrderRequest: {
        type: 'object',
        required: ['amount', 'items'],
        properties: {
          amount: { type: 'number', minimum: 0.01, maximum: 99999 },
          items: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'price', 'quantity'],
              properties: {
                name: { type: 'string' },
                price: { type: 'number' },
                quantity: { type: 'integer', minimum: 1 },
              },
            },
          },
        },
      },
      CreatePaymentRequest: {
        type: 'object',
        required: ['orderId', 'amount'],
        properties: {
          orderId: { type: 'string' },
          amount: { type: 'number', minimum: 0.01 },
          method: { type: 'string', enum: ['credit_card', 'debit_card', 'wechat', 'alipay'] },
        },
      },
    },
  },
};

const SOURCE_HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2' as const;

// ─── Tests ────────────────────────────────────────────────────────

describe('OpenAPI Adapter', () => {
  const result = importOpenApi(FIXTURE_OPENAPI, {
    sourceLabel: 'fixture-openapi.yaml',
    sourceHash: SOURCE_HASH,
  });

  test('import succeeds', () => {
    expect(result.success).toBe(true);
    expect(result.model).not.toBeNull();
  });

  test('produces valid CanonicalApiModel', () => {
    const parsed = CanonicalApiModelSchema.safeParse(result.model);
    if (!parsed.success) {
      console.error(JSON.stringify(parsed.error.issues, null, 2));
    }
    expect(parsed.success).toBe(true);
  });

  test('correct endpoint count', () => {
    // 7 paths × methods: POST /users, POST /auth/login, GET /auth/me,
    // GET /users/{userId}, POST /orders, GET /orders/{orderId},
    // DELETE /orders/{orderId}, POST /payments = 8 endpoints
    expect(result.model!.endpoints).toHaveLength(8);
  });

  test('correct server count', () => {
    expect(result.model!.servers).toHaveLength(1);
    expect(result.model!.servers[0]!.url).toBe('http://127.0.0.1:3800');
  });

  test('correct security scheme count', () => {
    expect(result.model!.securitySchemes).toHaveLength(1);
    expect(result.model!.securitySchemes[0]!.type).toBe('http');
    expect(result.model!.securitySchemes[0]!.scheme).toBe('bearer');
  });

  test('extracts schemas from components', () => {
    const schemaIds = Object.keys(result.model!.schemas);
    expect(schemaIds.length).toBeGreaterThanOrEqual(5);
    // Should include the top-level named schemas
    expect(schemaIds).toContain('/schemas/CreateUserRequest');
    expect(schemaIds).toContain('/schemas/LoginRequest');
    expect(schemaIds).toContain('/schemas/CreateOrderRequest');
    expect(schemaIds).toContain('/schemas/CreatePaymentRequest');
  });

  test('stable endpoint ids', () => {
    const ids = result.model!.endpoints.map((e) => e.id);
    expect(ids).toContain('POST-/api/users');
    expect(ids).toContain('POST-/api/auth/login');
    expect(ids).toContain('GET-/api/auth/me');
    expect(ids).toContain('GET-/api/users/:userId');
    expect(ids).toContain('POST-/api/orders');
    expect(ids).toContain('GET-/api/orders/:orderId');
    expect(ids).toContain('DELETE-/api/orders/:orderId');
    expect(ids).toContain('POST-/api/payments');
  });

  test('path parameters normalized (OpenAPI {param} → :param)', () => {
    const userEndpoint = result.model!.endpoints.find((e) => e.id === 'GET-/api/users/:userId');
    expect(userEndpoint).toBeDefined();
    expect(userEndpoint!.path).toBe('/api/users/:userId');
  });

  test('every endpoint has source locations', () => {
    for (const ep of result.model!.endpoints) {
      expect(ep.sourceLocations.length).toBeGreaterThanOrEqual(1);
      expect(ep.sourceLocations[0]!.sourceLabel).toBe('fixture-openapi.yaml');
    }
  });

  test('endpoints with security requirements preserve them', () => {
    const createOrder = result.model!.endpoints.find((e) => e.id === 'POST-/api/orders');
    expect(createOrder).toBeDefined();
    expect(createOrder!.security).toEqual([{ bearerAuth: [] }]);
  });

  test('public endpoints have no security', () => {
    const login = result.model!.endpoints.find((e) => e.id === 'POST-/api/auth/login');
    expect(login).toBeDefined();
    expect(login!.security).toBeUndefined();
  });

  test('operationId preserved', () => {
    const createUser = result.model!.endpoints.find((e) => e.id === 'POST-/api/users');
    expect(createUser!.operationId).toBe('createUser');
  });

  test('tags preserved', () => {
    const createUser = result.model!.endpoints.find((e) => e.id === 'POST-/api/users');
    expect(createUser!.tags).toEqual(['Users']);
  });

  test('required request body detected', () => {
    const createUser = result.model!.endpoints.find((e) => e.id === 'POST-/api/users');
    expect(createUser!.requestBodies[0]!.required).toBe(true);
  });

  test('metadata includes parser info', () => {
    expect(result.model!.metadata.sourceType).toBe('openapi');
    expect(result.model!.metadata.parserName).toBe('@tap/adapter-openapi');
    expect(result.model!.metadata.sourceLabel).toBe('fixture-openapi.yaml');
    expect(result.model!.metadata.sourceVersion).toBe('1.0.0');
  });
});

describe('OpenAPI Adapter — error cases', () => {
  test('rejects OpenAPI 2.0 (Swagger)', () => {
    const swagger = { ...FIXTURE_OPENAPI, openapi: '2.0' };
    const result = importOpenApi(swagger, {
      sourceLabel: 'swagger.json',
      sourceHash: SOURCE_HASH,
    });
    expect(result.success).toBe(false);
    expect(result.model).toBeNull();
    expect(result.diagnostics[0]!.code).toBe('UNSUPPORTED_OPENAPI_VERSION');
  });

  test('warns on unsupported top-level constructs', () => {
    const withWebhooks = { ...FIXTURE_OPENAPI, webhooks: {} };
    const result = importOpenApi(withWebhooks, {
      sourceLabel: 'with-webhooks.yaml',
      sourceHash: SOURCE_HASH,
    });
    const webhookDiags = result.diagnostics.filter((d) => d.code === 'WEBHOOKS_NOT_SUPPORTED');
    expect(webhookDiags.length).toBe(1);
  });
});
