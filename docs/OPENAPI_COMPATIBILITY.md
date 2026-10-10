# OpenAPI ecosystem compatibility

> Status: executable compatibility contract, introduced 2026-07-13.
> A row is only `supported` when the linked automated evidence exercises the
> behavior. `diagnostic` means the document is rejected or the construct is
> preserved with a stable diagnostic; it must never disappear silently.

## Authoritative baselines

- OpenAPI Specification: 3.0.4, 3.1.2, and 3.2.0.
- Arazzo Specification: 1.1.0.
- Overlay Specification: 1.1.0 (pre-publication-only boundary accepted in ADR
  0001; implementation deferred).
- YAML input: YAML 1.2-compatible JSON data model.

The source specification text is authoritative when it disagrees with a
published validation schema. Official schemas and examples are used as the
conformance fixture source, not as a replacement for semantic checks.

## Status vocabulary

| Status | Meaning |
|---|---|
| `supported` | Semantics are represented across the canonical contract and every required consumer. |
| `preserved` | Source semantics and provenance are retained, but are not executable. |
| `diagnostic` | A stable diagnostic prevents silent loss and, when execution would be unsafe or incorrect, prevents publication. |
| `not-applicable` | The construct is outside the declared HTTP execution boundary. |
| `planned` | No completion claim; implementation or executable evidence is still missing. |

## OpenAPI compatibility matrix

| Capability | 3.0.4 | 3.1.2 | 3.2.0 | Current evidence |
|---|---:|---:|---:|---|
| JSON document import | supported | supported | supported | `packages/adapters/openapi/src/__tests__/fixture.test.ts` |
| YAML 1.2 document import | supported | supported | supported | Baseline matrix in `packages/adapters/openapi/src/__tests__/oas32.test.ts`; Control Plane YAML persistence in `apps/control-plane/src/modules/import/__tests__/import.service.test.ts`. |
| Exact version recognition | supported | supported | supported | `SUPPORTED_OPENAPI_VERSIONS` plus baseline and unknown-future-version tests in `oas32.test.ts`. |
| Official schema-family validation | supported | supported | supported | `validateAndImportOpenApiText` and invalid-document/baseline tests in `oas32.test.ts`; normative specification text remains authoritative. |
| Document `jsonSchemaDialect` | diagnostic | preserved | preserved | 3.0 rejects the field; 3.1/3.2 retain the identifier in immutable source metadata (`oas32.test.ts`). |
| Standard HTTP operations | supported | supported | supported | Adapter golden tests and product E2E. |
| `QUERY` operation | not-applicable | not-applicable | supported | Common/canonical contract tests, adapter and format-detector fixtures, Runner integration, and product E2E workflow. |
| `additionalOperations` | not-applicable | not-applicable | diagnostic | `UNSUPPORTED_ADDITIONAL_OPERATION` blocks publication (`oas32.test.ts`). |
| `in: querystring` | not-applicable | not-applicable | diagnostic | `QUERYSTRING_PARAMETER_NOT_EXECUTABLE` blocks coercion (`oas32.test.ts`). |
| Nested/classified tags | not-applicable | not-applicable | preserved | `summary`, `parent`, and `kind` are retained in immutable source metadata (`oas32.test.ts`). |
| Sequential/streaming `itemSchema` | not-applicable | not-applicable | diagnostic | `STREAMING_ITEM_SCHEMA_NOT_EXECUTABLE` blocks buffered misrepresentation (`oas32.test.ts`). |
| OAuth device authorization and metadata | not-applicable | not-applicable | preserved | Additive canonical fields and adapter evidence in `oas32.test.ts`. |
| `$self` document identity | not-applicable | not-applicable | preserved | Retained as `documentSelf`; multi-document resolution is deferred (`oas32.test.ts`). |
| Webhooks | not-applicable | diagnostic | diagnostic | `WEBHOOKS_NOT_SUPPORTED`; execution remains outside the current Runner boundary. |
| External references | diagnostic | diagnostic | diagnostic | `EXTERNAL_REFERENCE_NOT_ALLOWED` fails closed (`oas32.test.ts`). |
| Reference cycles | preserved | preserved | preserved | Internal reference-cycle fixture proves shallow preservation without recursive dereferencing (`oas32.test.ts`). |
| URL retrieval policy | supported | supported | supported | Host allowlist, HTTP(S)-only policy, credential rejection, redirect revalidation, timeout, and byte-budget tests in `import.service.test.ts`. |
| Parser resource budgets | supported | supported | supported | Source bytes, YAML aliases, parsed depth, and parsed node count fail closed with stable diagnostics in `oas32.test.ts`. |
| Markdown/HTML rendering | not-applicable | not-applicable | not-applicable | Adversarial HTML/Markdown is retained as inert source data in `oas32.test.ts`; no rich-text renderer exists and React text interpolation escapes source strings. Any future CommonMark surface requires an allowlist sanitizer before this status changes. |

## Arazzo 1.1 compatibility matrix

| Capability | Status | Required evidence |
|---|---|---|
| OpenAPI `sourceDescriptions` | supported | Relative URI resolution, exact retrieval URL, canonical content-hash verification, mismatch fixtures, and current-workspace source enforcement in `arazzo-import.service.test.ts`. |
| Supplied canonical OpenAPI source binding | supported | Qualified/unqualified `operationId` and ambiguity fixtures in `packages/adapters/arazzo/src/__tests__/arazzo.test.ts`. |
| Sequential HTTP workflow import | supported | Arazzo fixture maps to versioned `WorkflowDefinition`; the production route preserves raw source/provenance and product E2E compiles, publishes, and executes it as an `ExecutionPlan`. |
| Inputs and runtime expressions | supported | Input and prior-step output expressions are mapped; input schemas are preserved in raw source with `ARAZZO_INPUT_SCHEMA_PRESERVED`. |
| Outputs/selectors | diagnostic | Body-pointer, header, and status runtime expressions map to extractions; other selectors fail with stable diagnostics. |
| Success criteria | diagnostic | Simple status equality maps to Runner assertions; other criterion forms fail with `ARAZZO_CRITERION_NOT_SUPPORTED`. |
| Bounded retry | supported | One unconditional retry action maps within Workflow DSL bounds; out-of-range actions fail closed. |
| Workflow chaining | diagnostic | `ARAZZO_WORKFLOW_CHAINING_NOT_SUPPORTED`. |
| AsyncAPI source descriptions | not-applicable | `ARAZZO_ASYNCAPI_NOT_SUPPORTED`; no second execution engine. |
| Deterministic export/round trip | supported | Adapter golden round trip plus Control Plane integration proving identical executable plan hashes. |

## Overlay 1.1 decision boundary

Overlay is not currently accepted by a production import path. ADR 0001 adopts
it only as a pre-publication transformation whose input, ordered actions,
output, and hashes are retained. Applying an Overlay to a published
`ApiVersion` is forbidden. `docs/adr/0001-overlay-1.1-pre-publication-boundary.md`
records the RFC 9535, comment, error, dependency, provenance, and rollout gates.

## Release gate

This matrix is complete only when every `planned` row is replaced with
`supported`, `preserved`, `diagnostic`, or `not-applicable` and links to direct
evidence. A successful parse is not evidence when a construct is silently
ignored.
