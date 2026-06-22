# @sketch-test/runner

> Independent Node.js process — executes HTTP tests from compiled ExecutionPlans

## Role

The Runner is an independent process deployed near the system under test. It pulls tasks via lease from the Control Plane, executes HTTP requests, evaluates assertions, extracts variables, redacts secrets, and uploads events. It communicates with the Control Plane through the Runner Protocol.

The Runner **never** sees mutable editor documents — only compiled `ExecutionPlan`s from `@sketch-test/runner-protocol`.

## Quick start

```bash
pnpm dev         # Start in watch mode (tsx --watch src/index.ts)
pnpm test        # Run vitest unit tests
pnpm check       # TypeScript type-check
```

## Architecture

```
executePlan(plan, options)
  ├── createVariableStore(env)        # Seed variables from environment
  ├── RunStarted event
  ├── for each FrozenStep:
  │   ├── Resolve URL/headers/body templates against variable store
  │   ├── executeStep()
  │   │   ├── Build fetch() request
  │   │   ├── Send request (with AbortController timeout)
  │   │   ├── Receive response → parse JSON body
  │   │   ├── redactHeaders / redactBody → sensitive data masking
  │   │   ├── Variable extraction (JSONPath from body/headers/status/cookies)
  │   │   ├── evaluateAssertions() across 6 targets
  │   │   └── Produce events: request.prepared → request.sent → response.received
  │   │       → assertion.evaluated → variable.extracted → step.finished
  │   └── Retry loop (step.maxRetries)
  ├── onFailure handling: stop | skip | goto | teardown-and-stop
  └── RunFinished event
```

## Key invariants

1. **Secrets never enter event payloads** — Sensitive headers and JSON fields are redacted before event upload.
2. **Redaction is recursive** — `SENSITIVE_HEADERS` (authorization, cookie, api-key, etc.) and `SENSITIVE_JSON_FIELDS` (password, token, secret, accessToken, etc.) are always masked to `***REDACTED***`.
3. **Monotonic sequence numbers** — every event gets a strictly increasing `(runId, sequence)` pair.
4. **Each retry attempt records independently** — no attempt overwrites a previous one.
5. **FrozenStep is the execution boundary** — the Runner works exclusively with compiled plans; it has no knowledge of editor documents or mutable workflows.

## Sensitive data redaction

| Category | Fields | Rule |
|----------|--------|------|
| Headers | `authorization`, `cookie`, `set-cookie`, `x-api-key`, `api-key`, `proxy-authorization` | Replace value with `***REDACTED***` |
| JSON body | `password`, `secret`, `token`, `apiKey`, `accessToken`, `refreshToken`, `privateKey` (case-insensitive) | Replace value recursively |

## Variable resolution

The `VariableStore` supports dot-notation templates (`${env.baseUrl}`, `${steps.createUser.userId}`) and three scopes:

- `step` — extracted from a single step's response
- `workflow` — shared across all steps
- `environment` — seeded from `RunSnapshot.env`

## Assertion targets

| Target | Operator support |
|--------|-----------------|
| `status` | equals |
| `header` | exists, equals, contains |
| `jsonPath` | exists, notExists, equals, contains, greaterThan, lessThan, matches, type, hasItems, isEmpty |
| `body` | contains, equals, notContains |
| `responseTime` | lessThan (max ms) |
| `schema` | deferred (validator integration pending) |

## JSONPath

Minimal M0 implementation. Supports: `$.field.subfield`, `$[0].field`, `$.data.items[*].name` (wildcard array access).

## Dependencies

- `@sketch-test/contracts-common` — EntityId, HTTP types, ContentHash, Instant
- `@sketch-test/canonical-api-model` — endpoint identifiers
- `@sketch-test/test-dsl` — assertion operators, extraction sources
- `@sketch-test/runner-protocol` — ExecutionPlan, FrozenStep, RunEvent union, RunEventSchema

## When to modify

- **Add a new assertion target**: Add a case in `evaluateAssertions()` and update the assertion targets table above.
- **Add a new sensitive field**: Add to `SENSITIVE_HEADERS` or `SENSITIVE_JSON_FIELDS`.
- **Change event structure**: Must stay in sync with `@sketch-test/runner-protocol`. Update the contract first, then the Runner.
- **Add a new extraction source**: Add a case in the `extraction.source` switch in `executeStep()`.
