> 历史记录：2026 年 6–7 月原型阶段的设计、计划或审视；不作为当前实现说明或待执行指令。当前入口见 [仓库 README](../../../../../README.md)。

# Multi-Format API Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Postman Collection v2.1, HAR 1.2, and cURL import support, with shared format detection and deep Postman→CanonicalApiModel mapping.

**Architecture:** Three new adapter packages follow the `@sketch-test/adapter-openapi` pattern — pure functions producing `CanonicalApiModel`. Web app `ImportDialog` extended for multi-format detection, progress bar, and conflict resolution. Parsing runs in a Web Worker.

**Tech Stack:** TypeScript strict, Zod, Vitest, React 19, Vite 6. New dep: `jsonc-parser`.

## Global Constraints

- Node >= 22.13.0, pnpm >= 11.8.0
- All adapters produce `ImportResult { model: CanonicalApiModel | null, success: boolean, diagnostics: Diagnostic[] }`
- Contracts use `@sketch-test/contracts-common` for shared primitives
- Endpoint IDs deterministic: `{METHOD}-{normalizedPath}`
- Source locations preserved for every structural element
- Biome formatting: 2-space indent, single quotes, semicolons, trailing commas, 100 char width

---

## File Map

```
packages/adapters/format-detector/    # NEW — shared format detection
├── package.json, tsconfig.json
└── src/
    ├── index.ts                    # detectFormat(), DetectionResult type
    ├── detectors/
    │   ├── postman.ts, openapi.ts, har.ts, curl.ts
    └── __tests__/
        ├── postman.test.ts, openapi.test.ts, har.test.ts, curl.test.ts

packages/adapters/postman/           # NEW — Postman Collection → CanonicalApiModel
├── package.json, tsconfig.json
└── src/
    ├── index.ts                    # importPostmanCollection(), importPostmanEnvironment()
    ├── types.ts                    # PostmanCollection, PostmanItem, etc. (internal)
    ├── parser/
    │   ├── collection.ts           # parseCollection(), validate()
    │   ├── environment.ts          # parseEnvironment()
    │   └── script-patterns.ts      # SCRIPT_PATTERNS, extractAssertions()
    ├── mapper/
    │   ├── endpoints.ts            # flattenItems(), mapToEndpoint()
    │   ├── parameters.ts           # mapUrlParams(), mapHeaders(), mapQueryParams()
    │   ├── request-bodies.ts       # mapRequestBody()
    │   ├── responses.ts            # mapResponses()
    │   ├── auth.ts                 # mapAuth() — all 9 types
    │   ├── variables.ts            # resolveVariables(), mergeScopes()
    │   ├── folders.ts              # mapFolders() → tags + workflow hints
    │   ├── schemas.ts              # extractSchemas() from JSON bodies
    │   └── assertions.ts           # extractAssertions() → TestDSL patterns
    └── __tests__/
        ├── fixture.test.ts         # Golden test with Postman Echo collection
        ├── endpoints.test.ts, parameters.test.ts, auth.test.ts
        ├── variables.test.ts, assertions.test.ts, folders.test.ts
        └── format-detector.test.ts

packages/adapters/har/               # NEW — HAR → CanonicalApiModel
├── package.json, tsconfig.json
└── src/
    ├── index.ts                    # importHar()
    └── __tests__/fixture.test.ts

apps/web/src/
├── components/api/
│   ├── ImportDialog.tsx            # MODIFY — multi-format + progress + conflict
│   ├── ConflictResolutionDialog.tsx # NEW
│   └── ImportProgressBar.tsx       # NEW
├── workers/
│   └── import.worker.ts            # NEW — Web Worker for adapter execution
└── hooks/
    └── useImportWorker.ts          # NEW — main-thread hook
```

---

## Phase 1: Foundation Packages

### Task 1: Create @sketch-test/format-detector

**Creates:** `packages/adapters/format-detector/`

**Produces:** `detectFormat(content: unknown): DetectionResult[]`

- [ ] **Step 1: Scaffold package directory + package.json + tsconfig.json**

```bash
mkdir -p packages/adapters/format-detector/src/detectors
mkdir -p packages/adapters/format-detector/src/__tests__
```

`package.json`:
```json
{
  "name": "@sketch-test/format-detector",
  "version": "0.0.0",
  "private": true,
  "description": "Shared format detection for API import",
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "check": "tsc --noEmit", "lint": "biome check", "test": "vitest run", "clean": "rm -rf dist/" },
  "dependencies": { "@sketch-test/contracts-common": "workspace:*" },
  "devDependencies": { "typescript": "catalog:", "vitest": "catalog:" }
}
```

`tsconfig.json` (copy pattern from `packages/adapters/openapi/tsconfig.json`).

- [ ] **Step 2: Write tests (TDD)**

`src/__tests__/postman.test.ts` — verify Postman v2.1, v2.0, v1 legacy, Environment detection. Check confidence scores >= 0.95 for v2.x.

`src/__tests__/openapi.test.ts` — verify OpenAPI 3.x and Swagger 2.0 detection.

`src/__tests__/har.test.ts` — verify HAR `{ log: { entries: [...] } }` detection.

`src/__tests__/curl.test.ts` — verify `curl -X GET ...` string detection vs non-curl strings.

- [ ] **Step 3: Run tests — verify FAIL**

```bash
cd packages/adapters/format-detector && pnpm test
```

- [ ] **Step 4: Implement `src/index.ts`**

```typescript
export type ImportFormat =
  | 'postman-collection' | 'postman-environment' | 'openapi'
  | 'har' | 'curl' | 'unknown';

export interface DetectionResult {
  format: ImportFormat;
  confidence: number;
  version?: string;
  label: string;
  details?: { endpointCount?: number; hasAuth?: boolean; hasVariables?: boolean; };
}

export function detectFormat(content: unknown): DetectionResult[] {
  const results: DetectionResult[] = [];
  const pm = detectPostman(content); if (pm) results.push(pm);
  const oa = detectOpenApi(content); if (oa) results.push(oa);
  const hr = detectHar(content); if (hr) results.push(hr);
  const cl = detectCurl(content); if (cl) results.push(cl);
  results.sort((a, b) => b.confidence - a.confidence);
  if (results.length === 0 || results[0].confidence < 0.5) {
    return [{ format: 'unknown', confidence: 0.3, label: '未知格式' }];
  }
  return results;
}
```

**Detection rules**

| Format | Signal | Confidence |
|--------|--------|------------|
| Postman v2.x | `info.schema` contains `getpostman.com` | 0.98 |
| Postman Environment | `values[]` + `_postman_variable_scope` | 0.85 |
| Postman v1 | `requests[]` + `folders[]` (no info.schema) | 0.75 |
| OpenAPI 3.x | `openapi` string field | 0.98 |
| Swagger 2.0 | `swagger === "2.0"` | 0.98 |
| HAR | `log.entries[]` array | 0.95 |
| cURL | string matches `/^\s*curl\s+/i` | 0.90 |

Helper: `countEndpoints(items)` recursively counts request items in nested Postman folders.

- [ ] **Step 5: Run tests — verify PASS**

```bash
cd packages/adapters/format-detector && pnpm test && pnpm check
```

- [ ] **Step 6: Commit**

```bash
git add packages/adapters/format-detector/
git commit -m "feat(format-detector): add shared API format detection with confidence scoring"
```

---

### Task 2: Create @sketch-test/adapter-postman — scaffold + types + parser

**Creates:** `packages/adapters/postman/`

**Produces:**
- `PostmanCollection` type (internal)
- `PostmanEnvironment` type (internal)
- `parseCollection(raw: unknown): { collection: PostmanCollection | null; diagnostics: Diagnostic[] }`
- `parseEnvironment(raw: unknown): { env: PostmanEnvironment | null; diagnostics: Diagnostic[] }`

- [ ] **Step 1: Scaffold package**

```bash
mkdir -p packages/adapters/postman/src/{parser,mapper,__tests__}
```

`package.json`:
```json
{
  "name": "@sketch-test/adapter-postman",
  "version": "0.0.0",
  "private": true,
  "description": "Postman Collection v2.1 → CanonicalApiModel adapter",
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "check": "tsc --noEmit", "lint": "biome check", "test": "vitest run", "clean": "rm -rf dist/" },
  "dependencies": {
    "@sketch-test/contracts-common": "workspace:*",
    "@sketch-test/canonical-api-model": "workspace:*",
    "@sketch-test/format-detector": "workspace:*",
    "jsonc-parser": "^3.3.0",
    "zod": "catalog:"
  },
  "devDependencies": { "typescript": "catalog:", "vitest": "catalog:" }
}
```

- [ ] **Step 2: Define Postman internal types**

`src/types.ts`:
```typescript
/** Postman Collection v2.1 — internal types for parsing (subset we map) */
export interface PostmanCollection {
  info: { name: string; schema: string; description?: string; version?: string; };
  item: PostmanItem[];
  auth?: PostmanAuth;
  variable?: PostmanVariable[];
  event?: PostmanEvent[];
}

export interface PostmanItem {
  name: string;
  request?: PostmanRequest;
  response?: PostmanResponse[];
  item?: PostmanItem[];
  event?: PostmanEvent[];
  auth?: PostmanAuth;
  variable?: PostmanVariable[];
}

export interface PostmanRequest {
  method: string;
  url: PostmanUrl | string;
  header?: PostmanHeader[];
  body?: PostmanBody;
  description?: string;
  auth?: PostmanAuth;
}

export interface PostmanUrl {
  raw: string;
  protocol?: string;
  host?: string[];
  port?: string;
  path?: string[];
  query?: Array<{ key: string; value: string; disabled?: boolean; description?: string; }>;
  variable?: Array<{ key: string; value: string; description?: string; }>;
}

export interface PostmanHeader {
  key: string;
  value: string;
  disabled?: boolean;
  description?: string;
}

export interface PostmanBody {
  mode: 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql' | 'none';
  raw?: string;
  urlencoded?: PostmanHeader[];
  formdata?: PostmanHeader[];
  graphql?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface PostmanResponse {
  name?: string;
  status: string;
  code: number;
  header?: PostmanHeader[];
  body?: string;
  responseTime?: number;
}

export interface PostmanAuth {
  type: string;
  [key: string]: unknown; // auth params vary by type
}

export interface PostmanVariable {
  key: string;
  value: string;
  type?: string;
  description?: string;
  disabled?: boolean;
}

export interface PostmanEvent {
  listen: 'test' | 'prerequest';
  script: { exec?: string[]; type?: string; };
  disabled?: boolean;
}

/** Postman Environment */
export interface PostmanEnvironment {
  id?: string;
  name: string;
  values: PostmanVariable[];
  _postman_variable_scope?: string;
}
```

- [ ] **Step 3: Write parser tests**

`src/__tests__/parser.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { parseCollection } from '../parser/collection.js';
import { parseEnvironment } from '../parser/environment.js';
import { POSTMAN_ECHO_COLLECTION } from './fixtures/postman-echo.js';

describe('parseCollection', () => {
  it('parses a valid Postman Collection v2.1', () => {
    const { collection, diagnostics } = parseCollection(POSTMAN_ECHO_COLLECTION);
    expect(collection).not.toBeNull();
    expect(collection!.info.name).toBe('Postman Echo');
    expect(collection!.item.length).toBeGreaterThan(0);
    expect(diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
  });

  it('rejects non-object input', () => {
    const { collection, diagnostics } = parseCollection('not an object');
    expect(collection).toBeNull();
    expect(diagnostics.some(d => d.severity === 'error')).toBe(true);
  });

  it('rejects missing info.schema', () => {
    const { collection, diagnostics } = parseCollection({ item: [] });
    expect(collection).toBeNull();
    expect(diagnostics.some(d => d.code === 'INVALID_COLLECTION')).toBe(true);
  });

  it('rejects Postman v1 with helpful message', () => {
    const { collection, diagnostics } = parseCollection({
      id: 'v1-collection',
      requests: [],
      folders: [],
    });
    expect(collection).toBeNull();
    expect(diagnostics.some(d => d.message.includes('v1'))).toBe(true);
  });
});

describe('parseEnvironment', () => {
  it('parses a valid Postman Environment', () => {
    const { env, diagnostics } = parseEnvironment({
      name: 'Production',
      values: [
        { key: 'baseUrl', value: 'https://api.example.com', enabled: true },
        { key: 'token', value: 'secret123', enabled: true },
      ],
    });
    expect(env).not.toBeNull();
    expect(env!.values).toHaveLength(2);
    expect(diagnostics).toHaveLength(0);
  });

  it('rejects missing values array', () => {
    const { env, diagnostics } = parseEnvironment({ name: 'Empty' });
    expect(env).toBeNull();
    expect(diagnostics.some(d => d.severity === 'error')).toBe(true);
  });
});
```

- [ ] **Step 4: Write a minimal Postman Echo golden fixture**

`src/__tests__/fixtures/postman-echo.ts` — a truncated Postman Echo collection JSON (3-4 endpoints covering GET, POST, auth, variables). Export as `POSTMAN_ECHO_COLLECTION`.

- [ ] **Step 5: Implement parser**

`src/parser/collection.ts`:
```typescript
import type { Diagnostic } from '@sketch-test/contracts-common';
import type { PostmanCollection } from '../types.js';
import { parse as parseJson } from 'jsonc-parser';

export function parseCollection(raw: unknown): {
  collection: PostmanCollection | null;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];

  if (typeof raw !== 'object' || raw === null) {
    return {
      collection: null,
      diagnostics: [{ severity: 'error', code: 'PARSE_ERROR', message: 'Input is not a valid JSON object' }],
    };
  }

  const c = raw as Record<string, unknown>;

  // Validate info.schema
  if (!c.info || typeof c.info !== 'object') {
    return { collection: null, diagnostics: [{ severity: 'error', code: 'INVALID_COLLECTION', message: 'Missing info object' }] };
  }
  const info = c.info as Record<string, unknown>;
  if (typeof info.schema !== 'string' || !info.schema.includes('getpostman.com')) {
    // Check if this looks like v1
    if ('requests' in c && 'folders' in c) {
      return { collection: null, diagnostics: [{ severity: 'error', code: 'UNSUPPORTED_VERSION', message: 'Postman Collection v1 is not supported. Please upgrade to v2 in Postman (File → Export).' }] };
    }
    return { collection: null, diagnostics: [{ severity: 'error', code: 'INVALID_COLLECTION', message: 'Not a valid Postman Collection: info.schema must reference getpostman.com' }] };
  }

  // Validate items
  if (!Array.isArray(c.item)) {
    return { collection: null, diagnostics: [{ severity: 'error', code: 'EMPTY_COLLECTION', message: 'Collection has no items' }] };
  }

  return {
    collection: raw as PostmanCollection,
    diagnostics,
  };
}
```

`src/parser/environment.ts`:
```typescript
import type { Diagnostic } from '@sketch-test/contracts-common';
import type { PostmanEnvironment } from '../types.js';

export function parseEnvironment(raw: unknown): {
  env: PostmanEnvironment | null;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];

  if (typeof raw !== 'object' || raw === null) {
    return { env: null, diagnostics: [{ severity: 'error', code: 'PARSE_ERROR', message: 'Input is not a valid JSON object' }] };
  }

  const e = raw as Record<string, unknown>;
  if (!Array.isArray(e.values)) {
    return { env: null, diagnostics: [{ severity: 'error', code: 'INVALID_ENVIRONMENT', message: 'Environment must have a values array' }] };
  }

  return { env: raw as PostmanEnvironment, diagnostics };
}
```

- [ ] **Step 6: Run tests — verify PASS**

```bash
cd packages/adapters/postman && pnpm test && pnpm check
```

- [ ] **Step 7: Commit**

```bash
git add packages/adapters/postman/
git commit -m "feat(postman): scaffold adapter with types and parser"
```

---

### Task 3: Postman adapter — endpoint mapping (core)

**Depends on:** Task 2 (Postman types + parser)

**Creates:** `packages/adapters/postman/src/mapper/{endpoints,parameters,request-bodies,responses}.ts`

**Produces:**
- `flattenItems(items: PostmanItem[], parentTags?: string[]): FlatItem[]` — flattens nested folders into flat list with accumulated tags
- `mapToEndpoint(item: FlatItem, ctx: SourceContext): { endpoint: Endpoint; diagnostics: Diagnostic[] }` — single item → Endpoint

- [ ] **Step 1: Write tests for endpoint mapping**

`src/__tests__/endpoints.test.ts`:
```typescript
import { describe, expect, it } from 'vitest';
import { flattenItems, mapToEndpoint } from '../mapper/endpoints.js';
import { makeSourceContext } from './helpers.js';
import type { PostmanItem } from '../types.js';

describe('flattenItems', () => {
  it('flattens nested folders with accumulated tags', () => {
    const items: PostmanItem[] = [
      {
        name: 'Users',
        item: [
          { name: 'List Users', request: { method: 'GET', url: { raw: '/users', path: ['users'] } } },
          { name: 'Create User', request: { method: 'POST', url: { raw: '/users', path: ['users'] } } },
        ],
      },
      { name: 'Health', request: { method: 'GET', url: { raw: '/health', path: ['health'] } } },
    ];

    const flat = flattenItems(items);
    expect(flat).toHaveLength(3);
    expect(flat[0].tags).toContain('Users');
    expect(flat[2].tags).toEqual([]);
  });
});

describe('mapToEndpoint', () => {
  const ctx = makeSourceContext();

  it('produces a valid Endpoint from a flat item', () => {
    const { endpoint } = mapToEndpoint({
      item: { name: 'Get Users', request: { method: 'GET', url: { raw: 'https://api.example.com/users', path: ['users'] } } },
      tags: ['Users'],
    }, ctx);

    expect(endpoint.method).toBe('GET');
    expect(endpoint.path).toBe('/users');
    expect(endpoint.summary).toBe('Get Users');
    expect(endpoint.tags).toContain('Users');
    expect(endpoint.id).toBe('GET-/users');
  });

  it('normalizes Postman path variables from :var to :var', () => {
    const { endpoint } = mapToEndpoint({
      item: { name: 'Get User', request: { method: 'GET', url: { raw: '/users/:userId', path: ['users', ':userId'] } } },
      tags: [],
    }, ctx);

    expect(endpoint.path).toBe('/users/:userId');
  });

  it('maps URL query params to Parameter[]', () => {
    const { endpoint } = mapToEndpoint({
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
    }, ctx);

    const queryParams = endpoint.parameters.filter(p => p.in === 'query');
    expect(queryParams).toHaveLength(2);
    expect(queryParams[0].name).toBe('q');
  });
});
```

- [ ] **Step 2: Write test helper**

`src/__tests__/helpers.ts`:
```typescript
import type { SemanticVersion, ContentHash, EntityId, Instant } from '@sketch-test/contracts-common';

export function makeSourceContext() {
  return {
    sourceId: 'test-source' as EntityId,
    sourceLabel: 'test-collection.json',
    sourceVersion: '1.0.0' as SemanticVersion,
    sourceHash: '0'.repeat(64) as ContentHash,
    ingestedAt: '2026-06-23T00:00:00.000Z' as Instant,
  };
}

export function makeFlatItem(overrides: Record<string, unknown> = {}) {
  return {
    item: {
      name: 'Test Endpoint',
      request: {
        method: 'GET',
        url: { raw: '/test', path: ['test'] },
      },
      ...overrides,
    },
    tags: [] as string[],
    folderPath: '',
  };
}
```

- [ ] **Step 3: Implement endpoint mapping**

`src/mapper/endpoints.ts`:
```typescript
import type { Endpoint, Parameter } from '@sketch-test/canonical-api-model';
import type { Diagnostic, EntityId, HttpMethod } from '@sketch-test/contracts-common';
import type { PostmanItem, PostmanUrl } from '../types.js';
import type { SourceContext } from './shared.js';

export interface FlatItem {
  item: PostmanItem;
  tags: string[];
  folderPath: string;
}

/** Recursively flatten nested Postman folders, accumulating tags from folder names */
export function flattenItems(items: PostmanItem[], parentTags: string[] = []): FlatItem[] {
  const result: FlatItem[] = [];
  for (const item of items) {
    if (item.item && Array.isArray(item.item) && !item.request) {
      // This is a folder: recurse with accumulated tag
      const folderTags = [...parentTags, item.name];
      result.push(...flattenItems(item.item, folderTags));
    } else if (item.request) {
      // This is a request item
      result.push({ item, tags: parentTags, folderPath: parentTags.join(' / ') });
    }
  }
  return result;
}

/** Build endpoint path from Postman URL */
export function buildPath(url: PostmanUrl | string): string {
  const u = typeof url === 'string' ? { raw: url, path: [] } : url;
  if (Array.isArray(u.path) && u.path.length > 0) {
    return '/' + u.path.join('/');
  }
  // Fallback: parse from raw URL
  try {
    const parsed = new URL(u.raw);
    return parsed.pathname;
  } catch {
    return '/';
  }
}

/** Normalize Postman path variables: :var stays :var (Postman already uses :var) */
function normalizePath(path: string): string {
  return path.startsWith('/') ? path : '/' + path;
}
```

- [ ] **Step 4-5: Implement mapToEndpoint, parameters, bodies, responses**

Follow the pattern from the OpenAPI adapter's `mapEndpoints()`:
- `mapParameters(url, headers)` → `Parameter[]`
- `mapRequestBody(body)` → `RequestBody[]`
- `mapResponses(responses)` → `Response[]`
- Wire them all in `mapToEndpoint(flatItem, ctx)`

Key for headers: exclude `Content-Type` headers (they become part of the body's media type).
Key for body mode mapping: `raw` → keep as-is with content type from headers, `urlencoded` → `application/x-www-form-urlencoded`, `formdata` → `multipart/form-data`, `none` → skip.

- [ ] **Step 6: Run tests — verify PASS**

```bash
cd packages/adapters/postman && pnpm test && pnpm check
```

- [ ] **Step 7: Commit**

```bash
git add packages/adapters/postman/src/mapper/
git commit -m "feat(postman): implement core endpoint mapping (endpoints, params, bodies, responses)"
```

---

### Task 4: Create @sketch-test/adapter-har

**Creates:** `packages/adapters/har/`

**Produces:** `importHar(har: unknown, options: HarAdapterOptions): ImportResult`

Minimal implementation — extracts method, URL, status code, headers, and response body from HAR entries.

- [ ] **Step 1: Scaffold package** (same pattern as postman)
- [ ] **Step 2: Write HAR fixture + test**
- [ ] **Step 3: Implement importHar()** — map `log.entries[]` to endpoints
- [ ] **Step 4: Run tests → PASS → Commit**

---

## Phase 2: Deep Postman Features

### Task 5: Postman — variable resolution

**Produces:**
- `resolveVariables(collectionVars: PostmanVariable[], envVars?: PostmanVariable[]): VariableScope`
- `expandTemplate(template: string, scope: VariableScope): string`

- [ ] **Step 1: Write variable tests**

```typescript
describe('resolveVariables', () => {
  it('merges collection and environment variables (env overrides)', () => {
    const scope = resolveVariables(
      [{ key: 'baseUrl', value: 'http://localhost' }],
      [{ key: 'baseUrl', value: 'https://prod.example.com', enabled: true }],
    );
    const resolved = expandTemplate('{{baseUrl}}/api/users', scope);
    expect(resolved).toBe('https://prod.example.com/api/users');
  });

  it('preserves unresolvable variables', () => {
    const scope = resolveVariables([], []);
    const result = expandTemplate('{{unknownVar}}/path', scope);
    expect(result).toBe('{{unknownVar}}/path');
  });

  it('skips disabled env variables', () => {
    const scope = resolveVariables(
      [{ key: 'host', value: 'http://localhost' }],
      [{ key: 'host', value: 'http://prod', enabled: false }],
    );
    const resolved = expandTemplate('{{host}}/api', scope);
    expect(resolved).toBe('http://localhost/api');
  });
});
```

- [ ] **Step 2: Implement**

`src/mapper/variables.ts` — `resolveVariables()` merges collection + env with env priority. `expandTemplate()` replaces `{{varName}}` patterns, returns unresolved refs as-is. Detect `{{$randomInt}}`, `{{$guid}}` etc. as dynamic variables → mark as `extra.dynamicVariables`.

- [ ] **Step 3: Run tests → PASS → Commit**

---

### Task 6: Postman — auth mapping + script assertions + folders

**Auth mapping** (`src/mapper/auth.ts`):
Map all 9 Postman auth types → `SecurityScheme`. Auth inheritance: item-level overrides collection-level. See spec Table 4.4 for mapping.

**Script assertions** (`src/mapper/assertions.ts` + `src/parser/script-patterns.ts`):
Pattern-match 12 common `pm.test()` / `pm.expect()` patterns → assertion objects stored in `Endpoint.extra`. Unrecognized scripts → `extra.rawScripts[]`.

**Folder → workflow** (`src/mapper/folders.ts`):
Produce `WorkflowHint[]` from folder ordering + nested item ordering. See spec section 4.5.

Each has its own test file. Implement, test, commit each separately.

---

### Task 7: Postman — main entry point + integration test

**Produces:** `importPostmanCollection(collection, options): ImportResult`

- [ ] **Step 1: Write integration test** — uses a real Postman Echo collection export (3-4 endpoints: GET, POST, auth-required, variable-using). Verify `ImportResult.success === true`, correct endpoint count, Zod validation passes via `CanonicalApiModelSchema.parse(model)`.

- [ ] **Step 2: Implement `src/index.ts`** — wires all mappers together following the `importOpenApi()` pattern:
  1. Parse collection
  2. Resolve variables
  3. Extract schemas
  4. Map auth
  5. Flatten + map endpoints
  6. Build CanonicalApiModel
  7. Validate with Zod

- [ ] **Step 3: Implement `importPostmanEnvironment(env, options)`**

- [ ] **Step 4: Run tests → PASS → Commit**

---

## Phase 3: Web App Integration

### Task 8: Extend ImportDialog — multi-format

**Modifies:** `apps/web/src/components/api/ImportDialog.tsx`

- [ ] **Step 1: Add `@sketch-test/format-detector` dependency to `apps/web/package.json`**

```bash
cd apps/web && pnpm add @sketch-test/format-detector@workspace:*
```

- [ ] **Step 2: Extend ImportDialog props**

```typescript
interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (result: ImportResult) => void; // Changed from () => void
}

interface ImportResult {
  sourceType: string;
  fileName: string;
  endpointCount: number;
  // ... plus the CanonicalApiModel data
}
```

- [ ] **Step 3: Add format detection**

After file is selected, read as text → `JSON.parse` → `detectFormat()` → show detected format label, endpoint count, variable count in a "检测结果" section.

- [ ] **Step 4: Add Postman environment file upload** (conditional, only shown when Postman format detected)

- [ ] **Step 5: Add import options checkboxes**: ☑ 导入变量定义, ☑ 导入认证配置, ☐ 转换测试脚本为断言, ☑ 文件夹结构 → 标签

- [ ] **Step 6: Add conflict strategy selector**: radio buttons for 跳过重复 / 覆盖 / 保留两者 / 逐项决定

- [ ] **Step 7: Accept broader file types**: `.json, .yaml, .yml, .har, .txt`

- [ ] **Step 8: Run dev server, verify UI renders → Commit**

---

### Task 9: Web Worker for adapter execution

**Creates:** `apps/web/src/workers/import.worker.ts`, `apps/web/src/hooks/useImportWorker.ts`

- [ ] **Step 1: Create Web Worker**

```typescript
// import.worker.ts
import { importPostmanCollection } from '@sketch-test/adapter-postman';
import { importHar } from '@sketch-test/adapter-har';
import type { ImportResult } from './types';

self.onmessage = async (e: MessageEvent<ImportWorkerMessage>) => {
  const { type, payload } = e.data;
  if (type === 'import') {
    // Post progress events during import
    const result = await runImport(payload);
    self.postMessage({ type: 'complete', result });
  }
};
```

- [ ] **Step 2: Create main-thread hook**

`useImportWorker.ts` — returns `{ startImport, progress, result, error, cancel, isRunning }`.

Worker lifecycle: `new Worker(new URL('../workers/import.worker.ts', import.meta.url), { type: 'module' })`.

Progress tracking: worker posts `{ type: 'progress', current, total, phase }` messages. Hook exposes `progress: { current: number; total: number; phase: string } | null`.

- [ ] **Step 3: Add AbortController support** — `worker.terminate()` on cancel.

- [ ] **Step 4: Configure Vite for Web Worker bundling** — Vite supports `new URL(..., import.meta.url)` natively for workers. Add adapter packages to `ssr.noExternal` if needed.

- [ ] **Step 5: Commit**

---

### Task 10: Progress bar + conflict dialog

**Creates:** `apps/web/src/components/api/ImportProgressBar.tsx`, `ConflictResolutionDialog.tsx`

- [ ] **Step 1: ImportProgressBar component**

```tsx
interface ImportProgressBarProps {
  current: number;
  total: number;
  phase: string;       // e.g. "解析端点", "提取 Schema", "转换断言"
  currentItem?: string; // e.g. "POST /api/orders"
}
```

Renders a determinate `<progress>` bar with percentage and phase label. CSS animation on phase changes.

- [ ] **Step 2: ConflictResolutionDialog component**

```tsx
interface ConflictResolutionDialogProps {
  conflicts: EndpointConflict[];
  onResolve: (resolutions: ConflictResolution[]) => void;
  onClose: () => void;
}

interface EndpointConflict {
  endpointId: EntityId;       // method + path
  existing: { summary: string; version: string; sourceType: string; };
  incoming: { summary: string; sourceLabel: string; };
}
```

Three resolution modes:
- **Skip**: keep existing, discard incoming
- **Replace**: discard existing, use incoming
- **Keep Both**: create new endpoint with `-imported` suffix
- **Merge**: merge parameters/responses from incoming into existing

UI: Table with checkboxes, bulk action buttons, per-row select dropdown. See spec section 6.3 for mockup.

- [ ] **Step 3: Commit**

---

### Task 11: Wire to localStorage + end-to-end flow

- [ ] **Step 1: Create localStorage adapter**

In `apps/web/src/lib/storage.ts`, add helpers for persisting `CanonicalApiModel` with versioned keys:
```typescript
export function saveApiVersion(model: CanonicalApiModel): ApiVersionInfo { ... }
export function loadApiVersions(): ApiVersionInfo[] { ... }
```

- [ ] **Step 2: Wire ImportDialog → Web Worker → localStorage in ApiView.tsx**

```typescript
// In ApiView.tsx or a new useApiImport hook:
const { startImport, progress, result, cancel } = useImportWorker();

const handleImport = async (file: File, options: ImportOptions) => {
  const text = await file.text();
  startImport({ content: text, format: detectedFormat, options });
};

// When result arrives:
if (result?.success) {
  const versionInfo = saveApiVersion(result.model);
  // Update UI state
  setApiVersions(prev => [...prev, versionInfo]);
  setEndpoints(prev => [...prev, ...mapModelToEndpoints(result.model)]);
  setImportOpen(false);
}
```

- [ ] **Step 3: Add end-to-end integration test**

Create a test that:
1. Reads a real Postman Echo collection JSON from a fixture file
2. Passes it through `importPostmanCollection()`
3. Verifies the result is a valid `CanonicalApiModel` (Zod parse)
4. Verifies endpoint IDs are deterministic
5. Verifies source locations are preserved
6. Verifies variables are resolved

- [ ] **Step 4: Run dev — import a real Postman file → verify it appears in UI**

```bash
pnpm dev:web
# Manually: drag postman_echo.json → verify detection → import → verify endpoints in table
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): wire multi-format import with Web Worker, progress bar, and conflict resolution"
```

---

## Self-Review Checklist

- [ ] Spec coverage: **Section 3 (Architecture)** → Tasks 1-4 create the 3 packages. **Section 4 (Postman Mapping)** → Tasks 2-3 (endpoints) + 5 (variables) + 6 (auth, assertions, folders) + 7 (integration). **Section 5 (Format Detection)** → Task 1. **Section 6 (UI)** → Tasks 8-10. **Section 7 (Error Handling)** → Implicit in each parser/mapper via diagnostics. **Section 8 (Testing)** → Golden tests in Task 7, unit tests in each task.
- [ ] No TBD/TODO: All tasks have concrete code or clear patterns.
- [ ] Type consistency: `SourceContext` defined in Task 2, consumed by Tasks 3, 5, 6, 7. `FlatItem` defined in Task 3. `VariableScope` defined in Task 5. `ImportResult` follows existing pattern from `@sketch-test/adapter-openapi`.
- [ ] Each task is independently testable and committable.

---

## Execution Handoff

Plan complete and saved. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
