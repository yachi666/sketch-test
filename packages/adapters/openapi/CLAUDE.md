# @sketch-test/adapter-openapi

> OpenAPI → CanonicalApiModel adapter — the input seam for API descriptions

## Role

This adapter converts OpenAPI 3.0 / 3.1 documents into the platform's unified `CanonicalApiModel`. It is an **adapter seam**: every API source format must produce a canonical model. Consumers (test generation, workflow compiler, API browser) never see OpenAPI-specific types.

## Quick start

```bash
pnpm test        # Run vitest unit tests
pnpm check       # TypeScript type-check
```

## M0 scope

- OpenAPI 3.0 / 3.1 JSON documents
- Paths → Endpoints (with stable identifiers)
- Parameters (path, query, header, cookie)
- Request bodies (with content → schema refs)
- Responses (status codes, content, headers)
- Schema extraction (flat registry with JSON Pointer paths)
- Security schemes (http, apiKey, oauth2, openIdConnect, mutualTLS)
- Servers
- Diagnostics for unsupported constructs

## Mapping rules

| OpenAPI concept | Canonical API Model | Notes |
|----------------|---------------------|-------|
| `paths./p.{method}` | `Endpoint` | Stable id = `{METHOD} /p` |
| `{param}` in path | `:param` in normalized path | `{userId}` → `:userId` |
| `#/components/schemas/X` | `ApiSchemaNode` at `/schemas/X` | Flat registry, JSON Pointer paths |
| `parameters[].in` | `Parameter.in` | path/query/header/cookie |
| `responses.{status}` | `Response` with statusCode | "default" mapped to 200 |
| `securitySchemes` | `SecurityScheme` | 5 types mapped |

## Source locations

Every structural element carries a `SourceLocation` with:
- `sourceId` — derived from the spec label
- `location` — JSON Path to the OpenAPI source (e.g., `$.paths./users.post`)
- `ingestedAt` — import timestamp

## Key invariants

1. **Failed imports never create a valid ApiVersion** — `ImportResult.success === false` when any error diagnostic exists.
2. **Warnings are never silently dropped** — unsupported HTTP methods, unknown security types, and OpenAPI 3.1 webhooks all produce diagnostics.
3. **Endpoint identifiers are deterministic** — `METHOD-normalized-path`, no UUIDs, no database row IDs.
4. **Schema references are stable** — `$ref` resolution produces `/schemas/{name}` paths.

## Diagnostics

| Code | Severity | Trigger |
|------|----------|---------|
| `UNSUPPORTED_OPENAPI_VERSION` | error | Not 3.x |
| `UNSUPPORTED_HTTP_METHOD` | warning | Non-standard HTTP method |
| `UNSUPPORTED_SECURITY_TYPE` | warning | Unknown security scheme type |
| `WEBHOOKS_NOT_SUPPORTED` | warning | OpenAPI 3.1 webhooks present |
| `POLL_CANDIDATE` | info | GET endpoint with status-related summary |

## Dependencies

- `@sketch-test/canonical-api-model` — output target (CanonicalApiModel, Endpoint, ApiSchemaNode, SecurityScheme, etc.)
- `@sketch-test/contracts-common` — EntityId, HttpMethod, HttpStatusCode, ContentHash, Diagnostic, Instant

## When to modify

- **Add OpenAPI 2.0 (Swagger) support**: Update the `oaVersion.startsWith('3.')` guard. Add swagger→OpenAPI normalization.
- **Add a new mapping**: Follow the `mapEndpoints`/`mapSecuritySchemes`/`extractSchemas` pattern — each produces structured output + diagnostics.
- **Change schema extraction**: Update `extractSchemas()` and verify golden tests against known specs.
- **Change endpoint id format**: This is a **breaking change** — coordinate with all consumers of `Endpoint.id`.
