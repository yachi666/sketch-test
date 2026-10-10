import { ShieldCheck, Tag as TagIcon, Warning } from '@phosphor-icons/react';
import type {
  ApiParameter,
  ApiRequestBody,
  ApiResponseDef,
  SchemaDisplayNode,
} from '../../../types';
import { SchemaTab } from './SchemaTab';

interface PreviewViewProps {
  deprecated: boolean;
  tags: string[];
  security?: Record<string, string[]>[];
  parameters: ApiParameter[];
  requestBody?: ApiRequestBody;
  responses: ApiResponseDef[];
  /** Schema registry for the Schema section. */
  schemas: Record<string, SchemaDisplayNode>;
  /** First success (2xx) response, for the response Schema section. */
  responseSchema?: ApiResponseDef;
}

const HTTP_STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: '已创建',
  204: '无内容',
  301: '永久移动',
  302: '临时重定向',
  304: '未修改',
  400: '请求错误',
  401: '未授权',
  403: '禁止访问',
  404: '未找到',
  405: '方法不允许',
  409: '冲突',
  422: '实体无法处理',
  429: '请求过多',
  500: '服务器错误',
  502: '网关错误',
  503: '服务不可用',
};

function statusCategory(code: number): '2xx' | '3xx' | '4xx' | '5xx' | 'other' {
  if (code >= 200 && code < 300) return '2xx';
  if (code >= 300 && code < 400) return '3xx';
  if (code >= 400 && code < 500) return '4xx';
  if (code >= 500 && code < 600) return '5xx';
  return 'other';
}

function statusLabel(code: number): string {
  return HTTP_STATUS_TEXT[code] ?? '响应';
}

function typeLabel(type: string): string {
  const map: Record<string, string> = {
    string: '字符串',
    integer: '整数',
    number: '数字',
    boolean: '布尔',
    array: '数组',
    object: '对象',
  };
  return map[type] ?? type;
}

// ── Sub-components ──────────────────────────────────────────

function ParamCard({ title, params }: { title: string; params: ApiParameter[] }) {
  if (params.length === 0) {
    return (
      <div className="preview-param-card preview-param-card--empty">
        <div className="preview-param-card-header">
          <h4>{title}</h4>
          <span className="badge">0</span>
        </div>
        <p className="preview-param-empty">—</p>
      </div>
    );
  }

  return (
    <div className="preview-param-card">
      <div className="preview-param-card-header">
        <h4>{title}</h4>
        <span className="badge">{params.length}</span>
      </div>
      <ul className="preview-param-list">
        {params.map((p) => (
          <li
            key={p.id}
            className={`preview-param-row${p.deprecated ? ' preview-param-row--deprecated' : ''}`}
          >
            <span className="preview-param-name">
              {p.name}
              {p.deprecated ? <span className="preview-param-deprecated-tag">已弃用</span> : null}
            </span>
            <span className="preview-param-meta">
              <span className="preview-param-type">{typeLabel(p.type ?? 'string')}</span>
              {p.required ? (
                <span className="preview-param-required">必填</span>
              ) : (
                <span className="preview-param-optional">选填</span>
              )}
            </span>
            {p.description ? <span className="preview-param-desc">{p.description}</span> : null}
            {p.example !== undefined && p.example !== '' ? (
              <span className="preview-param-example">
                示例: <code>{p.example}</code>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResponseCard({ response }: { response: ApiResponseDef }) {
  const cat = statusCategory(response.statusCode);
  const schemaName = response.schemaRef?.split('/').pop();

  return (
    <div className={`preview-response-card preview-response-card--${cat}`}>
      <div className="preview-response-card-status">
        <span className="preview-response-code">{response.statusCode}</span>
        <span className="preview-response-label">{statusLabel(response.statusCode)}</span>
      </div>
      <div className="preview-response-card-body">
        {response.contentTypes.length > 0 ? (
          <span className="preview-response-content-type">{response.contentTypes.join(', ')}</span>
        ) : null}
        {schemaName ? <span className="preview-response-schema">{schemaName}</span> : null}
        {response.description ? (
          <span className="preview-response-desc">{response.description}</span>
        ) : null}
      </div>
    </div>
  );
}

function RequestBodyCard({ body }: { body: ApiRequestBody }) {
  const schemaName = body.schemaRef?.split('/').pop();

  return (
    <div className="preview-request-body-card">
      <div className="preview-request-body-card-header">
        <h4>请求体</h4>
        <span className="badge">{body.required ? '必填' : '选填'}</span>
      </div>
      <div className="preview-request-body-card-content">
        <span className="preview-request-body-content-type">{body.contentTypes.join(', ')}</span>
        {schemaName ? <span className="preview-request-body-schema">{schemaName}</span> : null}
        {body.description ? <p className="preview-request-body-desc">{body.description}</p> : null}
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────

/**
 * Single-page preview for an API endpoint in view mode.
 * The URL bar lives in the dialog's identity section (above the fold);
 * this component renders parameter cards, request body, responses,
 * Schema definitions, and meta info — all scrollable.
 */
export function PreviewView({
  deprecated,
  tags,
  security,
  parameters,
  requestBody,
  responses,
  schemas,
  responseSchema,
}: PreviewViewProps) {
  const pathParams = parameters.filter((p) => p.in === 'path');
  const queryParams = parameters.filter((p) => p.in === 'query');
  const headerParams = parameters.filter((p) => p.in === 'header');
  const cookieParams = parameters.filter((p) => p.in === 'cookie');

  // Only show param groups that actually have parameters
  const activeParamGroups = [
    { title: '路径参数', params: pathParams },
    { title: '查询参数', params: queryParams },
    { title: '请求头', params: headerParams },
    { title: 'Cookie', params: cookieParams },
  ].filter((g) => g.params.length > 0);

  const hasResponses = responses.length > 0;
  const hasRequestSection = !!requestBody;
  const hasMetaInfo = tags.length > 0 || deprecated || (security?.length ?? 0) > 0;

  return (
    <div className="preview-view">
      {/* ── Parameter Cards ── */}
      {activeParamGroups.length > 0 ? (
        <div className="preview-cards">
          {activeParamGroups.map((g) => (
            <ParamCard key={g.title} title={g.title} params={g.params} />
          ))}
        </div>
      ) : null}

      {/* ── Request Body ── */}
      {hasRequestSection ? (
        <div className="preview-section">
          <h4 className="preview-section-title">请求体</h4>
          <RequestBodyCard body={requestBody} />
        </div>
      ) : null}

      {/* ── Response Cards ── */}
      {hasResponses ? (
        <div className="preview-section">
          <h4 className="preview-section-title">响应</h4>
          <div className="preview-response-cards">
            {responses.map((r) => (
              <ResponseCard key={`${r.statusCode}-${r.id}`} response={r} />
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Schema ── */}
      <div className="preview-section">
        <h4 className="preview-section-title">Schema</h4>
        <div className="preview-schema-wrap">
          <SchemaTab
            responseSchema={responseSchema}
            requestSchema={requestBody}
            schemas={schemas}
          />
        </div>
      </div>

      {/* ── Meta info row ── */}
      {hasMetaInfo ? (
        <div className="preview-meta">
          {tags.map((tag) => (
            <span key={tag} className="tag">
              <TagIcon size={11} />
              {tag}
            </span>
          ))}
          {security?.length ? (
            <span className="tag tag--secure">
              <ShieldCheck size={12} />
              需认证
            </span>
          ) : null}
          {deprecated ? (
            <span className="tag tag--warning">
              <Warning size={12} />
              已弃用
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
