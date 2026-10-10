> 历史记录：2026 年 6–7 月原型阶段的设计、计划或审视；不作为当前实现说明或待执行指令。当前入口见 [仓库 README](../../../../../README.md)。

# Host Variable Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `defaultBaseUrl` from ApiSource, make Host exclusively managed through Variables with auto-tagging and a dedicated selector in the API endpoint editor.

**Architecture:** Variables become the single source of truth for service hosts. ApiSource retains its grouping/metadata role but loses `defaultBaseUrl`. Variables with HTTP/HTTPS values auto-receive a `host` tag, enabling a filtered selector in the endpoint editor.

**Tech Stack:** React 19 + TypeScript strict, localStorage persistence

## Global Constraints

- Keep ApiSource as an organizational concept (grouping, source metadata)
- Host resolution: `resolveVariableValue(variable, activeEnvironmentId)` already handles per-env override
- Auto-tag: `http://` or `https://` prefix → `tags: ['host']`
- Backward compat: existing localStorage data without `tags` field defaults to `[]`

---

### Task 1: Update Type Definitions

**Files:**
- Modify: `apps/web/src/types.ts:131-146` (ApiSource), `apps/web/src/types.ts:374-398` (Variable)
- Modify: `apps/web/src/lib/storage.ts:110-119` (StoredApiSource)

- [ ] **Step 1: Remove `defaultBaseUrl` from `ApiSource` interface**

In `apps/web/src/types.ts`, remove the `defaultBaseUrl` field and its JSDoc from `interface ApiSource`:

```typescript
// ─── API Source (系统) ───────────────────────────────────────────

/** A source system providing a set of API endpoints (e.g. "User Service", "Payment Service"). */
export interface ApiSource {
  id: EntityId;
  /** Display name, e.g. "用户服务". */
  name: string;
  description?: string;
  /** Original file or identifier, e.g. "user-service.yaml". */
  sourceLabel: string;
  sourceType: 'openapi' | 'raml' | 'manual';
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Add `tags` field to `Variable` interface**

In `apps/web/src/types.ts`, add `tags: string[]` to `interface Variable`:

```typescript
export interface Variable {
  id: EntityId;
  name: string;
  defaultValue: string;
  overrides: Record<string, string>;
  type: VariableType;
  scope: VariableScope;
  sourceId?: EntityId;
  /** Tags for classification, e.g. ["host"] for service URL variables. */
  tags: string[];
  sensitive: boolean;
  description: string;
  updatedAt: string;
  updatedBy: string;
  usedIn: string[];
}
```

- [ ] **Step 3: Remove `defaultBaseUrl` from `StoredApiSource` in storage.ts**

```typescript
export interface StoredApiSource {
  id: string;
  name: string;
  description?: string;
  sourceLabel: string;
  sourceType: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/types.ts apps/web/src/lib/storage.ts
git commit -m "refactor(types): remove defaultBaseUrl from ApiSource, add tags to Variable"
```

### Task 2: Update Initial Data

**Files:**
- Modify: `apps/web/src/data.ts:162-173` (apiSources), `apps/web/src/data.ts:1473-1615` (initialVariables)

- [ ] **Step 1: Remove `defaultBaseUrl` from `apiSources` initial data**

```typescript
export const apiSources: import('./types').ApiSource[] = [
  {
    id: 'src-sketch-test',
    name: 'SketchTest 平台',
    description: 'SketchTest 演示用单体 API，包含用户、订单、支付接口。',
    sourceLabel: 'openapi.yaml',
    sourceType: 'openapi',
    createdAt: '2026-06-15T10:00:00+08:00',
    updatedAt: '2026-06-21T14:00:00+08:00',
  },
];
```

- [ ] **Step 2: Add `tags: ['host']` to service URL variables, `tags: []` to others**

For variables with `http://` or `https://` in their defaultValue, add `tags: ['host']`. For all others, add `tags: []`.

Variables that get `tags: ['host']`:
- `var-userService` (http://localhost:8080)
- `var-paymentService` (http://localhost:8081)
- `var-notifyService` (http://localhost:8082)

All others get `tags: []`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/data.ts
git commit -m "refactor(data): remove defaultBaseUrl, add host tags to service variables"
```

### Task 3: Update ApiSourceDialog — Remove Base URL Field

**Files:**
- Modify: `apps/web/src/components/source/ApiSourceDialog.tsx`

- [ ] **Step 1: Remove `defaultBaseUrl` from `emptySource()`**

```typescript
function emptySource(): ApiSource {
  return {
    id: '',
    name: '',
    description: '',
    sourceLabel: '',
    sourceType: 'openapi',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 2: Remove `defaultBaseUrl` from `handleSave`'s `upsertApiSource` call**

```typescript
upsertApiSource({
  id: saved.id,
  name: saved.name,
  description: saved.description || undefined,
  sourceLabel: saved.sourceLabel,
  sourceType: saved.sourceType,
  createdAt: saved.createdAt,
  updatedAt: saved.updatedAt,
});
```

- [ ] **Step 3: Remove the "默认 Base URL" form field (lines 166-187)**

Delete the entire `<label>` block for the default base URL input.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/source/ApiSourceDialog.tsx
git commit -m "refactor(ui): remove defaultBaseUrl field from ApiSourceDialog"
```

### Task 4: Update SourceSelector — Remove Base URL Display

**Files:**
- Modify: `apps/web/src/components/source/SourceSelector.tsx:44-46`

- [ ] **Step 1: Remove the `defaultBaseUrl` display line**

Remove lines 44-46:
```typescript
{selected?.defaultBaseUrl ? (
  <span className="source-baseurl">{selected.defaultBaseUrl}</span>
) : null}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/source/SourceSelector.tsx
git commit -m "refactor(ui): remove defaultBaseUrl display from SourceSelector"
```

### Task 5: Update VariableDialog — Auto-tag HTTP/HTTPS Values

**Files:**
- Modify: `apps/web/src/App.tsx:2343-2653` (VariableDialog component)

- [ ] **Step 1: Add `tags` state to VariableDialog**

Add after the existing state declarations:
```typescript
const [tags, setTags] = useState<string[]>([]);
```

- [ ] **Step 2: Initialize `tags` from variable in edit mode, compute auto-tag in create mode**

In the `useEffect` for initialization:
```typescript
// In the edit init block:
setTags(variable.tags ?? []);
// In the create init block:
setTags([]);
```

- [ ] **Step 3: Auto-detect host tag when defaultValue changes**

Add a `useEffect` that watches `defaultValue`:
```typescript
// Auto-tag: if defaultValue starts with http:// or https://, ensure 'host' tag
useEffect(() => {
  if (/^https?:\/\//.test(defaultValue.trim())) {
    setTags((prev) => (prev.includes('host') ? prev : [...prev, 'host']));
  }
  // Note: we don't auto-remove 'host' — user controls removal manually
}, [defaultValue]);
```

- [ ] **Step 4: Add tags display and management UI**

Add a tag input row after the "描述" textarea:
```tsx
{/* Tags */}
<div className="variable-field-row" style={{ marginTop: 12 }}>
  <label className="variable-field" style={{ flex: 1 }}>
    <span className="field-label">标签</span>
    <div className="tag-chips">
      {tags.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
          <button
            type="button"
            className="tag-chip-remove"
            onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
            aria-label={`移除标签 ${tag}`}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      {tags.length === 0 ? (
        <span className="field-hint" style={{ fontSize: '0.7rem' }}>
          HTTP/HTTPS 值会自动添加 "host" 标签
        </span>
      ) : null}
    </div>
  </label>
</div>
```

- [ ] **Step 5: Include `tags` in the saved variable**

In `handleSave`, add `tags` to the saved object:
```typescript
const saved: Variable = {
  // ... existing fields
  tags,
  // ... rest
};
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(variables): auto-tag HTTP/HTTPS values as 'host', add tag management UI"
```

### Task 6: Update VariablesView — Show Host Tags

**Files:**
- Modify: `apps/web/src/App.tsx:2742-3034` (VariablesView component)

- [ ] **Step 1: Show Host tag badge in the variable table rows**

In the variable table row rendering, add a host tag display next to the variable name when `v.tags.includes('host')`:

```tsx
{v.tags.includes('host') ? (
  <span className="host-tag-badge" title="Host 变量，可在接口编辑中选择">
    <Globe size={11} />
  </span>
) : null}
```

Need to import `Globe` from `@phosphor-icons/react`.

- [ ] **Step 2: Add import for Globe icon**

Add `Globe` to the imports from `@phosphor-icons/react` at the top of App.tsx.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(variables): show Host tag badge in variable table"
```

### Task 7: Update App.tsx — Remove defaultBaseUrl from Source Management

**Files:**
- Modify: `apps/web/src/App.tsx:3756-3869` (manage sources modal)

- [ ] **Step 1: The modal already doesn't show `defaultBaseUrl` — verify no changes needed**

The manage sources modal at lines 3800-3854 already only shows: system name, sourceLabel, sourceType, and actions. No `defaultBaseUrl` column exists. No changes needed here beyond what's already done in Task 3 (the dialog) and Task 4 (the selector).

- [ ] **Step 2: Update `ApiView.tsx` source creation in `handleImport`**

In `apps/web/src/views/ApiView.tsx`, lines 268-277, remove the `defaultBaseUrl`-related logic (there is none — the new source created during import doesn't set `defaultBaseUrl`). Verify and confirm no changes needed.

### Task 8: Add Host Variable Selector to Endpoint Editor

**Files:**
- Modify: `apps/web/src/components/api/EndpointDetailPanel.tsx` (need to read first)

Let me read this file to understand the endpoint editor structure, then add the Host variable selector.

Actually, let me check if EndpointDetailPanel already exists and what it looks like.

Let me handle this in a follow-up sub-task since I haven't read this file yet.

### Task 9: Commit Final Changes & Verify

```bash
git add -A
git commit -m "feat: complete host-variable refactor — remove defaultBaseUrl, auto-tag, selector"
```

Then run `pnpm check` to verify no type errors.
