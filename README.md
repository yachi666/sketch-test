# SketchTest

**Turn API descriptions into reviewed tests, reproducible runs, and traceable evidence.**

[![CI](https://github.com/yachi666/sketch-test/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/yachi666/sketch-test/actions/workflows/ci.yml)
[![CodeQL](https://github.com/yachi666/sketch-test/actions/workflows/codeql.yml/badge.svg?branch=master)](https://github.com/yachi666/sketch-test/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

English · [简体中文](README.zh-CN.md)

SketchTest is a self-hosted REST API testing platform for development and QA teams.
Import API descriptions, review generated drafts, publish immutable test or workflow
versions, and execute them through an independent Runner near your target services.
Every run retains versioned inputs and ordered, redacted execution evidence.

> **Status: single-node release candidate.** The core product path has recorded
> acceptance evidence; this is not a general production-readiness guarantee.
> See [verified status and remaining work](docs/STATUS.md).

[Quick start](#quick-start) · [Development](#development) · [Documentation](#documentation) · [Contributing](CONTRIBUTING.md)

## What you can do

| Capability | How it works |
| --- | --- |
| Import API assets | OpenAPI 3.0/3.1/3.2, Postman, HAR, and RAML adapters produce a shared `CanonicalApiModel`. |
| Model business flows | Import/export the supported Arazzo 1.1 subset; compose requests, assertions, extraction, polling, and teardown. |
| Generate reviewed drafts | Rule-based generation and an optional Pi AI Worker create drafts for explicit human review and publication. |
| Discover APIs from code | Public GitHub repositories are pinned to a commit; supported Spring routes and simple DTOs retain source-line provenance. |
| Execute reproducibly | Independent Runners execute published versions with frozen inputs, leases, retries, and secret redaction. |
| Inspect evidence | Web reports and the CLI expose run results, ordered events, traces, and quality-gate outcomes. |

Format support has explicit limits: see [OpenAPI/Arazzo compatibility](docs/OPENAPI_COMPATIBILITY.md)
and [GitHub discovery scope](docs/design/2026-09-23-github-generation.md).

## Quick start

### 1. Get the source

Use **Node.js 24.15.0+ within the 24.x line** and **pnpm 12.10.1**.
The full supported Node range is in [package.json](package.json).
Docker Engine with Compose v2 is required for the packaged stack and end-to-end checks.

```bash
git clone https://github.com/yachi666/sketch-test.git
cd sketch-test
pnpm install --frozen-lockfile
pnpm turbo run lint check test build --force
```

### 2. Start a local packaged stack

```bash
cp .env.example .env
```

Before starting, edit `.env`: replace the PostgreSQL and S3 credentials and generate
**separate** values for `JWT_SECRET`, `SECRET_KEY`, and `RUNNER_REGISTRATION_TOKEN`
with `openssl rand -hex 32`. Set `WEB_ORIGINS=http://localhost:8080` for the packaged
Web app and restrict `IMPORT_ALLOWED_HOSTS` to the API-description hosts you use.
See the [configuration and deployment runbook](docs/OPERATIONS.md).

```bash
docker compose config -q
docker compose up -d --build postgres minio minio-init control-plane web
curl --fail http://localhost:3802/ready
```

The first build compiles the pinned MinIO source and can take several minutes.
The Web app is at **http://localhost:8080**. Complete the runbook's
[workspace bootstrap and Runner provisioning](docs/OPERATIONS.md#deploy) before
running tests; starting the Web container alone does not create an account or Runner.

### 3. Run your first flow

1. Create the first workspace and owner account, then log in.
2. Register and start a Runner for that workspace.
3. Import an API description and configure an environment for the target service.
4. Author or generate drafts, review them, and publish a `TestCaseVersion` or `WorkflowVersion`.
5. Run the published version and inspect the report and redacted evidence.

AI generation is optional and needs a separately configured
[AI Worker](apps/ai-worker/README.md). Regular authoring and execution do not need a model key.

## Development

After configuring your development environment, build workspace dependencies with
`pnpm build`. Run each process in its own terminal; provide environment variables
explicitly through your shell or process manager. Bare `pnpm` commands do not load
`.env` automatically for every service.

| Command | Purpose |
| --- | --- |
| `pnpm dev:web` | Web development server, normally port 5173 |
| `pnpm dev:cp` | Control Plane; requires a reachable PostgreSQL database |
| `pnpm --filter @sketch-test/runner dev:daemon` | Runner daemon; requires a workspace and Runner configuration |
| `pnpm dev:fixture` | Deterministic test-only target service |
| `node apps/cli/dist/index.js --help` | CLI usage |
| `pnpm lint` / `pnpm check` / `pnpm test` / `pnpm build` | Lint, type-check, test, and build |

For production-mode acceptance checks on disposable resources:

```bash
pnpm --filter web exec playwright install chromium
E2E_MANAGED_POSTGRES=1 pnpm e2e:product
pnpm e2e:compose
```

On Linux, use `playwright install --with-deps chromium` when browser OS dependencies
are missing. The checks create isolated databases, object storage, and containers,
then clean them up. The product E2E covers import → publication → execution →
browser/CLI reports, plus database and object-evidence recovery.

## Architecture

```text
Web / CLI ── HTTP ── Control Plane ── PostgreSQL + S3-compatible storage
                         │
                         ├── Generation Protocol ── independent AI Worker
                         └── Runner Protocol ── independent Runner ── target APIs
```

- **Immutable publication:** published API, test, workflow, environment, and dataset versions never change.
- **Contract boundaries:** six versioned packages under `packages/contracts/` are the stable seams.
- **Process isolation:** Control Plane, Runner, and AI Worker have independent lifecycles.
- **Draft-first AI:** generated content is reviewed and explicitly published before execution.

```text
apps/       web · control-plane · runner · ai-worker · cli
packages/   contracts · adapters · test-fixtures
docs/       operations · compatibility · design decisions · verification
ops/        object storage · monitoring · alerting
.github/    CI · security scanning · dependency updates · Pages
```

## Documentation

| Start here | Contents |
| --- | --- |
| [Operations](docs/OPERATIONS.md) | Configuration, deployment, provisioning, backup, restore, and rollback |
| [Status](docs/STATUS.md) | Dated verification evidence and production gaps |
| [Compatibility](docs/OPENAPI_COMPATIBILITY.md) | Executable OpenAPI/Arazzo support boundaries |
| [AI Worker](apps/ai-worker/README.md) | Model configuration, reviewed drafts, and worker limits |
| [Domain glossary](CONTEXT.md) | Canonical entities and product flows |
| [Repository guide](CLAUDE.md) | Package map, invariants, tooling, and testing conventions |
| [GitHub automation](docs/GITHUB_AUTOMATION.md) | Checks, dependency updates, security, version PRs, and Pages |

## Contributing and security

Use [GitHub issues](https://github.com/yachi666/sketch-test/issues/new/choose) for bugs
and proposals. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR against
`master`. CI must pass; published contracts and their consumers must remain consistent.

Report vulnerabilities through [private security reporting](https://github.com/yachi666/sketch-test/security/advisories/new),
not public issues. See [SECURITY.md](SECURITY.md). Never commit credentials or `.env` files.

## License

SketchTest source is licensed under [MIT](LICENSE). Third-party components
retain their own licenses; the bundled source-built MinIO server and client are AGPL-3.0.
