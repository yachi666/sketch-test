# @sketch-test/adapter-raml

> RAML 1.0 → CanonicalApiModel adapter (in progress)

## Role

Converts RAML 1.0 API definitions into the platform's unified `CanonicalApiModel`. This is an adapter seam — the output is always the canonical model, regardless of input format. Core resource/method mapping is supported; advanced RAML features such as traits, resource types, and annotations produce diagnostics.

## Scope

- RAML 1.0 YAML specifications
- Resource paths → `Endpoint[]` (with stable identifiers)
- HTTP methods, query parameters, headers, request bodies, responses
- Schema extraction from RAML types
- Security schemes: OAuth 2.0, Basic Auth, API Key
- Servers from `baseUri`
- Diagnostics for unsupported constructs (traits, resourceTypes, security schemes with `describedBy`, annotations, overlays, extensions, libraries)

## Mapping

| RAML concept | Canonical API Model |
|-------------|---------------------|
| `/{resource}` nested resources | `Endpoint[]` with `METHOD /resource/...` ids |
| `/{resource}/{id}` URI params | `Endpoint.parameters` (path type) |
| `queryParameters` | `Endpoint.parameters` (query type) |
| `headers` | `Endpoint.parameters` (header type) |
| `body` with `type` | `Endpoint.requestBodies` |
| `responses.{status}` | `Endpoint.responses` |
| `types` section | `ApiSchemaNode` in flat registry |
| `baseUri` | `Server` |
| `securitySchemes` | `SecurityScheme[]` |
| `traits`, `resourceTypes` | Diagnostic warning (unsupported) |

## API

```typescript
import { importRaml } from '@sketch-test/adapter-raml';

const result = importRaml(ramlYamlString, {
  sourceLabel: 'api.raml',
  sourceHash: 'sha256...',
});
// result.model: CanonicalApiModel | null
// result.diagnostics: Diagnostic[]
```

## Design invariants

1. **Failed imports return `model: null`** — never a partial model.
2. **All structural elements carry source locations** (RAML file + line/column).
3. **Warnings for unsupported constructs are never silently dropped** — traits, resource types, etc. produce diagnostics with the `path` pointing to the unsupported node.
4. **Stable endpoint ids match OpenAPI adapter convention**: `METHOD-normalizedPath` with `{param}` → `:param`.
5. **Resource nesting is flattened** — `/users/{id}/orders` is one endpoint, not three nested resources.

## Dependencies

- `@sketch-test/canonical-api-model` — output target
- `@sketch-test/contracts-common` — EntityId, ContentHash, Diagnostic, HTTP types
- `yaml` — YAML parsing

## Known gaps

- Traits and resource types: produce diagnostics, not expanded
- Security scheme `describedBy`: not mapped
- Annotations, overlays, extensions, libraries: produce diagnostics
- RAML 0.8: not supported

## When to modify

- **Add trait/resourceType expansion**: This is the biggest value-add — expand parameterized traits into concrete parameters/headers.
- **Support RAML libraries**: Resolve `uses:` imports and inline referenced types.
- **Add RAML 0.8 support**: Requires format detection updates and schema differences.
