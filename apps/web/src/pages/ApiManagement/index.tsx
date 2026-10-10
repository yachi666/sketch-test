import type { ApiSchemaNode, Endpoint } from '@sketch-test/canonical-api-model';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  endpointDetailFromCanonical,
  schemaDisplayNodesFromCanonical,
} from '../../components/api/endpointDetailFromCanonical';
import { type ApiVersionSummary, cpClient } from '../../lib/cp-client';
import { useEnvironmentStore } from '../../stores/environmentStore';
import { useVariableStore } from '../../stores/variableStore';
import type {
  ApiChangeItem,
  ApiEndpoint,
  ApiSource,
  ApiVersionDiff,
  ApiVersionInfo,
  EndpointDetail,
  SchemaDisplayNode,
} from '../../types';
import { ApiView } from '../../views/ApiView';

interface CatalogState {
  sources: ApiSource[];
  endpoints: ApiEndpoint[];
  versions: ApiVersionInfo[];
  details: Record<string, EndpointDetail>;
  schemas: Record<string, SchemaDisplayNode>;
  diff: ApiVersionDiff | null;
}

const emptyCatalog: CatalogState = {
  sources: [],
  endpoints: [],
  versions: [],
  details: {},
  schemas: {},
  diff: null,
};

function sourceType(value: string): ApiVersionInfo['sourceType'] {
  return value === 'raml' || value === 'manual' ? value : 'openapi';
}

function sourceLabel(version: ApiVersionSummary): string {
  return version.label || version.sourceLocation.split('/').filter(Boolean).at(-1) || version.id;
}

function toVersionInfo(version: ApiVersionSummary, index: number): ApiVersionInfo {
  const label = sourceLabel(version);
  return {
    id: version.id,
    sourceId: version.id,
    label,
    sourceType: sourceType(version.sourceType),
    fileName: label,
    // The catalog summary deliberately does not expose source metadata beyond the immutable
    // version record, so avoid inventing a semantic version for the display.
    version: '—',
    endpointCount: version.endpointCount,
    schemaCount: 0,
    importedAt: version.createdAt,
    isActive: index === 0,
  };
}

function asCanonicalEndpoints(value: unknown): Endpoint[] {
  return Array.isArray(value) ? (value as Endpoint[]) : [];
}

function asCanonicalSchemas(value: unknown): Record<string, ApiSchemaNode> {
  return value && typeof value === 'object' ? (value as Record<string, ApiSchemaNode>) : {};
}

function mapDiff(
  base: ApiVersionSummary,
  target: ApiVersionSummary,
  result: { changes: unknown[] },
): ApiVersionDiff {
  const changes: ApiChangeItem[] = result.changes.flatMap((change) => {
    if (!change || typeof change !== 'object') return [];
    const entry = change as Record<string, unknown>;
    const type = entry['type'];
    if (type !== 'added' && type !== 'removed' && type !== 'modified') return [];
    return [
      {
        changeType: type as ApiChangeItem['changeType'],
        endpointId: String(entry['path'] ?? ''),
        path: String(entry['path'] ?? ''),
        description: String(entry['summary'] ?? ''),
        breaking: entry['breaking'] === true,
        affectedTestCases: 0,
        affectedWorkflows: 0,
      },
    ];
  });
  return {
    baseVersionId: base.id,
    baseVersionLabel: sourceLabel(base),
    targetVersionId: target.id,
    targetVersionLabel: sourceLabel(target),
    summary: {
      addedEndpoints: changes.filter((change) => change.changeType === 'added').length,
      removedEndpoints: changes.filter((change) => change.changeType === 'removed').length,
      modifiedEndpoints: changes.filter((change) => change.changeType === 'modified').length,
      breakingChanges: changes.filter((change) => change.breaking).length,
    },
    changes,
  };
}

export function ApiManagementPage() {
  const navigate = useNavigate();
  const { variables } = useVariableStore();
  const { activeEnvironmentId } = useEnvironmentStore();
  const [catalog, setCatalog] = useState<CatalogState>(emptyCatalog);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { apiVersions } = await cpClient.listApiVersions();
      const details = await Promise.all(
        apiVersions.map(async (version) => ({
          summary: version,
          value: await cpClient.getApiVersion(version.id),
        })),
      );
      const nextSchemas: Record<string, SchemaDisplayNode> = {};
      const nextDetails: Record<string, EndpointDetail> = {};
      const endpoints: ApiEndpoint[] = [];
      for (const { summary, value } of details) {
        const schemas = schemaDisplayNodesFromCanonical(asCanonicalSchemas(value.schemas));
        Object.assign(nextSchemas, schemas);
        for (const endpoint of asCanonicalEndpoints(value.endpoints)) {
          // Canonical endpoint IDs are stable across immutable API versions. Scope the UI row key
          // by version so that the same operation in two versions remains independently viewable.
          const rowId = `${summary.id}:${endpoint.id}`;
          endpoints.push({
            id: rowId,
            method: endpoint.method,
            path: endpoint.path,
            summary: endpoint.summary ?? '',
            description: endpoint.description,
            coverage: null,
            cases: null,
            tags: endpoint.tags ?? [],
            deprecated: endpoint.deprecated,
            versionId: summary.id,
            updatedAt: summary.createdAt,
          });
          nextDetails[rowId] = endpointDetailFromCanonical(endpoint, schemas);
        }
      }
      let diff: ApiVersionDiff | null = null;
      if (apiVersions.length >= 2) {
        const [target, base] = apiVersions;
        diff = mapDiff(base, target, await cpClient.diffApiVersions(base.id, target.id));
      }
      setCatalog({
        sources: apiVersions.map((version) => ({
          id: version.id,
          name: sourceLabel(version),
          sourceLabel: version.sourceLocation,
          sourceType: sourceType(version.sourceType),
          createdAt: version.createdAt,
          updatedAt: version.createdAt,
        })),
        endpoints,
        versions: apiVersions.map(toVersionInfo),
        details: nextDetails,
        schemas: nextSchemas,
        diff,
      });
    } catch (reason) {
      setCatalog(emptyCatalog);
      setError(reason instanceof Error ? reason.message : '无法读取接口目录。');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ApiView
      {...catalog}
      imported={catalog.versions.length > 0}
      variables={variables}
      activeEnvironmentId={activeEnvironmentId}
      loadError={error}
      onRetryLoad={load}
      onImport={() => navigate('/import')}
      onCreate={() => {}}
      onUpdate={() => {}}
      onDelete={() => {}}
      readOnly
    />
  );
}
