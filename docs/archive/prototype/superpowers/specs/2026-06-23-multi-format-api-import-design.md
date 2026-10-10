> 历史记录：2026 年 6–7 月原型阶段的设计、计划或审视；不作为当前实现说明或待执行指令。当前入口见 [仓库 README](../../../../../README.md)。

# Multi-Format API Import — Design Spec

**Date**: 2026-06-23
**Status**: Design approved, pending implementation plan
**Context**: M0 feasibility milestone

## 1. Problem Statement

SketchTest currently only supports OpenAPI 3.x import via `packages/adapters/openapi/`. Users need to import API definitions from Postman, Insomnia, Hoppscotch, Thunder Client, HAR (HTTP Archive), and cURL.

**Key insight**: Insomnia, Hoppscotch, and Thunder Client all support exporting to Postman Collection v2.1. By supporting Postman Collection v2.1 deeply, we cover the entire ecosystem through one format, with HAR and cURL as lightweight supplements.

## 2. Scope & Depth

| Format | Detection Confidence | Depth | Rationale |
|--------|---------------------|-------|-----------|
| **Postman Collection v2.1** | 0.98 (schema URL) | **Deep (C)** | Ecosystem cornerstone. Extract endpoints, variables, auth, folder→workflow, test scripts→assertions |
| Postman Environment | 0.85 (values array) | **Deep (C)** | Merged with collection variables for resolution |
| OpenAPI 3.x | 0.98 | Existing | Already supported via `@sketch-test/adapter-openapi` |
| **HAR 1.2** | 0.95 (log.entries) | **Standard (B)** | Extract endpoints + responses from browser/proxy captures |
| **cURL** | Text regex | **Minimal (A)** | Quick paste-to-import. Parse method, URL, headers, body |
| Insomnia native | N/A | **Deferred** | Users export to Postman format from Insomnia |

### Depth Levels Defined

- **A (Minimal)**: method, path, headers, request body, response example
- **B (Standard)**: A + variable extraction, auth mapping, tags
- **C (Deep)**: B + script→assertion conversion, folder→workflow conversion, variable resolution

## 3. Architecture

### 3.1 High-Level Flow

```
ImportDialog (multi-format, with format detection, preview, conflict handling)
    │
    ▼
FormatDetector (confidence-scored waterfall)
    │
    ├── Postman v2.x → PostmanCollectionAdapter ─┐
    ├── OpenAPI 3.x  → OpenApiAdapter (existing)  │
    ├── HAR 1.2      → HarAdapter                 ├──→ CanonicalApiModel
    └── cURL         → CurlParser                  │
                                                   │
                                    ┌──────────────┘
                                    ▼
                              localStorage (M0)
                              → Control Plane REST API (future)
```

### 3.2 Package Structure

```
packages/adapters/
├── openapi/              # Existing — no changes in this feature
├── postman/              # NEW: Postman Collection v2.1 → CanonicalApiModel
│   ├── src/
│   │   ├── index.ts              # importPostmanCollection(), importPostmanEnvironment()
│   │   ├── format-detector.ts    # Detects Postman v2.x vs v1 vs Environment
│   │   ├── parser/
│   │   │   ├── collection.ts     # Parse + validate Postman Collection JSON
│   │   │   ├── environment.ts    # Parse + validate Postman Environment JSON
│   │   │   └── script-patterns.ts # Pattern matchers for common test scripts
│   │   ├── mapper/
│   │   │   ├── endpoints.ts      # request items → Endpoint[]
│   │   │   ├── schemas.ts        # JSON Schema extraction → ApiSchemaNode[]
│   │   │   ├── auth.ts           # Postman auth → SecurityScheme[] + SecurityRequirement[]
│   │   │   ├── variables.ts      # Collection/Env vars → VariableResolution + Parameter[]
│   │   │   ├── folders.ts        # Nested folder structure → tags[] + WorkflowStep hints
│   │   │   └── assertions.ts     # pm.test() scripts → TestDSL assertion patterns
│   │   └── __tests__/
│   │       ├── fixture.test.ts       # Integration test with real Postman Echo collection
│   │       ├── auth.test.ts
│   │       ├── variables.test.ts
│   │       ├── assertions.test.ts
│   │       └── format-detector.test.ts
│   └── package.json
├── format-detector/       # NEW: Shared format detection
│   ├── src/
│   │   ├── index.ts               # detectFormat(content: string): DetectionResult[]
│   │   ├── detectors/
│   │   │   ├── postman.ts
│   │   │   ├── openapi.ts
│   │   │   ├── har.ts
│   │   │   └── curl.ts
│   │   └── __tests__/
│   └── package.json
└── har/                   # NEW: HAR 1.2 → CanonicalApiModel
    ├── src/
    │   ├── index.ts               # importHar()
    │   ├── format-detector.ts
    │   └── __tests__/
    └── package.json
```

### 3.3 Runtime Architecture

**M0 (current)**: All parsing runs in the browser via Web Worker.
- `ImportDialog` reads file → posts to Web Worker
- Web Worker imports adapter packages (pure functions, no Node deps)
- Worker posts progress events → UI renders progress bar
- Result stored to localStorage via main thread

**Future**: Control Plane import API.
- Same adapter packages, but called server-side
- `POST /api/v1/import` → Control Plane → adapter → DB persistence
- UI stays identical (just calls API instead of localStorage)

## 4. Postman → CanonicalApiModel Mapping (Deep)

### 4.1 Endpoint Mapping

| Postman Field | CanonicalApiModel Field | Notes |
|---------------|------------------------|-------|
| `item[].request.method` | `Endpoint.method` | Direct map |
| `item[].request.url.path[]` | `Endpoint.path` | Reconstruct as `/path/:param` |
| `item[].request.url.variable[]` | `Endpoint.parameters[]` (in: path) | Path variables → `:param` style |
| `item[].request.url.query[]` | `Endpoint.parameters[]` (in: query) | Direct map |
| `item[].request.header[]` | `Endpoint.parameters[]` (in: header) | Exclude Content-Type (goes to body) |
| `item[].request.body` | `Endpoint.requestBodies[]` | mode → content-type |
| `item[].request.description` | `Endpoint.description` | Markdown preserved |
| `item[].name` | `Endpoint.summary` | |
| `item[].event[].listen === 'test'` | TestDSL assertions | Pattern-match common assertions |
| `item[].event[].listen === 'prerequest'` | VariableExtraction rules | Pattern-match variable sets |

### 4.2 URL Parsing

Postman stores URLs as structured objects, not plain strings:

```json
{
  "raw": "https://api.example.com/v1/users/{{userId}}?page=1&limit=10",
  "protocol": "https",
  "host": ["api", "example", "com"],
  "port": "",
  "path": ["v1", "users", "{{userId}}"],
  "query": [
    {"key": "page", "value": "1", "disabled": false},
    {"key": "limit", "value": "10", "disabled": false}
  ],
  "variable": [
    {"key": "userId", "value": "{{userId}}", "description": "User identifier"}
  ]
}
```

**Parsing rules**:
1. `path[]` → endpoint path: `/v1/users/:userId`
2. `variable[]` entries where path segment contains `{{var}}` → Path Parameter
3. `query[]` entries where `disabled !== true` → Query Parameter
4. `variable[]` entries NOT in path segments → collection-level variable references

### 4.3 Variable Resolution

Collection variables (`collection.variable[]`) + Environment variables (`environment.values[]`) form a merged `VariableScope`:

```
Priority (high to low):
  1. Environment values (override)
  2. Collection variable initial values
  3. Collection variable defaults
```

**Resolution behavior**:
- `{{baseUrl}}` → resolved to known value → set as `server.url`
- `{{token}}` where value unknown → kept as `{{token}}` reference
- Resolved variables become `example` values on parameters

### 4.4 Auth Mapping

Postman auth types → CanonicalApiModel security schemes:

| Postman Auth Type | CanonicalApiModel | Mapping Notes |
|-------------------|-------------------|---------------|
| `noauth` | (none) | Skip |
| `apikey` | `apiKey` scheme | Map `in` → header/query, `key` → name |
| `basic` | `http` (basic) | Username + password from auth params |
| `bearer` | `http` (bearer) | Token from auth param |
| `digest` | `http` (digest) | |
| `oauth1` | `oauth1` | Consumer key/secret, token, signature method |
| `oauth2` | `oauth2` | Grant type, scopes, token URL |
| `awsv4` | `apiKey` + extra metadata | accessKey → key name, secretKey in extra |
| `hawk` | `http` (hawk) | |
| `ntlm` | `http` (ntlm) | |

Auth inheritance: item-level auth overrides collection-level auth.

### 4.5 Folder → Tags + Workflow Hints

Postman folders (`item` with nested `item[]`) are flattened:

```
Collection
├── Users                              → tag: "Users"
│   ├── GET List Users                 → Endpoint (tags: ["Users"])
│   ├── POST Create User               → Endpoint (tags: ["Users"])
│   └── Users / Profile                → tag: "Users / Profile"
│       ├── GET Get Profile            → Endpoint (tags: ["Users", "Users / Profile"])
│       └── PUT Update Profile         → Endpoint (tags: ["Users", "Users / Profile"])
└── Orders                             → tag: "Orders"
    ├── GET List Orders                → Endpoint (tags: ["Orders"])
    └── POST Create Order              → Endpoint (tags: ["Orders"])
```

**Workflow hints**: Folder ordering + item ordering → `WorkflowStep[]` hints in `extra`:
```json
{
  "workflowHints": [
    {"name": "Users CRUD", "steps": [
      "POST-/v1/users",
      "GET-/v1/users",
      "GET-/v1/users/:userId",
      "PUT-/v1/users/:userId"
    ]}
  ]
}
```

### 4.6 Test Script → Assertion Pattern Matching

Pattern-matching approach (not full JS parser). Recognized patterns:

| Postman Pattern | TestDSL Assertion |
|-----------------|-------------------|
| `pm.response.to.have.status(N)` | `statusAssertion: { equals: N }` |
| `pm.response.to.have.status(200)` | → `statusAssertion: { equals: 200 }` |
| `pm.expect(pm.response.code).to.be.oneOf([...])` | `statusAssertion: { oneOf: [...] }` |
| `pm.response.to.have.header("X", "Y")` | `headerAssertion: { name: "X", value: "Y" }` |
| `pm.expect(pm.response.responseTime).to.be.below(N)` | `latencyAssertion: { max: N }` |
| `pm.response.to.have.jsonBody("key")` (simplified) | `bodyAssertion: { jsonPath: "$.key", exists: true }` |
| `pm.expect(jsonData.key).to.eql("value")` | `bodyAssertion: { jsonPath: "$.key", equals: "value" }` |
| `pm.expect(jsonData).to.have.property("key")` | `bodyAssertion: { jsonPath: "$.key", exists: true }` |
| `pm.response.to.have.body("text")` | `bodyAssertion: { contains: "text" }` |
| `pm.response.to.be.json` | `contentTypeAssertion: { isJson: true }` |
| `pm.response.to.be.ok` | `statusAssertion: { range: "2xx" }` |
| `pm.response.to.be.accepted` | `statusAssertion: { equals: 202 }` |
| `pm.response.to.be.clientError` | `statusAssertion: { range: "4xx" }` |

**Unrecognized scripts**: Preserved in `Endpoint.extra.rawScripts[]` for manual review.

## 5. Format Detection (Shared)

### 5.1 Detection Waterfall

```typescript
interface DetectionResult {
  format: 'postman-collection' | 'postman-environment' | 'openapi' | 'har' | 'curl' | 'unknown';
  confidence: number;     // 0-1
  version?: string;       // e.g. "2.1.0", "3.0.3"
  label: string;          // Human-readable, e.g. "Postman Collection v2.1"
  details?: {
    endpointCount?: number;
    hasAuth?: boolean;
    hasVariables?: boolean;
  };
}

function detectFormat(content: unknown): DetectionResult[]
```

Detection waterfall — returns **all** matches sorted by confidence (highest first). The UI auto-selects the top result and lets the user override if multiple formats match.

1. **OpenAPI 3.x**: `content.openapi` is string → confidence 0.98
2. **Swagger 2.0**: `content.swagger === "2.0"` → confidence 0.98
3. **Postman v2.x**: `content.info?.schema` contains `getpostman.com` → confidence 0.98
4. **HAR**: `content.log?.entries` is array → confidence 0.95
5. **cURL**: string content matching `/^\s*curl\s+/i` → confidence 0.90
6. **Postman Environment**: `content.values` array + `_postman_variable_scope` → confidence 0.85
7. **Postman v1**: `content.requests` + `content.folders` array → confidence 0.75
8. **Unknown**: file extension fallback (confidence 0.30)

All detectors run independently. Results are sorted by confidence descending. The UI displays the top result as detected format, with a dropdown for manual override showing all matches above confidence 0.50.

### 5.2 Encoding Handling

```typescript
function robustParse(raw: string): unknown {
  // 1. Strip BOM
  let clean = raw.replace(/^﻿/, '');
  // 2. Try JSON.parse with jsonc (tolerates comments, trailing commas)
  // 3. If fails, try JSON.parse (strict) for better error messages
  // 4. If both fail, return null with diagnostic
}
```

## 6. UI Design

### 6.1 ImportDialog Extension

```
┌─────────────────────────────────────────────────┐
│  导入 API 文档                    [X]            │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────────────────────────────────┐        │
│  │       拖拽文件到此处                   │        │
│  │       或点击选择文件                   │        │
│  │                                       │        │
│  │  支持: Postman, OpenAPI, HAR, cURL    │        │
│  │  格式: .json, .yaml, .yml, .har, .txt│        │
│  └─────────────────────────────────────┘        │
│                                                 │
│  ── 或者 ──                                     │
│                                                 │
│  远程导入: [https://...              ]          │
│                                                 │
│  ── 可选 ──                                     │
│                                                 │
│  Postman 环境文件: [选择文件]  (仅 Postman 格式)  │
│                                                 │
│  ─── 检测结果 ───────────────────              │
│  格式: Postman Collection v2.1   ✓              │
│  端点: 23 个请求，4 个文件夹                     │
│  变量: 5 个 collection 变量                     │
│  认证: Bearer Token                             │
│                                                 │
│  ─── 导入选项 ───────────────────              │
│  ☑ 导入变量定义                                 │
│  ☑ 导入认证配置                                 │
│  ☐ 转换测试脚本为断言                            │
│  ☑ 文件夹结构 → 标签                            │
│                                                 │
│  冲突策略（如果已有端点）:                        │
│  ○ 跳过重复  ● 覆盖  ○ 保留两者  ○ 让我逐项决定  │
│                                                 │
│              [取消]    [预览端点]    [开始导入]   │
└─────────────────────────────────────────────────┘
```

### 6.2 Progress Indicator

**Competitive differentiator**: No major API tool shows deterministic progress during import.

```
导入中...
████████████████████░░░░░░░░  78%  (18/23 端点)

当前: POST /api/orders
```

Implementation: `stream-json` style parsing in Web Worker → `postMessage({type: 'progress', current: 18, total: 23})` → main thread renders.

### 6.3 Conflict Resolution Dialog

Triggered when imported endpoints match existing ones by `{method, path}`:

```
┌─────────────────────────────────────────────────┐
│  检测到 3 个端点冲突                             │
├─────────────────────────────────────────────────┤
│                                                 │
│  批量操作: [跳过所有] [覆盖所有] [逐个决定]      │
│                                                 │
│  ☑ POST /api/users       现有: v1  | 导入: v2  │
│    现有: summary="创建用户"                      │
│    导入: summary="Create User"                   │
│    [跳过] [覆盖] [保留两者] [合并]              │
│                                                 │
│  ☑ GET /api/users/:id     现有: v1  | 导入: v2 │
│    ...同上...                                   │
│                                                 │
│  ☑ DELETE /api/users/:id   现有: v1  | 导入: v2│
│    ...同上...                                   │
│                                                 │
│                        [取消]    [应用选择]      │
└─────────────────────────────────────────────────┘
```

## 7. Error Handling & Diagnostics

All adapters produce `ImportResult { model: CanonicalApiModel | null, success: boolean, diagnostics: Diagnostic[] }`.

**Diagnostic severity levels**:
- `error`: Cannot produce valid model (e.g., invalid JSON, missing required fields)
- `warning`: Model produced but with degradation (e.g., unsupported auth type, unrecognized script)
- `info`: Non-actionable observations (e.g., "5 scripts could not be converted to assertions")

**Common errors**:
| Error | Cause | Mitigation |
|-------|-------|------------|
| `PARSE_ERROR` | Invalid JSON, BOM, encoding | `robustParse()` with BOM stripping |
| `UNSUPPORTED_VERSION` | Postman v1, Swagger 2.0 | Clear error message, suggest conversion tool |
| `EMPTY_COLLECTION` | No items in collection | Warning, produce empty model |
| `VARIABLE_RESOLUTION_FAILED` | Circular refs, missing env | Warning, preserve `{{var}}` as-is |
| `AUTH_UNSUPPORTED` | Unknown auth type | Warning, skip auth, log type |
| `SCRIPT_PARSE_FAILED` | Complex script logic | Info, preserve raw script |

## 8. Testing Strategy

### 8.1 Golden Tests

Each adapter has golden tests:
- **Input**: Real export file from the tool (Postman Echo collection, etc.)
- **Output**: Snapshot of the produced `CanonicalApiModel`
- **Verification**: Zod validation passes, endpoint count matches, key fields present

### 8.2 Unit Tests per Mapper

Each mapper function is independently testable:
- `auth.test.ts`: Each Postman auth type → correct SecurityScheme
- `variables.test.ts`: Variable resolution with collection + env merging
- `assertions.test.ts`: Each pm.test() pattern → correct TestDSL assertion
- `format-detector.test.ts`: Each format → correct DetectionResult

### 8.3 Integration Test (Web App)

`ImportDialog` integration test:
1. Mount dialog
2. Drop a Postman collection JSON file
3. Verify format detected correctly
4. Verify endpoint preview rendered
5. Click import
6. Verify endpoints appear in API table

## 9. Implementation Sequence

### Phase 1: Foundation (packages)
1. `@sketch-test/format-detector` — format detection shared utility
2. `@sketch-test/adapter-postman` — Postman Collection → CanonicalApiModel (core mappers)
3. `@sketch-test/adapter-har` — HAR → CanonicalApiModel (lightweight)

### Phase 2: Deep Features (postman adapter)
4. Variable resolution (collection + environment merging)
5. Auth mapping (all types)
6. Script → assertion pattern matching
7. Folder → workflow hints

### Phase 3: Web App Integration
8. Extend `ImportDialog` — multi-format, progress, conflict handling
9. Web Worker for adapter execution
10. Wire to localStorage persistence
11. Polish: progress bar, error states, accessibility

## 10. Out of Scope (Explicit)

- Insomnia native format parsing (users export to Postman from Insomnia)
- RAML, API Blueprint, WSDL formats (existing adapter architecture handles these later)
- Control Plane import API (M1 milestone)
- Real-time collaboration during import
- Import history / rollback
- Postman Collection v1 deep support (suggest user upgrade to v2)

## 11. References

- [Postman Collection Format v2.1.0 Schema](https://schema.postman.com/collection/json/v2.1.0/collection.json)
- [Postman Collection SDK](https://github.com/postmanlabs/postman-collection)
- [HAR 1.2 Spec](http://www.softwareishard.com/blog/har-12-spec/)
- [Postman Collection format docs](https://learning.postman.com/collection-format/getting-started/overview/)
- Apidog conflict resolution UX (only API tool with proper conflict handling)
- `jsonc-parser` npm package for tolerant JSON parsing
