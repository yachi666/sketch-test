# ApiSource Multi-System Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ApiSource` as a first-class entity to group API endpoints by source system, and add `sourceId` to variables for system-scoped configuration.

**Architecture:** New `ApiSource` type in types.ts + persistence in storage.ts + `ApiSourceDialog` for CRUD + `SourceSelector` dropdown in API management page + source-scoping in Variable dialog. Backward compatible — all new fields are optional on existing entities.

**Tech Stack:** React 19 + TypeScript strict + localStorage persistence + plain CSS (journal design system)

## Global Constraints

- All new types must follow existing patterns (Zod-compatible shapes, `EntityId` for IDs)
- New `sourceId` fields on `Variable` and `ApiVersionInfo` are optional (backward compat)
- CSS must use existing design tokens (`--brown`, `--paper-warm`, `--border-soft`, etc.)
- `ApiSource.id` format: `src-<kebab-name>` (e.g. `src-user-service`)
- Source name displayed in Chinese (e.g. "用户服务"), sourceLabel for internal/original file name
- No PostgreSQL dependencies — localStorage only for M0

## File Map

```
Create:
  apps/web/src/components/source/ApiSourceDialog.tsx   — Create/edit ApiSource modal
  apps/web/src/components/source/SourceSelector.tsx    — Dropdown for filtering by source

Modify:
  apps/web/src/types.ts                                — +ApiSource, Variable.sourceId, ApiVersionInfo.sourceId
  apps/web/src/lib/storage.ts                          — +StoredApiSource, source CRUD helpers, LS key
  apps/web/src/data.ts                                 — +apiSources seed data, link versions to sources
  apps/web/src/views/ApiView.tsx                       — +SourceSelector, source filter logic
  apps/web/src/App.tsx                                 — +sources state, handlers, pass to views
  apps/web/src/styles.css                              — +source selector & dialog styles
```

---

### Task 1: Type Definitions

**Files:**
- Modify: `apps/web/src/types.ts`

**Produces:** `ApiSource` interface, `sourceId?: EntityId` on `Variable`, `sourceId?: EntityId` on `ApiVersionInfo`

- [ ] **Step 1: Add ApiSource interface and modify Variable/ApiVersionInfo**

Add after `ApiVersionInfo` (after line 127):

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
  /** Default server URL for this source system. */
  defaultBaseUrl?: string;
  createdAt: string;
  updatedAt: string;
}
```

On `ApiVersionInfo` (line 109), add after `id: EntityId;`:
```typescript
  /** Which ApiSource this version belongs to. */
  sourceId?: EntityId;
```

On `Variable` (line 355), add after `scope: VariableScope;`:
```typescript
  /** When scope is 'source', which ApiSource this variable belongs to. */
  sourceId?: EntityId;
```

- [ ] **Step 2: Verify type check passes**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit --pretty`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/types.ts
git commit -m "feat(types): add ApiSource interface, sourceId to Variable and ApiVersionInfo"
```

---

### Task 2: Storage Layer

**Files:**
- Modify: `apps/web/src/lib/storage.ts`

**Consumes:** `ApiSource` type from Task 1
**Produces:** `StoredApiSource` interface, `loadApiSources()`, `saveApiSources()`, `saveApiSource(model)` helper

- [ ] **Step 1: Add storage key and StoredApiSource type**

Add after line 107 (`const API_ENDPOINTS_KEY`):

```typescript
const API_SOURCES_KEY = 'sketchtest.api-sources:v1';

export interface StoredApiSource {
  id: string;
  name: string;
  description?: string;
  sourceLabel: string;
  sourceType: string;
  defaultBaseUrl?: string;
  createdAt: string;
  updatedAt: string;
}
```

On `StoredApiVersion` (line 109), add after `id: string;`:
```typescript
  sourceId?: string;
```

- [ ] **Step 2: Add source CRUD functions**

Add after `saveApiImport` function (after line 172):

```typescript
export function loadApiSources(): StoredApiSource[] {
  try {
    const raw = localStorage.getItem(API_SOURCES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as StoredApiSource[];
    return [];
  } catch {
    return [];
  }
}

function saveApiSources(sources: StoredApiSource[]): void {
  try {
    localStorage.setItem(API_SOURCES_KEY, JSON.stringify(sources));
  } catch {
    // Storage full — silently ignore
  }
}

export function upsertApiSource(source: StoredApiSource): void {
  const sources = loadApiSources();
  const idx = sources.findIndex((s) => s.id === source.id);
  if (idx >= 0) {
    sources[idx] = source;
  } else {
    sources.push(source);
  }
  saveApiSources(sources);
}

export function deleteApiSource(sourceId: string): void {
  const sources = loadApiSources().filter((s) => s.id !== sourceId);
  saveApiSources(sources);
}
```

- [ ] **Step 3: Update `saveApiImport` to accept `sourceId`**

Change the function signature (line 133) from:
```typescript
export function saveApiImport(model: CanonicalApiModel): {
```
to:
```typescript
export function saveApiImport(model: CanonicalApiModel, sourceId?: string): {
```

Add `sourceId` to the `StoredApiVersion` object (around line 141):
```typescript
  const version: StoredApiVersion = {
    id: versionId,
    sourceId,              // ← add this line
    sourceType: model.metadata.sourceType,
    // ... rest unchanged
  };
```

- [ ] **Step 4: Verify type check passes**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit --pretty`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/storage.ts
git commit -m "feat(storage): add ApiSource persistence and sourceId to saveApiImport"
```

---

### Task 3: Seed Data

**Files:**
- Modify: `apps/web/src/data.ts`

**Consumes:** `ApiSource` type from Task 1, storage keys from Task 2
**Produces:** `apiSources` export, version→source links

- [ ] **Step 1: Add seed ApiSource data**

Add after `endpointDetails` or near the top exports (after line 85):

```typescript
// ─── API Sources ─────────────────────────────────────────────────

export const apiSources: import('./types').ApiSource[] = [
  {
    id: 'src-sketch-test',
    name: 'SketchTest 平台',
    description: 'SketchTest 演示用单体 API，包含用户、订单、支付接口。',
    sourceLabel: 'openapi.yaml',
    sourceType: 'openapi',
    defaultBaseUrl: 'http://localhost:3800',
    createdAt: '2026-06-15T10:00:00+08:00',
    updatedAt: '2026-06-21T14:00:00+08:00',
  },
];
```

- [ ] **Step 2: Link existing apiVersions to the source**

Update `apiVersions` array (lines 162-185) to add `sourceId`:

```typescript
export const apiVersions: ApiVersionInfo[] = [
  {
    id: 'v1',
    sourceId: 'src-sketch-test',  // ← add this
    label: 'openapi.yaml · v1.0.0',
    // ... rest unchanged
  },
  {
    id: 'v2',
    sourceId: 'src-sketch-test',  // ← add this
    label: 'openapi.yaml · v2.3.1',
    // ... rest unchanged
  },
];
```

- [ ] **Step 3: Add sourceId to seed variables**

Update `initialVariables` (lines 1456+), add `sourceId` to each:

```typescript
// userService variable:
    sourceId: 'src-sketch-test',
// paymentService variable:
    sourceId: 'src-sketch-test',
// notifyService variable:
    sourceId: 'src-sketch-test',
```

- [ ] **Step 4: Verify type check passes**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit --pretty`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/data.ts
git commit -m "feat(data): add apiSources seed data with source links"
```

---

### Task 4: ApiSourceDialog Component

**Files:**
- Create: `apps/web/src/components/source/ApiSourceDialog.tsx`

**Consumes:** `ApiSource` type from Task 1, `upsertApiSource` from Task 2
**Produces:** `<ApiSourceDialog>` component for create/edit

- [ ] **Step 1: Create the component**

```typescript
import { FloppyDisk, Plus, X } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiSource } from '../../types';
import { upsertApiSource } from '../../lib/storage';

interface ApiSourceDialogProps {
  /** Existing source to edit, or null for create mode. */
  source: ApiSource | null;
  open: boolean;
  onClose: () => void;
  onSaved: (source: ApiSource) => void;
}

function emptySource(): ApiSource {
  return {
    id: '',
    name: '',
    description: '',
    sourceLabel: '',
    sourceType: 'openapi',
    defaultBaseUrl: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function ApiSourceDialog({ source, open, onClose, onSaved }: ApiSourceDialogProps) {
  const [draft, setDraft] = useState<ApiSource>(source ?? emptySource());
  const [closing, setClosing] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const isEdit = source !== null;

  useEffect(() => {
    if (open) {
      setDraft(source ? { ...source } : emptySource());
      setTimeout(() => nameRef.current?.focus(), 100);
    }
  }, [open, source]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setClosing(true);
        setTimeout(onClose, 120);
      }
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSave = useCallback(() => {
    if (!draft.name.trim() || !draft.sourceLabel.trim()) return;
    const now = new Date().toISOString();
    const saved: ApiSource = {
      ...draft,
      id: isEdit ? draft.id : `src-${Date.now()}`,
      name: draft.name.trim(),
      sourceLabel: draft.sourceLabel.trim(),
      createdAt: isEdit ? draft.createdAt : now,
      updatedAt: now,
    };
    upsertApiSource({
      id: saved.id,
      name: saved.name,
      description: saved.description,
      sourceLabel: saved.sourceLabel,
      sourceType: saved.sourceType,
      defaultBaseUrl: saved.defaultBaseUrl,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    });
    onSaved(saved);
    setClosing(true);
    setTimeout(onClose, 120);
  }, [draft, isEdit, onClose, onSaved]);

  if (!open) return null;

  return (
    <div
      className={`endpoint-dialog-overlay${closing ? ' endpoint-dialog-overlay--closing' : ''}`}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          setClosing(true);
          setTimeout(onClose, 120);
        }
      }}
    >
      <div
        className={`endpoint-dialog${closing ? ' endpoint-dialog--closing' : ''}`}
        style={{ maxWidth: '520px' }}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? '编辑系统' : '新建系统'}
      >
        {/* Title bar */}
        <div className="endpoint-dialog-titlebar">
          <div className="endpoint-dialog-titlebar-left">
            <span className="endpoint-dialog-titlebar-icon">
              <Plus size={16} weight="bold" />
            </span>
            <h2>{isEdit ? '编辑系统' : '新建系统'}</h2>
          </div>
          <div className="endpoint-dialog-titlebar-right">
            <button className="icon-button" type="button" onClick={() => { setClosing(true); setTimeout(onClose, 120); }} aria-label="关闭">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="endpoint-dialog-identity">
          <label className="modal-field" style={{ display: 'block', marginBottom: 14 }}>
            <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 }}>系统名称 *</span>
            <input
              ref={nameRef}
              className="input input--summary"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="例如：用户服务"
              style={{ margin: 0 }}
            />
          </label>

          <label className="modal-field" style={{ display: 'block', marginBottom: 14 }}>
            <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 }}>来源标识 *</span>
            <input
              className="input input--path"
              value={draft.sourceLabel}
              onChange={(e) => setDraft((d) => ({ ...d, sourceLabel: e.target.value }))}
              placeholder="例如：user-service.yaml"
              style={{ display: 'block', width: '100%' }}
            />
          </label>

          <label className="modal-field" style={{ display: 'block', marginBottom: 14 }}>
            <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 }}>默认 Base URL</span>
            <input
              className="input input--path"
              value={draft.defaultBaseUrl ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, defaultBaseUrl: e.target.value || undefined }))}
              placeholder="例如：http://localhost:8080"
              style={{ display: 'block', width: '100%' }}
            />
          </label>

          <label className="modal-field" style={{ display: 'block', marginBottom: 14 }}>
            <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 }}>类型</span>
            <select
              className="input input--method"
              value={draft.sourceType}
              onChange={(e) => setDraft((d) => ({ ...d, sourceType: e.target.value as ApiSource['sourceType'] }))}
              style={{ width: '100%', fontSize: '0.82rem', fontWeight: 400 }}
            >
              <option value="openapi">OpenAPI</option>
              <option value="raml">RAML</option>
              <option value="manual">手动录入</option>
            </select>
          </label>

          <label className="modal-field" style={{ display: 'block', marginBottom: 0 }}>
            <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 }}>描述</span>
            <textarea
              className="input input--desc"
              value={draft.description ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value || undefined }))}
              placeholder="可选描述"
              rows={2}
            />
          </label>
        </div>

        {/* Footer */}
        <div className="endpoint-dialog-footer">
          <div className="endpoint-dialog-footer-left" />
          <div className="endpoint-dialog-footer-right">
            <button className="button button--ghost button--sm" type="button" onClick={() => { setClosing(true); setTimeout(onClose, 120); }}>
              取消
            </button>
            <button
              className="button button--primary button--sm"
              type="button"
              disabled={!draft.name.trim() || !draft.sourceLabel.trim()}
              onClick={handleSave}
            >
              <FloppyDisk size={15} />
              {isEdit ? '保存' : '创建'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify type check passes**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit --pretty`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/source/ApiSourceDialog.tsx
git commit -m "feat(ui): add ApiSourceDialog for create/edit API source"
```

---

### Task 5: SourceSelector Component

**Files:**
- Create: `apps/web/src/components/source/SourceSelector.tsx`

**Consumes:** `ApiSource` type from Task 1
**Produces:** `<SourceSelector>` dropdown component

- [ ] **Step 1: Create the component**

```typescript
import { CaretDown, Database, Gear } from '@phosphor-icons/react';
import type { ApiSource } from '../../types';

interface SourceSelectorProps {
  sources: ApiSource[];
  selectedSourceId: string | null;
  onSelect: (sourceId: string | null) => void;
  onManage: () => void;
}

export function SourceSelector({
  sources,
  selectedSourceId,
  onSelect,
  onManage,
}: SourceSelectorProps) {
  const selected = sources.find((s) => s.id === selectedSourceId);

  return (
    <div className="source-selector">
      <Database size={16} weight="fill" />
      <select
        className="source-select"
        value={selectedSourceId ?? ''}
        onChange={(e) => onSelect(e.target.value || null)}
        aria-label="选择 API 系统"
      >
        <option value="">全部系统 ({sources.reduce((sum, s) => sum + 0, sources.length)} 个)</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.sourceLabel})
          </option>
        ))}
      </select>
      <button
        className="source-manage-btn"
        type="button"
        onClick={onManage}
        title="管理系统"
        aria-label="管理系统"
      >
        <Gear size={15} />
      </button>
      {selected?.defaultBaseUrl ? (
        <span className="source-baseurl">{selected.defaultBaseUrl}</span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/source/SourceSelector.tsx
git commit -m "feat(ui): add SourceSelector dropdown component"
```

---

### Task 6: App.tsx State Integration

**Files:**
- Modify: `apps/web/src/App.tsx`

**Consumes:** ApiSourceDialog (Task 4), types (Task 1), storage (Task 2)
**Produces:** `apiSources` state, CRUD handlers, source dialog trigger

- [ ] **Step 1: Add imports**

Add near line 72 (after data imports):
```typescript
import { ApiSourceDialog } from './components/source/ApiSourceDialog';
import { loadApiSources, upsertApiSource } from './lib/storage';
```

Add to the data.ts import (line 73):
```typescript
  apiSources as initialSources,
```

- [ ] **Step 2: Add state**

Add after line 3237 (`apiDetails` state):
```typescript
  const [apiSources, setApiSources] = useState<ApiSource[]>(() => {
    const stored = loadApiSources();
    if (stored.length > 0) return stored as ApiSource[];
    return initialSources;
  });
```

- [ ] **Step 3: Add source dialog state**

Add after `apiSources` state:
```typescript
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<ApiSource | null>(null);
```

- [ ] **Step 4: Add handlers**

Add after `handleCreateSchema`:
```typescript
  const handleOpenSourceDialog = useCallback((source: ApiSource | null) => {
    setEditingSource(source);
    setSourceDialogOpen(true);
  }, []);

  const handleSourceSaved = useCallback((saved: ApiSource) => {
    setApiSources((prev) => {
      const idx = prev.findIndex((s) => s.id === saved.id);
      const next = idx >= 0
        ? prev.map((s) => (s.id === saved.id ? saved : s))
        : [...prev, saved];
      return next;
    });
  }, []);

  const handleDeleteSource = useCallback((sourceId: string) => {
    setApiSources((prev) => prev.filter((s) => s.id !== sourceId));
    // Note: cascading delete of versions/endpoints is out of scope for M0
  }, []);
```

- [ ] **Step 5: Pass sources to ApiView**

Update ApiView props (line 3490):
```typescript
      <ApiView
        sources={apiSources}                          // ← add
        endpoints={apiEndpoints}
        versions={apiVersions}
        // ... rest unchanged
      />
```

- [ ] **Step 6: Render ApiSourceDialog**

Add near the other dialogs (before `</>` return):
```typescript
      <ApiSourceDialog
        source={editingSource}
        open={sourceDialogOpen}
        onClose={() => setSourceDialogOpen(false)}
        onSaved={handleSourceSaved}
      />
```

Also add a "管理系统" entry point — add a state for showing source list, or add an inline source list panel. For M0 simplicity, add a ManageSourcesView.

Actually, let's keep it simpler: Add a `ManageSourcesDialog` inline. When the user clicks "管理" in SourceSelector, show a simple list dialog. For M0, this can be a lightweight list with edit/delete buttons.

Add after `sourceDialogOpen` state:
```typescript
  const [manageSourcesOpen, setManageSourcesOpen] = useState(false);
```

Add handler:
```typescript
  const handleManageSources = useCallback(() => {
    setManageSourcesOpen(true);
  }, []);
```

Add a Manage Sources dialog (simple modal with list), or better — wire SourceSelector's onManage to open the create dialog for now, and show a lightweight source list.

For M0 simplicity: SourceSelector.onManage → opens source list inline. Let's create a compact `SourceListView` component rendered in App.tsx when `manageSourcesOpen` is true.

- [ ] **Step 7: Verify type check passes**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit --pretty`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(app): integrate ApiSource state, dialog, and pass to views"
```

---

### Task 7: ApiView — Source Filter Integration

**Files:**
- Modify: `apps/web/src/views/ApiView.tsx`

**Consumes:** `ApiSource` type (Task 1), `SourceSelector` (Task 5)
**Produces:** Source-filtered endpoint list in API management page

- [ ] **Step 1: Update ApiViewProps**

Add `sources` and source management callback:
```typescript
interface ApiViewProps {
  sources: ApiSource[];          // ← add
  onManageSources: () => void;   // ← add
  // ... existing props unchanged
}
```

- [ ] **Step 2: Add source filter state**

Add after `selectedEndpointId` state (line 108):
```typescript
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
```

- [ ] **Step 3: Filter endpoints by source**

Modify the page header (after line 408) to include SourceSelector:

```typescript
<div className="page-intro">
  <div>
    <span className="eyebrow">API CATALOG</span>
    <h2>接口资产</h2>
    <p>管理接口定义，支持从 OpenAPI 导入或手动录入。</p>
  </div>
  <div className="page-intro-actions">
    <SourceSelector
      sources={sources}
      selectedSourceId={selectedSourceId}
      onSelect={setSelectedSourceId}
      onManage={onManageSources}
    />
    {/* ... existing buttons unchanged */}
  </div>
</div>
```

- [ ] **Step 4: Filter endpoints in allEndpoints**

Modify `allEndpoints` useMemo to filter by selected source:

```typescript
  const allEndpoints = useMemo(() => {
    const merged = [...endpoints, ...importedEndpoints];
    if (!selectedSourceId) return merged;
    // Filter endpoints whose version belongs to the selected source
    const sourceVersionIds = new Set(
      allVersions
        .filter((v) => v.sourceId === selectedSourceId)
        .map((v) => v.id)
    );
    return merged.filter((ep) => ep.versionId && sourceVersionIds.has(ep.versionId));
  }, [endpoints, importedEndpoints, selectedSourceId, allVersions]);
```

- [ ] **Step 5: Verify type check and lint**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit --pretty && npx biome check apps/web/src/views/ApiView.tsx --no-errors-on-unmatched`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/views/ApiView.tsx
git commit -m "feat(api-view): add source filter with SourceSelector dropdown"
```

---

### Task 8: Import Flow — Source Selection

**Files:**
- Modify: `apps/web/src/types/import.ts` — add `sourceId` to ImportConfig
- Modify: `apps/web/src/components/api/ImportDialog.tsx` — add source selector
- Modify: `apps/web/src/views/ApiView.tsx` — pass sourceId through import handler
- Modify: `apps/web/src/lib/storage.ts` — already updated (Task 2)

**Consumes:** `ApiSource` type (Task 1), `saveApiImport` with sourceId (Task 2)
**Produces:** Import dialog with source selection

- [ ] **Step 1: Add sourceId to ImportConfig**

In `apps/web/src/types/import.ts`, add after `conflictStrategy` (line 28):

```typescript
  /** Which ApiSource this import belongs to. If empty, creates a new source. */
  sourceId?: string;
  /** Name for a new ApiSource when sourceId is not provided. */
  newSourceName?: string;
```

- [ ] **Step 2: Add source selector to ImportDialog**

In `apps/web/src/components/api/ImportDialog.tsx`:

Add import:
```typescript
import type { ApiSource } from '../../types';
```

Add to `ImportDialogProps`:
```typescript
  sources: ApiSource[];
```

Add state inside the component:
```typescript
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [newSourceName, setNewSourceName] = useState('');
```

Add source selector UI in the import form (before the conflict strategy section):

```tsx
<div className="modal-field">
  <label className="field-label">所属系统</label>
  <select
    value={selectedSourceId}
    onChange={(e) => setSelectedSourceId(e.target.value)}
    className="input"
  >
    <option value="">新建系统...</option>
    {sources.map((s) => (
      <option key={s.id} value={s.id}>{s.name} ({s.sourceLabel})</option>
    ))}
  </select>
  {selectedSourceId === '' && (
    <input
      className="input"
      value={newSourceName}
      onChange={(e) => setNewSourceName(e.target.value)}
      placeholder="新系统名称，例如：支付服务"
      style={{ marginTop: 8 }}
    />
  )}
</div>
```

Update the config construction (line 114) to include:
```typescript
    sourceId: selectedSourceId || undefined,
    newSourceName: selectedSourceId === '' ? newSourceName : undefined,
```

- [ ] **Step 3: Update ApiView to pass sources to ImportDialog**

In `apps/web/src/views/ApiView.tsx`, update ImportDialog rendering (line 513):

```tsx
      <ImportDialog
        open={importOpen}
        sources={sources}             // ← add
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
      />
```

- [ ] **Step 4: Handle new source creation in ApiView import handler**

In the `handleImport` callback (line 246), before calling `startImport(config)`, create the new source if `newSourceName` is provided:

```typescript
  const handleImport = useCallback(
    (config: ImportConfig) => {
      importConfigRef.current = config;
      setImportErrorMessage(null);
      setImportedEndpoints([]);
      setImportedVersions([]);

      // Create new source if needed
      if (!config.sourceId && config.newSourceName) {
        const sourceId = `src-${Date.now()}`;
        const newSource = {
          id: sourceId,
          name: config.newSourceName,
          sourceLabel: config.fileName,
          sourceType: 'openapi' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        // Store sourceId in config for downstream use
        config = { ...config, sourceId };
        // Add to local sources state via callback
        onSourceCreated?.(newSource);
      }

      startImport(config);
    },
    [startImport, onSourceCreated],
  );
```

- [ ] **Step 5: Update ApiViewProps to accept sources and source callback**

Add to interface:
```typescript
  sources: ApiSource[];
  onSourceCreated?: (source: ApiSource) => void;
```

- [ ] **Step 6: Wire sourceId into saveApiImport call**

In the import completion effect (line 325), pass sourceId:

```typescript
    const config = importConfigRef.current;
    const { versionId, endpointCount } = saveApiImport(model, config?.sourceId);
```

- [ ] **Step 7: Update App.tsx ApiView props**

Pass `sources` and `onSourceCreated` handler.

- [ ] **Step 8: Verify type check and lint**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit --pretty && npx biome check apps/web/src/ --no-errors-on-unmatched`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/types/import.ts apps/web/src/components/api/ImportDialog.tsx apps/web/src/views/ApiView.tsx apps/web/src/App.tsx
git commit -m "feat(import): add source selection to ImportDialog and import flow"
````

---

### Task 9: CSS Styling

**Files:**
- Modify: `apps/web/src/styles.css`

**Consumes:** SourceSelector (Task 5), ApiSourceDialog class references (Task 4)

- [ ] **Step 1: Add source selector styles**

Add before the endpoint detail section (~line 4791):

```css
/* ─── Source Selector ─────── */

.source-selector {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  background: var(--paper-warm);
  border: 1px solid var(--border);
  border-radius: 8px 14px 9px 12px;
}

.source-select {
  border: none;
  background: transparent;
  font-family: var(--font-body);
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--ink);
  cursor: pointer;
  outline: none;
  min-width: 160px;
}

.source-select:hover {
  color: var(--brown);
}

.source-manage-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s;
}

.source-manage-btn:hover {
  background: var(--brown-soft);
  color: var(--brown);
}

.source-baseurl {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--muted);
  padding-left: 8px;
  border-left: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "feat(css): add SourceSelector and source management styles"
```

---

### Task 10: VariablesView — Source Scope & Filter

**Files:**
- Modify: `apps/web/src/App.tsx` — `VariablesView` function (line 2716), `VariableDialog` (line 2337)

**Consumes:** `ApiSource` type (Task 1), `sourceId` on Variable (Task 1)
**Produces:** Source filter dropdown in variables page, source picker in VariableDialog

- [ ] **Step 1: Add `sources` prop to VariablesView**

Update the function signature (line 2716):

```typescript
function VariablesView({
  sources,       // ← add
  variables,
  environments,
  activeEnvironmentId,
  onCreate,
  onUpdate,
  onDelete,
}: {
  sources: ApiSource[];        // ← add
  variables: Variable[];
  environments: Environment[];
  activeEnvironmentId: string;
  onCreate: (v: Variable) => void;
  onUpdate: (v: Variable) => void;
  onDelete: (id: string) => void;
}) {
```

- [ ] **Step 2: Add source filter state and dropdown**

Add after `scopeFilter` state (line 2733):

```typescript
  const [sourceFilter, setSourceFilter] = useState<string>('');
```

Add source filter dropdown in the filter bar (alongside typeFilter/scopeFilter):

```tsx
<select
  value={sourceFilter}
  onChange={(e) => setSourceFilter(e.target.value)}
  className="source-select"
  aria-label="按系统筛选"
  style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: '0.72rem', color: 'var(--muted)', background: 'var(--paper)' }}
>
  <option value="">全部系统</option>
  <option value="__global__">全局变量</option>
  {sources.map((s) => (
    <option key={s.id} value={s.id}>{s.name}</option>
  ))}
</select>
```

- [ ] **Step 3: Add source filter to filtered variables**

Update the filter logic (after line 2774):

```typescript
    const matchesSource =
      sourceFilter === '' ? true :
      sourceFilter === '__global__' ? !v.sourceId :
      v.sourceId === sourceFilter;
```

Add `matchesSource` to the filter condition:
```typescript
    return matchesQuery && matchesType && matchesScope && matchesSource;
```

- [ ] **Step 4: Add source picker to VariableDialog**

In the `VariableDialog` (around line 2510, after the scope selector), add a source picker visible when scope is `environment` or `source`:

```tsx
{(draft.scope === 'environment' || draft.scope === 'source') && (
  <div className="modal-field">
    <label className="field-label">所属系统</label>
    <select
      value={draft.sourceId ?? ''}
      onChange={(e) => setDraft({ ...draft, sourceId: e.target.value || undefined })}
      className="input"
    >
      <option value="">全局（不限系统）</option>
      {apiSources.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  </div>
)}
```

Note: `apiSources` needs to be accessible inside `VariableDialog`. Either pass it as a prop or use the state from the outer scope. Since `VariableDialog` is defined within `App`, it already has access to `apiSources` state.

- [ ] **Step 5: Pass sources to VariablesView in App.tsx**

In the render section (line 3581):
```typescript
      <VariablesView
        sources={apiSources}              // ← add
        variables={variables}
        environments={environments}
        // ... rest unchanged
      />
```

- [ ] **Step 6: Verify type check and lint**

Run: `npx tsc -p apps/web/tsconfig.json --noEmit --pretty && npx biome check apps/web/src/App.tsx --no-errors-on-unmatched`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(variables): add source filter and sourceId to VariableDialog"
```

---

### Task 11: Integration Verification

**Files:**
- No code changes — runtime verification

**Consumes:** All tasks above
**Produces:** Verification report

- [ ] **Step 1: Build the app**

Run: `pnpm build --filter web`
Expected: build succeeds

- [ ] **Step 2: Start production server**

Run: `pnpm dev:web`
Expected: Vite dev server starts on port 5173

- [ ] **Step 3: Manual verification checklist**

- [ ] Navigate to API 管理 page → SourceSelector dropdown visible with "全部系统"
- [ ] Click "管理" gear icon → source management opens
- [ ] Create new source "支付服务" → appears in dropdown
- [ ] Select source → endpoint list filters
- [ ] Open VariableDialog → source picker visible when scope=environment
- [ ] Create variable with sourceId → variable list filters correctly

- [ ] **Step 4: Commit verification evidence**

```bash
git add -A
git commit -m "test: verification evidence for ApiSource integration"
```
