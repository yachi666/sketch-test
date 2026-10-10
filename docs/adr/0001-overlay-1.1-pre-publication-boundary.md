# ADR 0001: Overlay 1.1 is a pre-publication transformation only

- Status: Accepted (implementation deferred behind conformance gates)
- Date: 2026-07-13
- Standards baseline: Overlay 1.1.0, schema iteration 2026-04-01, RFC 9535

## Context

Overlay 1.1 defines an ordered list of `update`, `remove`, or `copy` actions.
Each action selects target nodes using RFC 9535 JSONPath and applies to the
result of the preceding action. A zero-node selection succeeds without a
change. Incompatible recursive merges, heterogeneous multi-node targets, or a
`copy` expression that does not select exactly one source node are errors.

Applying an Overlay can materially change the API surface and therefore every
generated test and workflow. Published `ApiVersion` records are immutable, and
the source description remains evidence even when a derived description is
used for publication.

Overlay operates on the JSON data model. YAML and JSONC comments are not part
of that model, and the specification explicitly permits comment loss during a
transformation.

## Decision

SketchTest will accept Overlay 1.1 only as an optional transformation before a
new `ApiVersion` is validated and published. It will never mutate a published
version or its stored source.

The future transformation record must retain:

- byte-exact source and Overlay objects with SHA-256 hashes;
- the Overlay version, `extends` value, and ordered actions;
- engine package, exact version, and conformance-suite revision;
- derived document bytes and hash;
- per-action match counts and stable diagnostics;
- the final OpenAPI schema and semantic-validation result.

An Overlay engine will receive parsed documents only. URL retrieval and
`extends` resolution remain in the Control Plane and use the same protocol,
host allowlist, redirect, timeout, and byte-budget policy as OpenAPI imports.
The engine cannot perform network or file I/O.

The generated derived document need not preserve comments. The raw source and
Overlay remain byte-exact evidence, and materialization must emit a
`COMMENTS_NOT_PRESERVED` informational diagnostic whenever the source syntax
tree contained comments. Silent replacement of the original source is
forbidden.

After all actions succeed, the derived document must pass the exact OpenAPI
version gate, published schema-family validation, semantic diagnostics, and
canonical-model validation before it can become a new immutable `ApiVersion`.

## Dependency decision

No JSONPath or Overlay dependency is approved for production yet.
`jsonpath-plus` exposes extensions to the original JSONPath model, so using it
without a verified RFC-only mode would violate Overlay 1.1 interoperability.
`jsonpath-rfc9535` is a candidate because it claims the RFC 9535 compliance
suite, but that claim is not enough for this trust boundary.

A dependency may be approved only after a pinned-version spike proves:

1. the full RFC 9535 compliance suite passes with extensions disabled;
2. results include stable node locations needed for safe update/remove/copy;
3. filters cannot execute host-language code;
4. pathological queries have explicit time, depth, and match-count budgets;
5. prototype-pollution keys cannot mutate object prototypes;
6. action ordering, copy cardinality, merge incompatibility, and zero-match
   behavior match Overlay 1.1 fixtures;
7. license, maintenance, provenance, and lockfile integrity pass repository
   supply-chain policy.

Until those gates pass, production import routes reject Overlay documents with
`OVERLAY_NOT_ENABLED`; an ad hoc partial JSONPath implementation is forbidden.

## Consequences

- Overlay becomes a reproducible derivation rather than an in-place edit.
- Published-version immutability and audit provenance remain intact.
- Users can always recover the original source, even when comments are absent
  from the derived document.
- Overlay support does not delay the current OpenAPI/Arazzo compatibility work.
- A later implementation has explicit conformance, security, and observability
  gates instead of relying on library marketing claims.
