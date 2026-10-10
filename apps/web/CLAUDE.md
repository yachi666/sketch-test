# @sketch-test/web

> React 19 + Vite 8 — API import, workflow execution, and run reports

## Role

The Web app is the primary user interface for the currently verified product path. It opens directly on the product dashboard and provides API import/catalog, workflow publication and execution, versioned test-plan and quality-gate management, schedule controls, and run reports. Routes without real Control Plane integration are intentionally absent.

## Quick start

```bash
pnpm dev:web          # Start dev server on port 5173
pnpm --filter web test   # Run route, component, and store tests (vitest + jsdom)
```

## Tech stack

- **React 19** with React Router v7
- **Zustand** for state management (stores in `src/stores/`)
- **Phosphor Icons** for iconography
- **Vite 8** for bundling and dev server
- **Testing Library** + jsdom for component and store tests

## Structure

```
apps/web/src/
  main.tsx                # Vite entry point
  app/                    # Root component, product routes, providers
  components/             # Import and product layout components
  hooks/useImportWorker.ts # Cancellable browser import worker
  lib/cp-client.ts        # Authenticated HTTP client
  lib/auth-session.ts     # Browser JWT persistence and 401 invalidation
  pages/                  # Current product routes, including generation and review
  stores/                 # authStore and UI-only state
  styles.css              # Global styles
```

## Stores

Shared client state lives in Zustand stores under `src/stores/`:

| Store | Purpose |
|-------|---------|
| `authStore` | Authentication state, JWT tokens |
| `uiStore` | Sidebar and UI-only preferences |

## Conventions

- **Component files** use PascalCase. Hook files use `use` prefix. Store files use `Store` suffix.
- **State management** goes in Zustand stores, not React context or component-local state (for shared data).
- **API calls** go through `src/lib/cp-client.ts`.
- **Type imports** from `@sketch-test/contracts-*` packages where possible; app-specific types in `src/types/`.

## Testing

Vitest/jsdom covers route truthfulness, component behavior, session compatibility, and UI state. `pnpm e2e:product` also runs a mandatory Playwright Chromium flow against live production-mode services.

## Dependencies

- `react`, `react-dom` (catalog)
- `react-router-dom` ^7
- `zustand` ^5
- `@phosphor-icons/react` (catalog)
- `@playwright/test` (development-only live-browser acceptance)

## Regression investigation (2026-09-23)

Reports query `/api/runs` with server-side search, status/time filters, pagination,
and scoped summary counts. Dashboard counts use the entire seven-day window;
attention items are queried separately from recent runs. Report detail defaults
to assertion evidence and preserves list filters in the URL. Use `lib/run-status.ts`
for actual persisted statuses (`pending`, `claimed`) and historical aliases.

## Repository generation (2026-09-23)

AgentPage offers API and GitHub sources. Repository analysis is a real CP request; editing the source invalidates the previous generation selection. Saved snapshots can be reused after reload. Source links bind to a commit and line. Completed jobs display actual draft and endpoint coverage counts. Cases review renders server-owned code provenance; generation does not publish or execute drafts.
