import { ArrowLeft, ArrowsClockwise, PaperPlaneTilt, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { cpClient } from '../../../lib/cp-client';
import type { EndpointDetail } from '../../../types';

interface RequestSendPanelProps {
  detail: EndpointDetail;
  defaultUrl: string;
  onBack: () => void;
}

interface ResponsePreview {
  statusCode?: number;
  durationMs?: number;
  headers?: Record<string, string>;
  bodyPreview?: string;
}

function defaultHeaders(detail: EndpointDetail): string {
  const contentType = detail.requestBodies[0]?.contentTypes.find((type) => type !== '*/*');
  const headerExamples = detail.parameters.reduce<Record<string, string>>((headers, parameter) => {
    if (parameter.in === 'header' && parameter.example !== undefined) {
      headers[parameter.name] = parameter.example;
    }
    return headers;
  }, {});
  const headers = contentType ? { ...headerExamples, 'Content-Type': contentType } : headerExamples;
  return Object.keys(headers).length > 0 ? JSON.stringify(headers, null, 2) : '';
}

function parseHeaders(value: string): Record<string, string> | undefined {
  if (!value.trim()) return undefined;

  const parsed: unknown = JSON.parse(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('请求头必须是 JSON 对象。');
  }

  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([name, headerValue]) => [
      name,
      String(headerValue),
    ]),
  );
}

function parseBody(value: string, detail: EndpointDetail): unknown {
  if (!value.trim()) return undefined;
  const isJson = detail.requestBodies[0]?.contentTypes.some((type) => type.includes('json'));
  return isJson ? JSON.parse(value) : value;
}

function extractResponse(
  events: Array<{ eventType: string; payload: unknown }>,
): ResponsePreview | null {
  const event = [...events]
    .reverse()
    .find((candidate) => candidate.eventType === 'response.received');
  if (!event?.payload || typeof event.payload !== 'object') return null;

  const payload = event.payload as Record<string, unknown>;
  const headers = payload['headers'];
  return {
    statusCode: typeof payload['statusCode'] === 'number' ? payload['statusCode'] : undefined,
    durationMs: typeof payload['durationMs'] === 'number' ? payload['durationMs'] : undefined,
    headers:
      headers && typeof headers === 'object' && !Array.isArray(headers)
        ? (headers as Record<string, string>)
        : undefined,
    bodyPreview: typeof payload['bodyPreview'] === 'string' ? payload['bodyPreview'] : undefined,
  };
}

function isTerminal(status: string): boolean {
  return ['passed', 'failed', 'inconclusive', 'cancelled', 'orphaned'].includes(status);
}

/**
 * An API-client style request composer. The request is still executed by a
 * Runner, so private-network access and redaction rules remain intact.
 */
export function RequestSendPanel({ detail, defaultUrl, onBack }: RequestSendPanelProps) {
  const [url, setUrl] = useState(defaultUrl);
  const [headers, setHeaders] = useState(() => defaultHeaders(detail));
  const [body, setBody] = useState(detail.requestBodies[0]?.exampleBody ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [response, setResponse] = useState<ResponsePreview | null>(null);

  useEffect(() => {
    setUrl(defaultUrl);
    setHeaders(defaultHeaders(detail));
    setBody(detail.requestBodies[0]?.exampleBody ?? '');
    setError(null);
    setRunId(null);
    setRunStatus(null);
    setResponse(null);
  }, [defaultUrl, detail]);

  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(detail.method);
  const formattedResponse = useMemo(() => {
    if (!response?.bodyPreview) return '';
    try {
      return JSON.stringify(JSON.parse(response.bodyPreview), null, 2);
    } catch {
      return response.bodyPreview;
    }
  }, [response?.bodyPreview]);

  const send = async () => {
    if (sending) return;
    if (!url.trim()) {
      setError('请填写完整请求 URL。');
      return;
    }

    try {
      new URL(url);
    } catch {
      setError('请输入以 http:// 或 https:// 开头的完整 URL。');
      return;
    }

    setSending(true);
    setError(null);
    setResponse(null);
    setRunStatus('queued');

    try {
      const { runId: createdRunId } = await cpClient.createCustomRun([
        {
          method: detail.method,
          url: url.trim(),
          headers: parseHeaders(headers),
          body: parseBody(body, detail),
        },
      ]);
      setRunId(createdRunId);

      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
        const detailResult = await cpClient.getRun(createdRunId);
        setRunStatus(detailResult.run.status);

        const received = extractResponse(detailResult.steps);
        if (received) setResponse(received);

        if (isTerminal(detailResult.run.status)) {
          if (!received && detailResult.run.status !== 'passed') {
            setError(`请求未完成：${detailResult.run.status}`);
          }
          return;
        }
      }

      setError('请求等待超时，请到执行记录查看后续状态。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '请求发送失败。');
      setRunStatus(null);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="request-send-panel" aria-label="发送请求">
      <div className="request-send-panel__heading">
        <div>
          <span className="eyebrow">REQUEST</span>
          <h3>发送请求</h3>
          <p>直接通过已连接的 Runner 发送；响应会按平台规则脱敏。</p>
        </div>
        <button className="button button--ghost button--sm" type="button" onClick={onBack}>
          <ArrowLeft size={15} />
          返回详情
        </button>
      </div>

      {isWrite ? (
        <p className="request-send-panel__warning" role="note">
          此请求可能会修改数据，请确认目标环境和请求内容。
        </p>
      ) : null}

      <label className="request-send-panel__field">
        <span>请求 URL</span>
        <div className="request-send-panel__url-row">
          <code>{detail.method}</code>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://api.example.com/resource"
            spellCheck={false}
          />
        </div>
      </label>

      <div className="request-send-panel__grid">
        <label className="request-send-panel__field">
          <span>请求头（JSON）</span>
          <textarea
            value={headers}
            onChange={(event) => setHeaders(event.target.value)}
            placeholder={'{\n  "Authorization": "Bearer …"\n}'}
            rows={6}
            spellCheck={false}
          />
        </label>
        <label className="request-send-panel__field">
          <span>请求体</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={detail.requestBodies.length > 0 ? '输入请求体' : '该接口没有请求体'}
            rows={6}
            spellCheck={false}
            disabled={detail.requestBodies.length === 0}
          />
        </label>
      </div>

      <div className="request-send-panel__actions">
        <button
          className="button button--primary"
          type="button"
          onClick={() => void send()}
          disabled={sending}
        >
          {sending ? (
            <ArrowsClockwise className="request-send-panel__spin" size={17} />
          ) : (
            <PaperPlaneTilt size={17} />
          )}
          {sending ? '发送中…' : '发送'}
        </button>
        {runStatus ? <span className="request-send-panel__status">状态：{runStatus}</span> : null}
        {runId ? <code className="request-send-panel__run">{runId}</code> : null}
      </div>

      {error ? (
        <p className="request-send-panel__error" role="alert">
          <WarningCircle aria-hidden="true" size={16} weight="fill" />
          {error}
        </p>
      ) : null}

      {response ? (
        <div className="request-send-panel__response">
          <div className="request-send-panel__response-meta">
            <strong>{response.statusCode ?? '—'}</strong>
            <span>
              {response.durationMs !== undefined ? `${response.durationMs} ms` : '等待响应详情'}
            </span>
          </div>
          {response.headers ? (
            <details>
              <summary>响应头</summary>
              <pre>{JSON.stringify(response.headers, null, 2)}</pre>
            </details>
          ) : null}
          <pre>{formattedResponse || '响应没有可展示的正文。'}</pre>
        </div>
      ) : null}
    </section>
  );
}
