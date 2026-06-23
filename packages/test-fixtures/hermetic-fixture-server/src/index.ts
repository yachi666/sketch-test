/**
 * Hermetic Fixture Server — Deterministic REST API for sketch-test testing.
 *
 * Provides: users, auth, orders, payments with fixed clock, fixed random seed,
 * fault injection, and an OpenAPI endpoint. Used by Runner integration tests
 * and local development.
 *
 * sketch-test-004: M0 feasibility verification.
 *
 * Usage:
 *   npx tsx src/index.ts            # default port 3800
 *   FIXTURE_PORT=3801 npx tsx ...   # custom port
 *   FAULT_MODE=timeout npx tsx ...  # inject faults
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

// ─── Configuration ──────────────────────────────────────────────

const PORT = parseInt(process.env['FIXTURE_PORT'] ?? '3800', 10);
const FAULT_MODE = process.env['FAULT_MODE'] as FaultMode | undefined;
const FAULT_TARGET = process.env['FAULT_TARGET'] ?? ''; // endpoint path prefix to fault

type FaultMode = 'timeout' | '500' | 'slow';

// ─── Fixed Seeds ─────────────────────────────────────────────────

/** Fixed clock: always returns the same timestamp. */
const FIXED_NOW = new Date('2026-06-21T10:00:00.000Z');

/** Simple deterministic pseudo-random (LCG). Seed = 42. */
let randState = 42;
function fixedRandom(): number {
  randState = (randState * 1664525 + 1013904223) & 0x7fffffff;
  return randState / 0x7fffffff;
}
function resetRandom(): void {
  randState = 42;
}

// ─── In-Memory Store ────────────────────────────────────────────

interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  createdAt: string;
}

interface Order {
  id: string;
  userId: string;
  amount: number;
  status: '待支付' | '已支付' | '已取消';
  items: Array<{ name: string; price: number; quantity: number }>;
  createdAt: string;
}

interface Payment {
  id: string;
  orderId: string;
  amount: number;
  method: string;
  status: '成功' | '失败' | '处理中';
  createdAt: string;
}

const users = new Map<string, User>();
const orders = new Map<string, Order>();
const payments = new Map<string, Payment>();
const tokens = new Map<string, string>(); // token -> userId

// Seed data
function seed(): void {
  resetRandom();
  users.clear();
  orders.clear();
  payments.clear();
  tokens.clear();

  const u1: User = {
    id: 'u-001',
    name: '测试用户',
    email: 'test@sketch.dev',
    password: 'test123456',
    createdAt: FIXED_NOW.toISOString(),
  };
  users.set(u1.id, u1);

  const o1: Order = {
    id: 'ord-001',
    userId: u1.id,
    amount: 199.0,
    status: '待支付',
    items: [{ name: 'API 测试指南', price: 199.0, quantity: 1 }],
    createdAt: FIXED_NOW.toISOString(),
  };
  orders.set(o1.id, o1);
}
seed();

// ─── Helpers ─────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString()));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function parseBody<T = unknown>(req: IncomingMessage): Promise<T> {
  return readBody(req).then((raw) => (raw ? (JSON.parse(raw) as T) : ({} as T)));
}

function extractToken(req: IncomingMessage): string | null {
  const auth = req.headers['authorization'] ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match?.[1] ?? null;
}

function authUser(req: IncomingMessage): User | null {
  const token = extractToken(req);
  if (!token) return null;
  const userId = tokens.get(token);
  if (!userId) return null;
  return users.get(userId) ?? null;
}

const UUID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// ─── Fault Injection ─────────────────────────────────────────────

function shouldFault(pathname: string): FaultMode | null {
  if (!FAULT_MODE) return null;
  if (FAULT_TARGET && !pathname.startsWith(FAULT_TARGET)) return null;
  return FAULT_MODE;
}

// ─── Router ──────────────────────────────────────────────────────

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;
  const method = req.method ?? 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    });
    res.end();
    return;
  }

  // Fault injection
  const fault = shouldFault(pathname);
  if (fault === 'timeout') {
    return; // never respond
  }
  if (fault === '500') {
    return json(res, 500, { code: 'INTERNAL_ERROR', message: 'Fault injected' });
  }
  if (fault === 'slow') {
    await new Promise((r) => setTimeout(r, 5000));
  }

  // ── OpenAPI spec ──
  if (method === 'GET' && pathname === '/openapi.json') {
    return json(res, 200, generateOpenApiSpec());
  }

  // ── Health ──
  if (method === 'GET' && pathname === '/health') {
    return json(res, 200, { status: 'ok', time: FIXED_NOW.toISOString() });
  }

  // ── Reset (admin) ──
  if (method === 'POST' && pathname === '/__admin/reset') {
    seed();
    return json(res, 200, { reset: true });
  }

  // ── Auth: POST /api/auth/login ──
  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await parseBody<{ email?: string; password?: string }>(req);
    const user = [...users.values()].find(
      (u) => u.email === body.email && u.password === body.password,
    );
    if (!user) {
      return json(res, 401, { code: 'AUTH_FAILED', message: '邮箱或密码错误' });
    }
    // Deterministic token: uses fixed clock + random sequence from LCG (seed 42)
    const token = `tok-${FIXED_NOW.getTime()}-${fixedRandom().toString(36).slice(2)}`;
    tokens.set(token, user.id);
    return json(res, 200, {
      code: 0,
      data: { userId: user.id, accessToken: token, expiresIn: 3600 },
      message: 'success',
    });
  }

  // ── Auth: GET /api/auth/me ──
  if (method === 'GET' && pathname === '/api/auth/me') {
    const user = authUser(req);
    if (!user) return json(res, 401, { code: 'UNAUTHORIZED', message: '未登录' });
    const { password: _, ...safe } = user;
    return json(res, 200, { code: 0, data: safe, message: 'success' });
  }

  // ── Users: POST /api/users ──
  if (method === 'POST' && pathname === '/api/users') {
    const body = await parseBody<{ name?: string; email?: string; password?: string }>(req);
    if (!body.name || !body.email || !body.password) {
      return json(res, 400, {
        code: 'VALIDATION_ERROR',
        message: '缺少必填字段',
        fieldProblems: [
          ...(body.name ? [] : [{ field: 'name', message: 'name 为必填字段' }]),
          ...(body.email ? [] : [{ field: 'email', message: 'email 为必填字段' }]),
          ...(body.password ? [] : [{ field: 'password', message: 'password 为必填字段' }]),
        ],
      });
    }
    if ([...users.values()].some((u) => u.email === body.email)) {
      return json(res, 409, { code: 'DUPLICATE', message: '邮箱已被注册' });
    }
    const user: User = {
      id: `u-${String(users.size + 1).padStart(3, '0')}`,
      name: body.name,
      email: body.email,
      password: body.password,
      createdAt: FIXED_NOW.toISOString(),
    };
    users.set(user.id, user);
    return json(res, 201, {
      code: 0,
      data: { userId: user.id, name: user.name, email: user.email },
      message: 'success',
    });
  }

  // ── Users: GET /api/users/{id} ──
  if (method === 'GET' && pathname.startsWith('/api/users/')) {
    const id = pathname.slice('/api/users/'.length);
    if (!UUID_PATTERN.test(id)) {
      return json(res, 400, { code: 'INVALID_ID', message: '无效的用户 ID' });
    }
    const user = users.get(id);
    if (!user) return json(res, 404, { code: 'NOT_FOUND', message: '用户不存在' });
    const { password: _, ...safe } = user;
    return json(res, 200, { code: 0, data: safe, message: 'success' });
  }

  // ── Orders: POST /api/orders ──
  if (method === 'POST' && pathname === '/api/orders') {
    const user = authUser(req);
    if (!user) return json(res, 401, { code: 'UNAUTHORIZED', message: '未登录' });
    const body = await parseBody<{
      amount?: number;
      items?: Array<{ name: string; price: number; quantity: number }>;
    }>(req);
    if (!body.amount || !body.items?.length) {
      return json(res, 400, {
        code: 'VALIDATION_ERROR',
        message: '缺少必填字段',
        fieldProblems: [
          ...(body.amount ? [] : [{ field: 'amount', message: 'amount 为必填字段' }]),
          ...(body.items?.length ? [] : [{ field: 'items', message: 'items 不能为空' }]),
        ],
      });
    }
    if (body.amount <= 0) {
      return json(res, 422, { code: 'INVALID_AMOUNT', message: '金额必须大于 0' });
    }
    if (body.amount > 99999) {
      return json(res, 422, { code: 'AMOUNT_TOO_LARGE', message: '金额超过最大限制' });
    }
    const order: Order = {
      id: `ord-${String(orders.size + 1).padStart(3, '0')}`,
      userId: user.id,
      amount: body.amount,
      status: '待支付',
      items: body.items,
      createdAt: FIXED_NOW.toISOString(),
    };
    orders.set(order.id, order);
    return json(res, 201, {
      code: 0,
      data: { orderId: order.id, status: order.status, amount: order.amount },
      message: 'success',
    });
  }

  // ── Orders: GET /api/orders/{id} ──
  if (method === 'GET' && pathname.startsWith('/api/orders/')) {
    const id = pathname.slice('/api/orders/'.length);
    if (!UUID_PATTERN.test(id)) {
      return json(res, 400, { code: 'INVALID_ID', message: '无效的订单 ID' });
    }
    const order = orders.get(id);
    if (!order) return json(res, 404, { code: 'NOT_FOUND', message: '订单不存在' });
    return json(res, 200, { code: 0, data: order, message: 'success' });
  }

  // ── Orders: DELETE /api/orders/{id} ──
  if (method === 'DELETE' && pathname.startsWith('/api/orders/')) {
    const user = authUser(req);
    if (!user) return json(res, 401, { code: 'UNAUTHORIZED', message: '未登录' });
    const id = pathname.slice('/api/orders/'.length);
    const order = orders.get(id);
    if (!order) return json(res, 404, { code: 'NOT_FOUND', message: '订单不存在' });
    order.status = '已取消';
    return json(res, 200, {
      code: 0,
      data: { orderId: order.id, status: order.status },
      message: 'success',
    });
  }

  // ── Payments: POST /api/payments ──
  if (method === 'POST' && pathname === '/api/payments') {
    const user = authUser(req);
    if (!user) return json(res, 401, { code: 'UNAUTHORIZED', message: '未登录' });
    const body = await parseBody<{ orderId?: string; amount?: number; method?: string }>(req);
    if (!body.orderId || !body.amount) {
      return json(res, 400, {
        code: 'VALIDATION_ERROR',
        message: '缺少必填字段',
        fieldProblems: [
          ...(body.orderId ? [] : [{ field: 'orderId', message: 'orderId 为必填字段' }]),
          ...(body.amount ? [] : [{ field: 'amount', message: 'amount 为必填字段' }]),
        ],
      });
    }
    const order = orders.get(body.orderId);
    if (!order) {
      return json(res, 404, { code: 'NOT_FOUND', message: '订单不存在' });
    }
    if (order.status === '已支付') {
      return json(res, 409, { code: 'ALREADY_PAID', message: '订单已支付' });
    }
    if (body.amount < order.amount * 0.01) {
      return json(res, 422, { code: 'AMOUNT_TOO_SMALL', message: '支付金额不能低于订单金额的 1%' });
    }
    // Simulate occasional payment failure for testing
    const rand = fixedRandom();
    if (rand < 0.15) {
      return json(res, 400, { code: 'PAYMENT_FAILED', message: '支付处理失败，请重试' });
    }
    const payment: Payment = {
      id: `pay-${String(payments.size + 1).padStart(3, '0')}`,
      orderId: body.orderId,
      amount: body.amount,
      method: body.method ?? 'credit_card',
      status: '成功',
      createdAt: FIXED_NOW.toISOString(),
    };
    payments.set(payment.id, payment);
    order.status = '已支付';
    return json(res, 200, {
      code: 0,
      data: { paymentId: payment.id, orderId: order.id, status: '已支付' },
      message: 'success',
    });
  }

  // ── 404 ──
  json(res, 404, { code: 'NOT_FOUND', message: `未找到 ${method} ${pathname}` });
}

// ─── OpenAPI Spec Generator ─────────────────────────────────────

function generateOpenApiSpec(): unknown {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Hermetic Fixture API',
      version: '1.0.0',
      description:
        'Deterministic REST API for sketch-test integration testing. Supports users, auth, orders, and payments with fixed clock and seed.',
    },
    servers: [{ url: `http://127.0.0.1:${PORT}`, description: 'Fixture Server' }],
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
}

// ─── Start Server ────────────────────────────────────────────────

const server = createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`\n🔬 Hermetic Fixture Server ready at http://127.0.0.1:${PORT}`);
  console.log(`   OpenAPI spec:    http://127.0.0.1:${PORT}/openapi.json`);
  console.log(`   Health check:    http://127.0.0.1:${PORT}/health`);
  console.log(`   Admin reset:     POST http://127.0.0.1:${PORT}/__admin/reset`);
  if (FAULT_MODE) {
    console.log(`   ⚠️  Fault injection: ${FAULT_MODE} on "${FAULT_TARGET || '*'}"`);
  }
  console.log('');
});
