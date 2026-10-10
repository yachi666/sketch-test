# @sketch-test/adapter-postman

> Postman Collection v2.1/v3 → CanonicalApiModel adapter and execution-preserving migration manifest

## Role

Converts Postman Collection v2.1 exports, v3 YAML directory bundles, and Postman Environments into the platform's unified `CanonicalApiModel`. It also produces a separate lossless execution manifest so Postman-specific ordering, scripts, examples, and extension resources survive the canonical projection.

## Architecture

```
src/
  index.ts            # Main entry: importPostmanCollection()
  types.ts            # Postman-specific types (Collection, Item, etc.)
  parser/
    index.ts          # Top-level parsing orchestration
  mapper/
    endpoints.ts      # Item tree → Endpoint[] (with folder flattening)
    assertions.ts     # Postman test scripts → Assertion[]
    auth.ts           # Auth config → SecurityScheme
```

## Scope

- Postman Collection v2.1 JSON
- Postman Collection v3.0 YAML directory bundle (`*.request.yaml`, `definition.yaml`, and `.resources/`)
- Item groups (folders) → flattened with path prefix in endpoint labels
- Request: method, URL (with `{{variable}}` templates), headers, body
- Response: saved examples → `Response[]`
- Auth: Basic, Bearer, API Key, OAuth 2.0 → `SecurityScheme`
- Variables: collection and environment variables → resolved at import time
- Postman test scripts (pm.test, pm.expect) → `Assertion[]` where equivalently expressible
- Full script source, examples, request order, and unknown v3 extension resources → `PostmanExecutionModel` for review/migration
- Diagnostics for unsupported constructs (pre-request scripts, Newman-specific features)

## Mapping

| Postman concept | Canonical API Model |
|----------------|---------------------|
| `item[].request.method` | `Endpoint.method` |
| `item[].request.url.raw` | `Endpoint.path` (normalized, variables resolved) |
| `item[].request.header[]` | `Endpoint.parameters` (header type) |
| `item[].request.url.query[]` | `Endpoint.parameters` (query type) |
| `item[].request.body` | `Endpoint.requestBodies` |
| `item[].response[]` | `Endpoint.responses` |
| `auth` | `SecurityScheme` |
| `variable[]` | Resolved and recorded in metadata |
| `item[].name` (folder path) | Endpoint tags/labels |

## API

```typescript
import { importPostmanCollection } from '@sketch-test/adapter-postman';

const result = importPostmanCollection(collectionJson, {
  sourceLabel: 'my-api.postman_collection.json',
  sourceHash: 'sha256...',
});
// result.model: CanonicalApiModel | null
// result.diagnostics: Diagnostic[]
// result.executionModel: PostmanExecutionModel (lossless source semantics)
```

For v3, callers pass a filesystem-independent virtual file map:

```typescript
const result = importPostmanCollectionV3({
  files: {
    'definition.yaml': 'name: Orders',
    'create.request.yaml': 'method: POST\nurl: https://example.test/orders',
    'create.resources/scripts/test.js': 'pm.response.to.have.status(201)',
  },
}, options);
```

## Design invariants

1. **Failed imports return `model: null`** — validation errors prevent partial output.
2. **All structural elements carry source provenance** — Postman item path + index.
3. **Execution semantics are never silently dropped** — pre-request scripts, test scripts, examples, ordering, and v3 extension resources remain in the execution manifest even when not executable by the Runner.
4. **Stable endpoint ids**: `METHOD-normalized/path` matching the OpenAPI adapter convention.
5. **Output always passes `CanonicalApiModelSchema` validation**.

## Dependencies

- `@sketch-test/canonical-api-model` — output target
- `@sketch-test/contracts-common` — EntityId, ContentHash, Diagnostic, HTTP types

## When to modify

- **Add new auth type mapping**: Extend `mapper/auth.ts`.
- **Support Postman variables in more locations**: Update the variable resolution pass in `parser/`.
- **Improve assertion extraction**: Postman scripts are JavaScript strings — regex-based extraction has limits.
