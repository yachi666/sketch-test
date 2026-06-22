# @sketch-test/hermetic-fixture-server

> Deterministic REST API for SketchTest integration testing

## Role

A self-contained HTTP server that provides a deterministic REST API (users, auth, orders, payments) for Runner integration tests and local development. It uses a fixed clock, fixed random seed, and in-memory storage — every test run with the same inputs produces the same outputs.

## Quick start

```bash
pnpm dev:fixture              # Start on default port 3800
FIXTURE_PORT=3801 pnpm dev:fixture   # Custom port

# Fault injection
FAULT_MODE=timeout pnpm dev:fixture                  # All endpoints hang
FAULT_MODE=500 FAULT_TARGET=/api/payments pnpm dev:fixture  # Payments return 500
FAULT_MODE=slow pnpm dev:fixture                     # All endpoints delayed 5s
```

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Health check |
| `GET` | `/openapi.json` | No | OpenAPI 3.1 spec |
| `POST` | `/__admin/reset` | No | Reset all data to seed state |
| `POST` | `/api/auth/login` | No | Login → returns `{userId, accessToken}` |
| `GET` | `/api/auth/me` | Bearer | Get current user profile |
| `POST` | `/api/users` | No | Create user (name, email, password required) |
| `GET` | `/api/users/{id}` | No | Get user by ID |
| `POST` | `/api/orders` | Bearer | Create order (amount, items required, ≤99999) |
| `GET` | `/api/orders/{id}` | No | Get order with items and status |
| `DELETE` | `/api/orders/{id}` | Bearer | Cancel order (status → 已取消) |
| `POST` | `/api/payments` | Bearer | Pay order (orderId, amount required); 15% random failure rate |

## Determinism

- **Fixed clock**: `2026-06-21T10:00:00.000Z` — all timestamps use this value.
- **Fixed random seed**: LCG with seed 42 — `POST /api/payments` has a 15% failure rate derived deterministically from the sequence.
- **In-memory store**: Maps for users, orders, payments, tokens. Reset with `POST /__admin/reset`.

## Seed data

| Entity | ID | Details |
|--------|----|---------|
| User | `u-001` | 测试用户 / test@sketch.dev / test123456 |
| Order | `ord-001` | API 测试指南 ¥199.00 / 待支付 |

## Fault injection

| `FAULT_MODE` | Behavior |
|-------------|----------|
| `timeout` | Never responds (connection hangs) |
| `500` | Returns `{"code":"INTERNAL_ERROR"}` immediately |
| `slow` | 5-second delay before responding |

`FAULT_TARGET` filters which endpoint paths are affected. Example: `FAULT_TARGET=/api/payments` only faults payment endpoints; other endpoints operate normally.

## Business process scenarios

The server supports all 8 business processes defined in [CONTEXT.md](../../../CONTEXT.md):

| BP | Process | Endpoints used |
|----|---------|---------------|
| BP-01 | User registration & auth | `POST /users` → `POST /auth/login` → `GET /auth/me` |
| BP-02 | Create order & pay | `POST /auth/login` → `POST /orders` → `POST /payments` → `GET /orders/{id}` |
| BP-03 | Order lifecycle | `POST /orders` → `GET /orders/{id}` → `DELETE /orders/{id}` |
| BP-04 | User info query | `POST /auth/login` → `GET /users/{id}` |
| BP-05 | Payment status polling | `POST /payments` → `GET /orders/{id}` (poll until 已支付) |
| BP-06 | Duplicate payment protection | `POST /payments` → `POST /payments` (409 ALREADY_PAID) |
| BP-07 | Auth failure | `POST /auth/login` (bad credentials) → 401 |
| BP-08 | Validation failure | `POST /users` (missing fields) → 400 + fieldProblems |

## Design invariants

1. **Deterministic** — same inputs produce same outputs every time. No external dependencies.
2. **Resettable** — `POST /__admin/reset` restores the initial seed state.
3. **Self-documenting** — `GET /openapi.json` returns a valid OpenAPI 3.1 spec describing all endpoints.
4. **Fault injection is opt-in** — no faults unless `FAULT_MODE` is set.
5. **Soft-delete only** — `DELETE /api/orders/{id}` sets status to 已取消; data is never removed.

## Dependencies

- Node.js built-in `http` module only — no framework dependencies.

## When to modify

- **Add a new business process**: Add endpoint handlers, update the seed data, and add the scenario to the BP table above.
- **Change seed data**: The seed user (`u-001` / test@sketch.dev / test123456) is referenced by integration tests — coordinate changes with test expectations.
- **Add a new fault mode**: Add to the `FaultMode` type and `shouldFault()` handler.
- **Change the fixed clock or random seed**: This changes all test expectations — coordinate broadly.
