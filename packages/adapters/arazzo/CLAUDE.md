# @sketch-test/adapter-arazzo

Imports and deterministically exports the explicitly supported Arazzo 1.1
sequential HTTP subset through the versioned `WorkflowDefinition` contract.

## Supported subset

- YAML 1.2 and JSON source documents with exact version `1.1.0`
- OpenAPI `sourceDescriptions` supplied as already-imported canonical models;
  the production Control Plane path also requires retrieval-URL and
  content-hash evidence from a current-workspace immutable ApiVersion
- Sequential steps addressed by `operationId`
- Path, query, header, and cookie parameter values
- Request bodies, simple status criteria, bounded retry actions, and outputs
- Arazzo runtime inputs and prior-step outputs translated to Workflow DSL refs
- Deterministic subset export and round trip with identical ExecutionPlan hash

## Fail-closed boundaries

AsyncAPI operations, nested workflow calls, `operationPath`, `querystring`,
selectors beyond the documented subset, conditional control-flow actions, and
external source fetching produce stable error diagnostics. This adapter never
performs network or file I/O.

The production entry is `POST /api/workflows/import/arazzo`. It stores raw
source by SHA-256 content address and transactionally creates version 1 of each
imported workflow; publication still compiles through the normal Workflow
Compiler boundary.

The Arazzo specification text is authoritative. The compatibility matrix in
`docs/OPENAPI_COMPATIBILITY.md` records executable evidence and remaining work.
