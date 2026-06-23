# @sketch-test/contracts-common

Shared Zod schema primitives used by every other sketch-test contract package. This is the **lowest-level contract** in the platform — changes here cascade everywhere.

## Exports

| Schema | Purpose |
|--------|---------|
| `EntityIdSchema` | URL-safe identifier (`[a-zA-Z0-9_\-/.:{}]+`, max 256 chars) |
| `ContentHashSchema` | SHA-256 hex (64 chars) |
| `SemanticVersionSchema` | Semver string (`1.2.3-prerelease+meta`) |
| `InstantSchema` | ISO-8601 UTC datetime with offset |
| `SourceLocationSchema` | Provenance tracing (sourceId, version, hash, location) |
| `DiagnosticSchema` | Parse/lint diagnostic (severity, code, message, path) |
| `SideEffectLevelSchema` | `read-only` / `cleanup-required` / `irreversible` / `high-risk` |
| `ConfidenceLevelSchema` | AI confidence: `certain` / `high` / `medium` / `low` / `inferred` |
| `HttpMethodSchema` | GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS |
| `HttpStatusCodeSchema` | Known status codes (200-503) + catch-all |
| `MediaTypeSchema` | MIME type string |
| `ImmutableVersionMetaSchema` | Base fields for all published versions (id, version number, publishedAt, contentHash) |
| `VariableRefSchema` | Variable reference (name, scope, extractFrom, sensitive) |
| `VariableScopeSchema` | step / workflow / environment / secret |
| `VariableTypeSchema` | plain / secret / dataset |
| `VariableDefinitionSchema` | Full variable definition (id, name, type, scope, defaultValue, overrides, sensitive, description) |
| `EnvironmentSchema` | Deployment target (id, name, tags, variables, secretRefs, executorTags, isProduction, updatedAt, updatedBy) |
| `EnvironmentVersionSchema` | Immutable environment snapshot (Environment + ImmutableVersionMeta) |
| `CursorPaginationSchema` | Cursor + limit pagination |
| `PaginatedResultSchema` | Generic paginated response factory |
| `ApiErrorResponseSchema` | Standard error envelope (code, message, fieldProblems, correlationId) |

## Usage

```typescript
import { EntityIdSchema, type EntityId } from '@sketch-test/contracts-common';
```

Always export schemas with the `Schema` suffix. Derive types with `z.infer<typeof Schema>`.

## When to modify

- **Add**: When a new primitive is needed by 2+ other contract packages.
- **Do NOT add**: Package-specific types that only one consumer needs — put those in that package.
- **Never remove or rename** a field from an existing schema — this is a breaking change for all downstream contracts.
- Adding new enum values is generally safe if downstream consumers use `.catchall()` or `.or()`.
