import { Check, ClipboardText, DownloadSimple, SpinnerGap } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { stringify } from 'yaml';
import { cpClient, type EndpointOpenApiDefinition } from '../../../lib/cp-client';
import type { EndpointDetail } from '../../../types';

interface EndpointDefinitionPanelProps {
  apiVersionId?: string;
  endpointId: string;
  detail: EndpointDetail;
}

const originCopy: Record<EndpointOpenApiDefinition['origin'], string> = {
  'derived-openapi': '由已导入的 OpenAPI 统一模型生成；原始文件保持不变。',
  'derived-postman':
    '由 Postman 导入的接口投影生成；脚本、目录执行顺序和扩展资源不包含在 YAML 中。',
  'derived-canonical': '由当前接口统一模型生成；此 YAML 为只读派生定义。',
};

function localDefinition(detail: EndpointDetail): EndpointOpenApiDefinition {
  const document = {
    openapi: '3.2.0',
    info: { title: detail.summary || `${detail.method} ${detail.path}`, version: 'local-draft' },
    paths: {
      [detail.path.replace(/:([A-Za-z0-9_-]+)/g, '{$1}')]: {
        [detail.method.toLowerCase()]: {
          summary: detail.summary,
          ...(detail.description ? { description: detail.description } : {}),
          parameters: detail.parameters.map((parameter) => ({
            name: parameter.name,
            in: parameter.in,
            required: parameter.in === 'path' ? true : parameter.required,
            ...(parameter.description ? { description: parameter.description } : {}),
            schema: { type: parameter.type ?? 'string' },
            ...(parameter.example ? { example: parameter.example } : {}),
          })),
          responses: Object.fromEntries(
            detail.responses.map((response) => [
              String(response.statusCode),
              { description: response.description || 'Response' },
            ]),
          ),
        },
      },
    },
  };
  return {
    yaml: stringify(document, { lineWidth: 0 }),
    origin: 'derived-canonical',
    sourceLabel: 'local endpoint detail',
    fileName: `${detail.method.toLowerCase()}-endpoint.openapi.yaml`,
  };
}

export function EndpointDefinitionPanel({
  apiVersionId,
  endpointId,
  detail,
}: EndpointDefinitionPanelProps) {
  const [definition, setDefinition] = useState<EndpointOpenApiDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!apiVersionId?.startsWith('av_')) {
      setDefinition(localDefinition(detail));
      return;
    }
    let active = true;
    void cpClient
      .getEndpointOpenApiDefinition(apiVersionId, endpointId)
      .then((result) => {
        if (active) setDefinition(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '无法加载接口定义');
      });
    return () => {
      active = false;
    };
  }, [apiVersionId, detail, endpointId]);

  const copy = async () => {
    if (!definition) return;
    await navigator.clipboard.writeText(definition.yaml);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    if (!definition) return;
    const url = URL.createObjectURL(new Blob([definition.yaml], { type: 'application/yaml' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = definition.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="endpoint-definition-inline" aria-label="接口 OpenAPI YAML">
      {definition ? (
        <>
          <p className="endpoint-definition-note">{originCopy[definition.origin]}</p>
          <div className="endpoint-definition-actions">
            <button
              className="button button--outline button--sm"
              type="button"
              onClick={() => void copy()}
            >
              {copied ? <Check size={15} /> : <ClipboardText size={15} />}
              {copied ? '已复制' : '复制 YAML'}
            </button>
            <button className="button button--outline button--sm" type="button" onClick={download}>
              <DownloadSimple size={15} />
              下载 YAML
            </button>
          </div>
          <pre className="endpoint-definition-code">
            <code>{definition.yaml}</code>
          </pre>
        </>
      ) : error ? (
        <p className="endpoint-definition-error">{error}</p>
      ) : (
        <div className="endpoint-definition-loading">
          <SpinnerGap size={20} className="import-center__spinner" />
          正在生成接口定义…
        </div>
      )}
    </section>
  );
}
