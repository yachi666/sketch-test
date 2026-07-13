# @sketch-test/web

> React 19 + Vite 6 — authenticated API import, workflow execution, and run reports

## Role

The Web app is the primary user interface for the currently verified product path. It provides workspace-aware login, API import/catalog, workflow publication and execution, and run reports. Routes without real Control Plane integration are intentionally absent.

## Quick start

```bash
pnpm dev:web          # Start dev server on port 5173
pnpm --filter web test   # Run route, login, and store tests (vitest + jsdom)
```

## Tech stack

- **React 19** with React Router v7
- **Zustand** for state management (stores in `src/stores/`)
- **Phosphor Icons** for iconography
- **Vite 6** for bundling and dev server
- **Testing Library** + jsdom for component and store tests

## Structure

```
apps/web/src/
  main.tsx                # Vite entry point
  app/                    # Root component, protected routes, providers
  components/             # Import and authenticated layout components
  hooks/useApi.ts         # Control Plane-backed resource hooks
  lib/cp-client.ts        # Authenticated HTTP client
  lib/auth-session.ts     # Browser JWT persistence and 401 invalidation
  pages/                  # Login, ApiManagement, Workflows, Runs
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
- **API calls** go through `src/lib/cp-client.ts` and `src/hooks/useApi.ts`.
- **Type imports** from `@sketch-test/contracts-*` packages where possible; app-specific types in `src/types/`.

## Testing

Vitest/jsdom covers protected route truthfulness, login integration, and UI state. `pnpm e2e:product` also runs a mandatory Playwright Chromium flow against live production-mode services.

## Dependencies

- `react`, `react-dom` (catalog)
- `react-router-dom` ^7
- `zustand` ^5
- `@phosphor-icons/react` (catalog)
- `@playwright/test` (development-only live-browser acceptance)
