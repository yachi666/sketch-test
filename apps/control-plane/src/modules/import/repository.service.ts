import { createHash } from 'node:crypto';
import { discoverSpringApi, type SourceFile } from '@sketch-test/adapter-code-discovery';
import { pool } from '../../db/db.js';
import { apiVersionId } from '../../shared/id.js';
import { getObjectStore } from '../../shared/object-storage.js';

export class RepositoryError extends Error {
  constructor(
    message: string,
    public statusCode = 422,
  ) {
    super(message);
  }
}
export interface RepositoryInput {
  repositoryUrl: string;
  ref?: string;
  directory?: string;
}
export function parseRepositoryInput(input: RepositoryInput) {
  let url: URL;
  try {
    url = new URL(input.repositoryUrl);
  } catch {
    throw new RepositoryError('请输入完整的 GitHub HTTPS 仓库 URL。', 400);
  }
  const parts = url.pathname
    .replace(/\/$/, '')
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    parts.length !== 2 ||
    parts.some((p) => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '.' || p === '..')
  ) {
    throw new RepositoryError(
      '请输入 https://github.com/owner/repository，分支请填在单独的输入框。',
      400,
    );
  }
  const ref = input.ref?.trim() || 'HEAD';
  const directory = (input.directory?.trim() ?? '').replace(/\/$/, '');
  if (ref.length > 200 || /[\s?&#\\]/.test(ref))
    throw new RepositoryError('分支或提交格式无效。', 400);
  if (
    directory.length > 240 ||
    directory.startsWith('/') ||
    directory.includes('\\') ||
    directory.split('/').some((p) => p === '..' || p === '.') ||
    [...directory].some((char) => char.charCodeAt(0) < 32)
  )
    throw new RepositoryError('扫描目录必须是仓库内的相对路径。', 400);
  return {
    slug: parts.join('/'),
    repositoryUrl: `https://github.com/${parts.join('/')}`,
    ref,
    directory,
  };
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    await response.body?.cancel();
    throw new RepositoryError('仓库响应超出大小限制。');
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RepositoryError('仓库响应超出大小限制。');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
interface TreeEntry {
  path: string;
  type: string;
  mode: string;
  sha: string;
  size?: number;
}
export async function analyzeRepository(input: RepositoryInput, fetcher: typeof fetch = fetch) {
  const parsed = parseRepositoryInput(input);
  const signal = AbortSignal.timeout(90_000);
  const get = async (url: string, maxBytes: number) => {
    let response: Response;
    try {
      response = await fetcher(url, {
        redirect: 'error',
        signal,
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'SketchTest-code-discovery',
        },
      });
    } catch {
      throw new RepositoryError(
        signal.aborted ? '仓库分析超时，请缩小扫描目录后重试。' : '无法连接 GitHub，请稍后重试。',
        502,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 403 || response.status === 429)
        throw new RepositoryError('GitHub 请求限流，请稍后再试。', 429);
      if (response.status === 404)
        throw new RepositoryError('未找到公开仓库或指定分支。当前入口不读取私有仓库。', 404);
      throw new RepositoryError(`GitHub 返回 HTTP ${response.status}，请重试。`, 502);
    }
    return readBounded(response, maxBytes);
  };
  const commitData = JSON.parse(
    await get(
      `https://api.github.com/repos/${parsed.slug}/commits/${encodeURIComponent(parsed.ref)}`,
      512 * 1024,
    ),
  ) as { sha: string; commit: { tree: { sha: string } } };
  if (
    !/^[a-f0-9]{40}$/.test(commitData.sha) ||
    !/^[a-f0-9]{40}$/.test(commitData.commit?.tree?.sha)
  )
    throw new RepositoryError('GitHub 提交信息无效。', 502);
  const commit = commitData.sha;
  const tree = JSON.parse(
    await get(
      `https://api.github.com/repos/${parsed.slug}/git/trees/${commitData.commit.tree.sha}?recursive=1`,
      8 * 1024 * 1024,
    ),
  ) as { truncated: boolean; tree: TreeEntry[] };
  if (tree.truncated || !Array.isArray(tree.tree))
    throw new RepositoryError('仓库目录树不完整，无法保证分析来源，请使用较小的仓库。');
  const candidates = tree.tree
    .filter(
      (file) =>
        file.type === 'blob' &&
        ['100644', '100755'].includes(file.mode) &&
        /^[a-f0-9]{40}$/.test(file.sha) &&
        (!parsed.directory || file.path.startsWith(`${parsed.directory}/`)) &&
        /\.java$/.test(file.path) &&
        !/(^|\/)(?:test|tests|target|build|vendor|generated)(\/|$)/i.test(file.path) &&
        (/Controller\.java$/.test(file.path) || /\/dto\//i.test(file.path)) &&
        !file.path.split('/').some((part) => part === '..' || part === '.') &&
        file.path.length <= 256,
    )
    .sort((a, b) => a.path.localeCompare(b.path));
  if (!candidates.length)
    throw new RepositoryError(
      '该目录未找到 Spring Controller 或 DTO。当前支持 Java/Spring REST Controller。',
    );
  if (
    candidates.length > 160 ||
    candidates.some((f) => (f.size ?? 0) > 256 * 1024) ||
    candidates.reduce((n, f) => n + (f.size ?? 0), 0) > 4 * 1024 * 1024
  )
    throw new RepositoryError('扫描上限为 160 个文件、总计 4 MiB，请限定模块目录。');
  const files: SourceFile[] = [];
  let cursor = 0;
  let total = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < candidates.length) {
        const file = candidates[cursor++];
        if (!file) break;
        const content = await get(
          `https://raw.githubusercontent.com/${parsed.slug}/${commit}/${file.path.split('/').map(encodeURIComponent).join('/')}`,
          256 * 1024,
        );
        const size = Buffer.byteLength(content);
        total += size;
        if (total > 4 * 1024 * 1024) throw new RepositoryError('代码内容超过总大小限制。');
        const blob = createHash('sha1').update(`blob ${size}\0`).update(content).digest('hex');
        if (blob !== file.sha)
          throw new RepositoryError('源文件与固定提交不一致，已停止分析。', 502);
        files.push({ path: file.path, content });
      }
    }),
  );
  const model = discoverSpringApi({ repositoryUrl: parsed.repositoryUrl, commit, files });
  if (!model.endpoints.length)
    throw new RepositoryError('未发现支持的静态 REST 路由。请检查扫描目录与 Spring 注解写法。');
  return {
    model,
    repositoryUrl: parsed.repositoryUrl,
    commit,
    ref: parsed.ref,
    directory: parsed.directory,
    scannedFiles: files.length,
  };
}

// Only structured evidence is persisted; raw code and repository credentials never enter model input.
export async function importRepository(workspaceId: string, input: RepositoryInput) {
  const result = await analyzeRepository(input);
  const { model } = result;
  const id = apiVersionId();
  const sourceObjectKey = `code-sources/sha256/${model.metadata.sourceHash}.json`;
  // Hash the reproducible source manifest, not a projection containing a new ingestion timestamp.
  const manifest = JSON.stringify({
    repositoryUrl: result.repositoryUrl,
    commit: result.commit,
    files: model.metadata.extra?.['files'],
  });
  await getObjectStore().put(sourceObjectKey, manifest, 'application/json');
  await pool.query(
    `INSERT INTO api_versions (id,workspace_id,source_type,source_location,source_object_key,content_hash,spec_json,diagnostics) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      workspaceId,
      'code-discovery',
      `${result.repositoryUrl}/tree/${result.commit}`,
      sourceObjectKey,
      model.metadata.sourceHash,
      JSON.stringify(model),
      JSON.stringify(model.diagnostics),
    ],
  );
  return {
    apiVersionId: id,
    repositoryUrl: result.repositoryUrl,
    commit: result.commit,
    scannedFiles: result.scannedFiles,
    endpointCount: model.endpoints.length,
    diagnostics: model.diagnostics.map((d) => ({ level: d.severity, message: d.message })),
    endpoints: model.endpoints,
  };
}
