import { CheckCircle, FileArrowUp, GitBranch, Plus } from '@phosphor-icons/react';
import { useCallback, useMemo, useState } from 'react';
import { ApiTable } from '../components/api/ApiTable';
import { EndpointDetailPanel, type PanelMode } from '../components/api/EndpointDetailPanel';
import { ImportDialog } from '../components/api/ImportDialog';
import { VersionDiffDialog } from '../components/api/VersionDiffDialog';
import type {
  ApiEndpoint,
  ApiVersionDiff,
  ApiVersionInfo,
  EndpointDetail,
  SchemaDisplayNode,
} from '../types';

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
  };
}

interface ApiViewProps {
  endpoints: ApiEndpoint[];
  versions: ApiVersionInfo[];
  details: Record<string, EndpointDetail>;
  schemas: Record<string, SchemaDisplayNode>;
  diff: ApiVersionDiff | null;
  imported: boolean;
  onImport: () => void;
  onCreate: (endpoint: ApiEndpoint, detail: EndpointDetail) => void;
  onUpdate: (endpoint: ApiEndpoint, detail: EndpointDetail) => void;
  onDelete: (endpointId: string) => void;
  onAddToWorkflow?: (endpointId: string) => void;
  onCreateSchema?: (schema: SchemaDisplayNode) => void;
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
  endpoints,
  versions,
  details,
  schemas,
  diff,
  imported,
  onImport,
  onCreate,
  onUpdate,
  onDelete,
  onAddToWorkflow,
  onCreateSchema,
}: ApiViewProps) {
  const [importOpen, setImportOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>('view');
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);

  const activeVersion = useMemo(() => versions.find((v) => v.isActive) ?? null, [versions]);

  // Compute workflow usage per endpoint
  const usedInWorkflows = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const ep of endpoints) {
      const epDetail = details[ep.id];
      if (epDetail) {
        map[ep.id] = epDetail.tags.filter((t) =>
          ['核心流程', '认证', '支付', '订单', '生命周期'].includes(t),
        );
      }
    }
    return map;
  }, [endpoints, details]);

  // Resolve the current detail based on mode
  const currentDetail = useMemo(() => {
    if (panelMode === 'create') return emptyEndpointDetail();
    if (!selectedEndpointId) return null;
    const ep = endpoints.find((e) => e.id === selectedEndpointId);
    if (!ep) return null;
    return detailFromEndpoint(ep, details);
  }, [panelMode, selectedEndpointId, endpoints, details]);

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
          coverage: endpoints.find((e) => e.id === selectedEndpointId)?.coverage ?? 0,
          cases: endpoints.find((e) => e.id === selectedEndpointId)?.cases ?? 0,
          tags: detail.tags,
          deprecated: detail.deprecated,
          versionId: activeVersion?.id,
        };
        onUpdate(endpoint, { ...detail, endpointId: selectedEndpointId });
        setPanelMode('view');
      }
    },
    [panelMode, selectedEndpointId, activeVersion, endpoints, onCreate, onUpdate],
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

      {/* Main catalog table */}
      <ApiTable
        endpoints={endpoints}
        activeVersion={activeVersion}
        usedInWorkflows={usedInWorkflows}
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
          existingIds={endpoints.map((e) => e.id)}
          onSave={handleSave}
          onDelete={panelMode === 'edit' ? handleDelete : undefined}
          onAddToWorkflow={panelMode === 'view' ? handleAddToWorkflow : undefined}
          onClose={handleClose}
          onCreateSchema={onCreateSchema}
        />
      ) : null}

      {/* Import dialog */}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImport={onImport} />

      {/* Version diff dialog */}
      <VersionDiffDialog open={diffOpen} diff={diff} onClose={() => setDiffOpen(false)} />
    </main>
  );
}
