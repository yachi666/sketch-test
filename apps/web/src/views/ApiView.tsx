import { CheckCircle, FileArrowUp, GitBranch, Plus } from '@phosphor-icons/react';
import type { CanonicalApiModel } from '@sketch-test/canonical-api-model';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiTable } from '../components/api/ApiTable';
import {
  type ConflictResolution,
  ConflictResolutionDialog,
  type EndpointConflict,
} from '../components/api/ConflictResolutionDialog';
import { EndpointDetailPanel, type PanelMode } from '../components/api/EndpointDetailPanel';
import { ImportDialog } from '../components/api/ImportDialog';
import { ImportProgressBar } from '../components/api/ImportProgressBar';
import { VersionDiffDialog } from '../components/api/VersionDiffDialog';
import { SourceSelector } from '../components/source/SourceSelector';
import { useImportWorker } from '../hooks/useImportWorker';
import { saveApiImport } from '../lib/storage';
import type {
  ApiEndpoint,
  ApiSource,
  ApiVersionDiff,
  ApiVersionInfo,
  EndpointDetail,
  SchemaDisplayNode,
  Variable,
} from '../types';
import type { ImportConfig } from '../types/import';

/**
 * Empty endpoint template used when creating a new endpoint.
 * `endpointId` is empty — the actual ID is assigned by the parent on save.
 */
function emptyEndpointDetail(): EndpointDetail {
  return {
    endpointId: '',
    method: 'GET',
    path: '',
    summary: '',
    description: '',
    deprecated: false,
    tags: [],
    parameters: [],
    requestBodies: [],
    responses: [],
    security: [],
    hostVariableId: undefined,
  };
}

function detailFromEndpoint(
  ep: ApiEndpoint,
  details: Record<string, EndpointDetail>,
): EndpointDetail {
  const existing = details[ep.id];
  if (existing) return existing;
  // Fallback: construct a minimal detail from the endpoint metadata
  return {
    endpointId: ep.id,
    method: ep.method,
    path: ep.path,
    summary: ep.summary,
    description: ep.description,
    deprecated: ep.deprecated,
    tags: ep.tags,
    parameters: [],
    requestBodies: [],
    responses: [],
    hostVariableId: undefined,
  };
}

interface ApiViewProps {
  sources: ApiSource[];
  endpoints: ApiEndpoint[];
  versions: ApiVersionInfo[];
  details: Record<string, EndpointDetail>;
  schemas: Record<string, SchemaDisplayNode>;
  diff: ApiVersionDiff | null;
  imported: boolean;
  variables: Variable[];
  activeEnvironmentId: string;
  onImport: (config: ImportConfig) => void;
  onCreate: (endpoint: ApiEndpoint, detail: EndpointDetail) => void;
  onUpdate: (endpoint: ApiEndpoint, detail: EndpointDetail) => void;
  onDelete: (endpointId: string) => void;
  onAddToWorkflow?: (endpointId: string) => void;
  onCreateSchema?: (schema: SchemaDisplayNode) => void;
  onCreateVariable?: (v: Variable) => void;
  onManageSources?: () => void;
  onSourceCreated?: (source: ApiSource) => void;
}

/**
 * API Management (接口管理) main view.
 *
 * Composes the API catalog table, endpoint detail panel (view/edit/create modes),
 * import dialog, and version diff dialog.
 *
 * Architecture: This module is the seam between the App shell and the
 * API-specific component tree. It manages the selected endpoint and panel mode,
 * delegating rendering to focused sub-components.
 */
export function ApiView({
  sources,
  endpoints,
  versions,
  details,
  schemas,
  diff,
  imported,
  variables,
  activeEnvironmentId,
  onImport,
  onCreate,
  onUpdate,
  onDelete,
  onAddToWorkflow,
  onCreateSchema,
  onCreateVariable,
  onManageSources,
  onSourceCreated,
}: ApiViewProps) {
  const [importOpen, setImportOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>('view');
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  // ── Import worker state ──

  const {
    startImport,
    progress,
    result,
    error: importError,
    cancel,
    isRunning,
  } = useImportWorker();
  const [importedEndpoints, setImportedEndpoints] = useState<ApiEndpoint[]>([]);
  const [importedVersions, setImportedVersions] = useState<ApiVersionInfo[]>([]);
  const [conflicts, setConflicts] = useState<EndpointConflict[]>([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [importErrorMessage, setImportErrorMessage] = useState<string | null>(null);
  const [pendingImportData, setPendingImportData] = useState<{
    endpoints: ApiEndpoint[];
    version: ApiVersionInfo;
  } | null>(null);
  const importConfigRef = useRef<ImportConfig | null>(null);

  // ── Derived state ──

  const allVersions = useMemo(
    () => [...versions, ...importedVersions],
    [versions, importedVersions],
  );
  const allEndpoints = useMemo(() => {
    const merged = [...endpoints, ...importedEndpoints];
    if (!selectedSourceId) return merged;
    // Filter endpoints whose version belongs to the selected source
    const sourceVersionIds = new Set(
      allVersions.filter((v) => v.sourceId === selectedSourceId).map((v) => v.id),
    );
    return merged.filter((ep) => ep.versionId && sourceVersionIds.has(ep.versionId));
  }, [endpoints, importedEndpoints, selectedSourceId, allVersions]);
  const activeVersion = useMemo(() => allVersions.find((v) => v.isActive) ?? null, [allVersions]);

  // Host-tagged variables available for endpoint base URL selection
  const hostVariables = useMemo(
    () => variables.filter((v) => v.tags?.includes('host')),
    [variables],
  );

  // Resolve the current detail based on mode
  const currentDetail = useMemo(() => {
    if (panelMode === 'create') return emptyEndpointDetail();
    if (!selectedEndpointId) return null;
    const ep = allEndpoints.find((e) => e.id === selectedEndpointId);
    if (!ep) return null;
    return detailFromEndpoint(ep, details);
  }, [panelMode, selectedEndpointId, allEndpoints, details]);

  // ── Handlers ──

  const handleViewDetail = useCallback((id: string) => {
    setSelectedEndpointId(id);
    setPanelMode('view');
  }, []);

  const handleEdit = useCallback((id: string) => {
    setSelectedEndpointId(id);
    setPanelMode('edit');
  }, []);

  const handleCreate = useCallback(() => {
    setSelectedEndpointId(null);
    setPanelMode('create');
  }, []);

  const handleClose = useCallback(() => {
    setSelectedEndpointId(null);
    setPanelMode('view');
  }, []);

  const handleSave = useCallback(
    (detail: EndpointDetail) => {
      if (panelMode === 'create') {
        // Generate a new ID
        const id = `e${Date.now()}`;
        const endpoint: ApiEndpoint = {
          id,
          method: detail.method,
          path: detail.path,
          summary: detail.summary,
          description: detail.description,
          coverage: 0,
          cases: 0,
          tags: detail.tags,
          deprecated: detail.deprecated,
          versionId: activeVersion?.id,
        };
        onCreate(endpoint, { ...detail, endpointId: id });
        setSelectedEndpointId(id);
        setPanelMode('view');
      } else if (selectedEndpointId) {
        const endpoint: ApiEndpoint = {
          id: selectedEndpointId,
          method: detail.method,
          path: detail.path,
          summary: detail.summary,
          description: detail.description,
          coverage: allEndpoints.find((e) => e.id === selectedEndpointId)?.coverage ?? 0,
          cases: allEndpoints.find((e) => e.id === selectedEndpointId)?.cases ?? 0,
          tags: detail.tags,
          deprecated: detail.deprecated,
          versionId: activeVersion?.id,
        };
        onUpdate(endpoint, { ...detail, endpointId: selectedEndpointId });
        setPanelMode('view');
      }
    },
    [panelMode, selectedEndpointId, activeVersion, allEndpoints, onCreate, onUpdate],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
    },
    [onDelete],
  );

  const handleAddToWorkflow = useCallback(
    (endpointId: string) => {
      setSelectedEndpointId(null);
      onAddToWorkflow?.(endpointId);
    },
    [onAddToWorkflow],
  );

  /** Create a Host-tagged variable from a manually entered URL. */
  const handleCreateHostVariable = useCallback(
    (url: string): Variable => {
      // Derive a variable name from the URL hostname
      let hostname = '';
      try {
        hostname = new URL(url).hostname;
      } catch {
        hostname = url
          .replace(/^https?:\/\//, '')
          .split('/')[0]
          .split(':')[0];
      }
      const varName =
        hostname
          .split('.')[0]
          .replace(/[^a-zA-Z0-9]/g, '_')
          .replace(/^[_0-9]+/, '')
          .replace(/^_/, '') || `host_${Date.now()}`;

      // Ensure unique name by appending suffix if needed
      const existingNames = new Set(variables.map((v) => v.name));
      let uniqueName = varName;
      let suffix = 1;
      while (existingNames.has(uniqueName)) {
        uniqueName = `${varName}_${suffix}`;
        suffix += 1;
      }

      const now = new Date().toISOString();
      const newVar: Variable = {
        id: `var-${Date.now()}`,
        name: uniqueName,
        defaultValue: url,
        overrides: {},
        type: 'plain',
        scope: 'environment',
        sourceId: selectedSourceId ?? undefined,
        tags: ['host'],
        sensitive: false,
        description: `自动创建的 Host 变量，指向 ${url}`,
        updatedAt: now,
        updatedBy: 'system',
        usedIn: [],
      };

      onCreateVariable?.(newVar);
      return newVar;
    },
    [variables, selectedSourceId, onCreateVariable],
  );

  // ── Import handlers ──

  /** Called by ImportDialog when the user initiates an import. */
  const handleImport = useCallback(
    (config: ImportConfig) => {
      importConfigRef.current = config;
      setImportErrorMessage(null);
      setImportedEndpoints([]);
      setImportedVersions([]);

      // Create new source if needed
      if (!config.sourceId && config.newSourceName) {
        const sourceId = `src-${Date.now()}`;
        const newSource: ApiSource = {
          id: sourceId,
          name: config.newSourceName,
          sourceLabel: config.fileName || 'imported-api',
          sourceType: 'openapi' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        // Store sourceId in config for downstream use
        importConfigRef.current = { ...config, sourceId };
        // Add to local sources state via callback
        onSourceCreated?.(newSource);
        startImport({ ...config, sourceId });
      } else {
        startImport(config);
      }
    },
    [startImport, onSourceCreated],
  );

  /** Apply the imported data to local state and signal the parent. */
  const applyImportedData = useCallback(
    (newEndpoints: ApiEndpoint[], newVersion: ApiVersionInfo) => {
      setImportedEndpoints((prev) => [...prev, ...newEndpoints]);
      setImportedVersions((prev) => [...prev, newVersion]);
      if (importConfigRef.current) onImport(importConfigRef.current);
    },
    [onImport],
  );

  /** Apply conflict resolution choices and finalize the import. */
  const handleConflictResolve = useCallback(
    (resolutions: Map<string, ConflictResolution>) => {
      if (!pendingImportData) return;
      const { endpoints: newEndpoints, version: newVersion } = pendingImportData;
      const finalEndpoints = newEndpoints.filter((ep) => {
        const resolution = resolutions.get(ep.id);
        return resolution !== 'skip';
      });
      applyImportedData(finalEndpoints, newVersion);
      setShowConflictDialog(false);
      setPendingImportData(null);
    },
    [pendingImportData, applyImportedData],
  );

  // Watch the import worker for completion
  useEffect(() => {
    if (!result) return;

    const importResult = result as {
      success: boolean;
      model?: {
        schemaVersion: string;
        metadata: {
          sourceId: string;
          sourceType: string;
          sourceLabel: string;
          sourceVersion: string;
          sourceHash: string;
          parserName: string;
          parserVersion: string;
          ingestedAt: string;
        };
        servers: Array<Record<string, unknown>>;
        securitySchemes: Array<Record<string, unknown>>;
        endpoints: Array<{
          id: string;
          method: string;
          path: string;
          summary?: string;
          description?: string;
          deprecated: boolean;
          tags?: string[];
        }>;
        schemas: Record<string, unknown>;
        diagnostics: Array<{ message: string }>;
      };
      diagnostics?: Array<{ message: string }>;
    };

    if (!importResult.success || !importResult.model) {
      const msg = importResult.diagnostics?.[0]?.message || '导入失败：无法解析文档';
      setImportErrorMessage(msg);
      return;
    }

    const model = importResult.model as unknown as CanonicalApiModel;
    const config = importConfigRef.current;
    const { versionId, endpointCount } = saveApiImport(model, config?.sourceId);

    const newEndpoints: ApiEndpoint[] = model.endpoints.map((ep) => ({
      id: ep.id as ApiEndpoint['id'],
      method: ep.method as ApiEndpoint['method'],
      path: ep.path,
      summary: ep.summary || '',
      description: ep.description,
      coverage: 0,
      cases: 0,
      tags: ep.tags || [],
      deprecated: ep.deprecated,
      versionId: versionId as ApiEndpoint['versionId'],
    }));

    const newVersion: ApiVersionInfo = {
      id: versionId,
      sourceId: config?.sourceId,
      label: `${model.metadata.sourceLabel} · v${model.metadata.sourceVersion}`,
      sourceType: model.metadata.sourceType as ApiVersionInfo['sourceType'],
      fileName: model.metadata.sourceLabel,
      version: model.metadata.sourceVersion,
      endpointCount,
      schemaCount: Object.keys(model.schemas || {}).length,
      importedAt: new Date().toISOString(),
      isActive: false,
    };

    // Detect conflicts with existing endpoints
    const existingIds = new Set(allEndpoints.map((e) => e.id));
    const conflictingEps = newEndpoints.filter((ep) => existingIds.has(ep.id));

    // Show conflict resolution dialog when strategy is 'decide-per-item'
    if (conflictingEps.length > 0 && config?.conflictStrategy === 'decide-per-item') {
      setConflicts(
        conflictingEps.map((ep) => ({
          endpointId: ep.id,
          existing: {
            summary: allEndpoints.find((e) => e.id === ep.id)?.summary || '',
            sourceType: 'existing',
            versionLabel: 'Previously imported',
          },
          incoming: {
            summary: ep.summary,
            sourceLabel: model.metadata.sourceLabel,
          },
        })),
      );
      setPendingImportData({ endpoints: newEndpoints, version: newVersion });
      setShowConflictDialog(true);
      return;
    }

    // Apply with conflict strategy
    const strategy = config?.conflictStrategy || 'skip';
    const finalEndpoints =
      strategy === 'skip' ? newEndpoints.filter((ep) => !existingIds.has(ep.id)) : newEndpoints;

    applyImportedData(finalEndpoints, newVersion);
  }, [result, allEndpoints, applyImportedData]);

  // Clear import error when starting a new import
  useEffect(() => {
    if (isRunning) {
      setImportErrorMessage(null);
    }
  }, [isRunning]);

  // Show error from the hook
  useEffect(() => {
    if (importError) {
      setImportErrorMessage(importError);
    }
  }, [importError]);

  return (
    <main className="page-view">
      {/* Page header */}
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
            onManage={onManageSources ?? (() => {})}
          />
          <button
            className="button button--outline"
            type="button"
            onClick={() => setDiffOpen(true)}
          >
            <GitBranch size={17} />
            比较版本
          </button>
          <button className="button button--outline" type="button" onClick={handleCreate}>
            <Plus size={17} />
            新建接口
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={() => setImportOpen(true)}
          >
            <FileArrowUp size={18} />
            导入文档
          </button>
        </div>
      </div>

      {/* Import error banner */}
      {importErrorMessage ? (
        <div className="notice notice--danger">
          <span>导入失败：{importErrorMessage}</span>
        </div>
      ) : null}

      {/* Import success banner */}
      {imported ? (
        <div className="notice notice--success">
          <CheckCircle size={20} weight="fill" />
          <span>
            <strong>openapi.yaml 已导入</strong>
            {activeVersion
              ? `· 已识别 ${activeVersion.endpointCount} 个接口和 ${activeVersion.schemaCount} 个 Schema`
              : '已识别 6 个接口和 18 个 Schema'}
          </span>
        </div>
      ) : null}

      {/* Import progress modal */}
      {isRunning && progress ? (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-label="导入进度">
            <div className="modal-heading">
              <div>
                <span className="eyebrow">IMPORTING</span>
                <h2>正在导入...</h2>
              </div>
            </div>
            <div className="modal-body">
              <ImportProgressBar
                current={progress.current}
                total={progress.total}
                phase={progress.phase}
              />
            </div>
            <div className="modal-actions">
              <button className="button button--ghost" type="button" onClick={cancel}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Conflict resolution dialog */}
      <ConflictResolutionDialog
        open={showConflictDialog}
        conflicts={conflicts}
        onResolve={handleConflictResolve}
        onClose={() => setShowConflictDialog(false)}
      />

      {/* Main catalog table */}
      <ApiTable
        endpoints={allEndpoints}
        activeVersion={activeVersion}
        onViewDetail={handleViewDetail}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      {/* Endpoint detail panel (slide-over) — view / edit / create */}
      {currentDetail ? (
        <EndpointDetailPanel
          detail={currentDetail}
          mode={panelMode}
          schemas={schemas}
          existingIds={allEndpoints.map((e) => e.id)}
          hostVariables={hostVariables}
          activeEnvironmentId={activeEnvironmentId}
          onCreateHostVariable={onCreateVariable ? handleCreateHostVariable : undefined}
          onSave={handleSave}
          onDelete={panelMode === 'edit' ? handleDelete : undefined}
          onAddToWorkflow={panelMode === 'view' ? handleAddToWorkflow : undefined}
          onClose={handleClose}
          onCreateSchema={onCreateSchema}
        />
      ) : null}

      {/* Import dialog */}
      <ImportDialog
        open={importOpen}
        sources={sources}
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
      />

      {/* Version diff dialog */}
      <VersionDiffDialog open={diffOpen} diff={diff} onClose={() => setDiffOpen(false)} />
    </main>
  );
}
