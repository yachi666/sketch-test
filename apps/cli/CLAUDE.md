# @sketch-test/cli

> CLI tool for triggering runs and checking results from CI pipelines

## Role

A Node.js CLI (`sketchtest`) that communicates with the Control Plane to trigger test suite runs, workflow runs, check status, and retrieve reports. Designed for CI/CD integration (GitHub Actions, GitLab CI). Returns appropriate exit codes for quality gate results.

## Quick start

```bash
pnpm dev:cli -- run <testSuiteId> --cp-url http://localhost:3802
pnpm dev:cli -- run-workflow <workflowId> --environment <envId>
pnpm dev:cli -- status <runId>
pnpm dev:cli -- report <runId> --output github
```

## Commands

| Command | Purpose |
|---------|---------|
| `run <testSuiteId>` | Trigger a test suite run and wait for results |
| `run-workflow <workflowId>` | Trigger a single workflow run and wait |
| `status <runId>` | Check current run status |
| `report <runId>` | Get run report in text/json/github format |
| `cancel <runId>` | Cancel a running run |

## Options

| Option | Default | Purpose |
|--------|---------|---------|
| `--cp-url <url>` | `http://localhost:3802` | Control Plane URL |
| `--environment <id>` | — | Environment version ID |
| `--token <token>` | `$SKETCHTEST_TOKEN` | Auth token |
| `--wait` / `--no-wait` | `true` | Wait for run completion |
| `--timeout <seconds>` | `300` | Max wait time |
| `--poll-interval <s>` | `3` | Poll interval in seconds |
| `--output <format>` | `text` | Output format: `json` \| `text` \| `github` |
| `--idempotency-key <k>` | — | Prevent duplicate runs |

## CI integration

### GitHub Actions

```yaml
- name: Run API tests
  run: |
    npx sketchtest run suite-abc123 \
      --cp-url ${{ secrets.CP_URL }} \
      --token ${{ secrets.SKETCHTEST_TOKEN }} \
      --environment env-xyz \
      --output github
```

### GitLab CI

```yaml
api-tests:
  script:
    - npx sketchtest run suite-abc123
      --cp-url $CP_URL
      --token $SKETCHTEST_TOKEN
      --environment $ENV_VERSION_ID
      --output gitlab
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | All tests passed, quality gate passed |
| `1` | Tests failed or quality gate blocked |
| `2` | Infrastructure error (timeout, connection refused, inconclusive) |
| `3` | Usage error (invalid arguments, missing required options) |

## Architecture

```
apps/cli/src/
  index.ts            # CLI entry point — arg parsing, command dispatch
  cp-client.ts        # HTTP client for Control Plane API (auth, retries, error handling)
```

The CLI uses minimal dependencies — no framework, just Node.js built-in `http`/`https` and a lightweight Control Plane client.

## Dependencies

No runtime package dependencies; the CLI talks to CP over HTTP.

## When to modify

- **Add a new command**: Follow the pattern in `index.ts` — parse args, call `cp-client`, format output.
- **Add a new CI output format**: Add a formatter function and wire it to `--output`.
- **Add retry/backoff logic**: Modify `cp-client.ts` — keep it simple, no exponential backoff library needed.
