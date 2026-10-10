import { createHash } from 'node:crypto';
import {
  CANONICAL_API_MODEL_VERSION,
  type CanonicalApiModel,
  CanonicalApiModelSchema,
  type Endpoint,
} from '@sketch-test/canonical-api-model';

export interface SourceFile {
  path: string;
  content: string;
}
export interface CodeSnapshot {
  repositoryUrl: string;
  commit: string;
  files: SourceFile[];
  ingestedAt?: string;
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

// Preserve offsets while masking comments and literals for balanced delimiter scanning.
function masked(source: string, strings = false): string {
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    (token) => (token.startsWith('/') || strings ? token.replace(/[^\n]/g, ' ') : token),
  );
}
function closing(text: string, start: number, left: string, right: string): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === left) depth++;
    if (text[i] === right && --depth === 0) return i;
  }
  return -1;
}
interface Annotation {
  name: string;
  args: string;
  start: number;
  end: number;
}
function annotations(source: string): Annotation[] {
  const plain = masked(source);
  const structure = masked(source, true);
  const out: Annotation[] = [];
  for (const match of structure.matchAll(/@([\w.]+)/g)) {
    const start = match.index;
    let end = start + match[0].length;
    while (/\s/.test(structure[end] ?? '') && end < structure.length) end++;
    let args = '';
    if (structure[end] === '(') {
      const close = closing(structure, end, '(', ')');
      if (close < 0) continue;
      args = plain.slice(end + 1, close);
      end = close + 1;
    }
    out.push({ name: match[1]?.split('.').at(-1) ?? '', args, start, end });
  }
  return out;
}
function paths(args: string): string[] | null {
  const input = args.trim();
  if (!input) return [''];
  const named = input.match(/(?:^|,)\s*(?:value|path)\s*=\s*(\{[^}]*\}|"(?:\\.|[^"\\])*")/);
  if (named && !/^\s*(?:,|$)/.test(input.slice((named.index ?? 0) + named[0].length))) return null;
  const value = named?.[1] ?? (/^(?:"|\{)/.test(input) ? input : null);
  if (!value) return /^method\s*=/.test(input) && !/(?:value|path)\s*=/.test(input) ? [''] : null;
  const bare = value.replace(/^\{\s*|\s*\}$/g, '');
  if (!/^"[^"\\]*"(?:\s*,\s*"[^"\\]*")*$/.test(bare)) return null;
  const result = [...bare.matchAll(/"([^"\\]*)"/g)].map((m) => m[1] ?? '');
  return result.some((p) => p.includes('${') || p.includes('#{') || /[?*]/.test(p)) ? null : result;
}
const javaType = (name: string): 'string' | 'integer' | 'number' | 'boolean' | undefined =>
  /^(?:String|UUID|LocalDate|LocalDateTime|Instant)$/.test(name)
    ? 'string'
    : /^(?:int|long|Integer|Long|short|Short)$/.test(name)
      ? 'integer'
      : /^(?:double|float|Double|Float|BigDecimal)$/.test(name)
        ? 'number'
        : /^(?:boolean|Boolean)$/.test(name)
          ? 'boolean'
          : undefined;

/** Conservative Spring MVC discovery. Unknown semantics stay visible as diagnostics. */
export function discoverSpringApi(snapshot: CodeSnapshot): CanonicalApiModel {
  const files = [...snapshot.files].sort((a, b) => a.path.localeCompare(b.path));
  const fileHashes = files.map((f) => ({ path: f.path, hash: digest(f.content) }));
  const sourceHash = digest(
    JSON.stringify({
      repositoryUrl: snapshot.repositoryUrl,
      commit: snapshot.commit,
      files: fileHashes,
    }),
  );
  const ingestedAt = snapshot.ingestedAt ?? new Date().toISOString();
  const model: CanonicalApiModel = {
    schemaVersion: CANONICAL_API_MODEL_VERSION,
    metadata: {
      sourceId: `code_${sourceHash.slice(0, 20)}`,
      sourceType: 'code-discovery',
      sourceLabel: snapshot.repositoryUrl,
      sourceVersion: '0.1.0',
      sourceHash,
      parserName: '@sketch-test/adapter-code-discovery',
      parserVersion: '0.1.0',
      ingestedAt,
      extra: {
        repositoryUrl: snapshot.repositoryUrl,
        commit: snapshot.commit,
        files: fileHashes,
        framework: 'Spring MVC',
      },
    },
    servers: [],
    securitySchemes: [],
    schemas: {},
    endpoints: [],
    diagnostics: [],
  };
  const location = (file: SourceFile, offset: number) => ({
    sourceId: model.metadata.sourceId,
    sourceLabel: file.path,
    sourceVersion: '0.1.0',
    sourceHash: digest(file.content),
    ingestedAt,
    location: `${snapshot.repositoryUrl}/blob/${snapshot.commit}/${file.path}#L${file.content.slice(0, offset).split('\n').length}`,
  });
  const warn = (file: SourceFile, offset: number, message: string) =>
    model.diagnostics.push({
      severity: 'warning',
      code: 'CODE_DISCOVERY_LIMITATION',
      message,
      sourceLocation: location(file, offset),
    });
  // Only structural DTO fields and validation facts are copied, never defaults or values.
  for (const file of files.filter((f) => /\/dto\//i.test(f.path))) {
    const source = masked(file.content);
    const name = source.match(/\bclass\s+(\w+)/)?.[1];
    if (!name) continue;
    const properties: Record<string, { ref: string }> = {};
    const required: string[] = [];
    for (const match of source.matchAll(
      /private\s+(?!static\b)([\w.]+)(?:<([^;{}]*?)>)?\s+(\w+)\s*;/g,
    )) {
      const [, type = '', , field = ''] = match;
      const marks = source.slice(source.lastIndexOf(';', match.index - 1) + 1, match.index);
      const mapped = javaType(type);
      if (!mapped) {
        warn(file, match.index, `DTO ${name}.${field} 的 ${type} 类型未展开，请补充嵌套结构。`);
        continue;
      }
      const ref = `/schemas/${name}/properties/${field}`;
      const min = marks.match(/@Min\(\s*(\d+)\s*\)/)?.[1];
      const max = marks.match(/@Max\(\s*(\d+)\s*\)/)?.[1];
      model.schemas[ref] = {
        id: ref,
        type: mapped,
        sourceLocation: location(file, match.index),
        ...(/@Email\b/.test(marks) ? { format: 'email' } : {}),
        ...(/@NotBlank\b/.test(marks) ? { minLength: 1 } : {}),
        ...(min ? { minimum: Number(min) } : {}),
        ...(max ? { maximum: Number(max) } : {}),
      };
      properties[field] = { ref };
      if (/@(?:NotNull|NotBlank|NotEmpty)\b/.test(marks)) required.push(field);
    }
    const id = `/schemas/${name}`;
    if (model.schemas[id]) {
      warn(file, 0, `DTO ${name} 存在重名，未合并；请限定扫描目录。`);
      continue;
    }
    model.schemas[id] = {
      id,
      type: 'object',
      properties,
      required,
      sourceLocation: location(file, 0),
    };
  }
  const seen = new Set<string>();
  for (const file of files.filter((f) => /Controller\.java$/.test(f.path))) {
    const source = masked(file.content);
    const structure = masked(file.content, true);
    const all = annotations(file.content);
    const classStart = structure.search(/\bclass\s+\w+/);
    if (classStart < 0 || !all.some((a) => a.name === 'RestController' && a.start < classStart))
      continue;
    const prefix = all.find((a) => a.name === 'RequestMapping' && a.start < classStart);
    const bases = paths(prefix?.args ?? '');
    if (!bases) {
      warn(file, 0, '动态 Controller 路径无法静态解析。');
      continue;
    }
    const mappings = all.filter(
      (a) =>
        /^(?:Get|Post|Put|Delete|Patch|Head|Options|Request)Mapping$/.test(a.name) &&
        a.start > classStart,
    );
    for (const mapping of mappings) {
      const suffixes = paths(mapping.args);
      const verbs =
        mapping.name === 'RequestMapping'
          ? [
              ...mapping.args.matchAll(
                /RequestMethod\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g,
              ),
            ].map((m) => m[1])
          : [mapping.name.replace('Mapping', '').toUpperCase()];
      if (
        !suffixes ||
        !verbs.length ||
        /(?:params|headers|consumes|produces)\s*=/.test(mapping.args)
      ) {
        warn(file, mapping.start, '动态路径、未限定方法或带条件的映射未展开，请查看源码。');
        continue;
      }
      const signature = structure
        .slice(mapping.end)
        .match(/\bpublic\s+(?:[\w<>?,.[\]]+\s+)+(\w+)\s*\(/);
      if (!signature || signature.index === undefined) continue;
      const parameterStart = mapping.end + signature.index + signature[0].length - 1;
      const parameterEnd = closing(structure, parameterStart, '(', ')');
      const bodyStart = structure.indexOf('{', parameterEnd);
      const bodyEnd = closing(structure, bodyStart, '{', '}');
      if (
        parameterEnd < 0 ||
        bodyStart < 0 ||
        bodyEnd < 0 ||
        mappings.some((a) => a.start > mapping.start && a.start < bodyStart)
      ) {
        warn(file, mapping.start, '无法确定方法边界，未生成端点。');
        continue;
      }
      const body = source.slice(bodyStart, bodyEnd + 1);
      const statuses = new Set<number>();
      if (/ResponseEntity\.ok\s*\(/.test(body)) statuses.add(200);
      if (/ResponseEntity\.noContent\s*\(/.test(body)) statuses.add(204);
      if (/ResponseEntity\.created\s*\(/.test(body)) statuses.add(201);
      for (const m of body.matchAll(/ResponseEntity\.status\(\s*(\d{3})\s*\)/g))
        statuses.add(Number(m[1]));
      const statusNames: Record<string, number> = {
        OK: 200,
        CREATED: 201,
        NO_CONTENT: 204,
        BAD_REQUEST: 400,
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        CONFLICT: 409,
      };
      for (const a of all.filter(
        (a) => a.name === 'ResponseStatus' && a.start > mapping.start && a.start < bodyStart,
      )) {
        const code = a.args.match(/HttpStatus\.(\w+)/)?.[1];
        if (code && statusNames[code]) statuses.add(statusNames[code]);
      }
      for (const m of body.matchAll(/ResponseEntity\.status\(\s*HttpStatus\.(\w+)\s*\)/g))
        if (statusNames[m[1] ?? '']) statuses.add(statusNames[m[1] ?? ''] as number);
      if (!statuses.size) {
        warn(file, mapping.start, '未发现显式 HTTP 状态，端点仍显示但不可直接交给 AI 生成。');
      }
      for (const verb of verbs)
        for (const base of bases)
          for (const suffix of suffixes) {
            const path = `/${[base, suffix]
              .map((p) => p.replace(/^\/+|\/+$/g, ''))
              .filter(Boolean)
              .join('/')}`;
            if (/\{[^}]*:/.test(path)) {
              warn(file, mapping.start, '正则路径参数未展开。');
              continue;
            }
            const id = `code_${verb}_${digest(path).slice(0, 20)}`;
            if (seen.has(id)) {
              warn(file, mapping.start, `重复映射 ${id}，保留首次发现并要求复核。`);
              continue;
            }
            seen.add(id);
            const endpoint: Endpoint = {
              id,
              method: verb as Endpoint['method'],
              path,
              summary: signature[1],
              deprecated: false,
              parameters: [],
              requestBodies: [],
              responses: [...statuses].sort().map((statusCode) => ({
                id: `status_${statusCode}`,
                statusCode,
                description: 'Controller 显式返回状态；异常、鉴权与业务分支需另行核验。',
              })),
              sourceLocations: [location(file, mapping.start)],
              extra: {
                repositoryUrl: snapshot.repositoryUrl,
                commit: snapshot.commit,
                framework: 'Spring MVC',
                reviewRequired: true,
              },
            };
            for (const a of all.filter((a) => a.start > parameterStart && a.start < parameterEnd)) {
              const declaration = source
                .slice(a.end, parameterEnd)
                .match(/^\s*([\w.]+)(?:<[^>]*>)?\s+(\w+)/);
              if (!declaration) continue;
              const type = declaration[1] ?? '';
              const variable = declaration[2] ?? '';
              if (a.name === 'RequestBody') {
                const ref = `/schemas/${type}`;
                if (model.schemas[ref])
                  endpoint.requestBodies.push({
                    id: 'body',
                    required: !/required\s*=\s*false/.test(a.args),
                    content: { 'application/json': { schema: { ref } } },
                    sourceLocation: location(file, a.start),
                  });
                else warn(file, a.start, `请求体 ${type} 未解析；生成前需补充结构。`);
              }
              if (['RequestParam', 'PathVariable', 'RequestHeader'].includes(a.name)) {
                const name =
                  a.args.match(/(?:name|value)\s*=\s*"([^"\\]+)"/)?.[1] ??
                  a.args.match(/^\s*"([^"\\]+)"/)?.[1] ??
                  variable;
                const ref = `/schemas/parameter_${javaType(type) ?? 'string'}`;
                model.schemas[ref] = { id: ref, type: javaType(type) ?? 'string' };
                endpoint.parameters.push({
                  id: name,
                  name,
                  in:
                    a.name === 'PathVariable'
                      ? 'path'
                      : a.name === 'RequestHeader'
                        ? 'header'
                        : 'query',
                  required:
                    a.name === 'PathVariable' ||
                    !/required\s*=\s*false|defaultValue\s*=/.test(a.args),
                  deprecated: false,
                  allowEmptyValue: false,
                  schema: { ref },
                  sourceLocation: location(file, a.start),
                });
              }
            }
            for (const param of path.matchAll(/\{([^}]+)\}/g))
              if (!endpoint.parameters.some((p) => p.in === 'path' && p.name === param[1])) {
                endpoint.parameters.push({
                  id: param[1] as string,
                  name: param[1] as string,
                  in: 'path',
                  required: true,
                  deprecated: false,
                  allowEmptyValue: false,
                });
              }
            model.endpoints.push(endpoint);
          }
    }
  }
  model.diagnostics.push({
    severity: 'warning',
    code: 'STATIC_CODE_EVIDENCE',
    message:
      '静态发现仅覆盖 Spring REST Controller 的字面量映射、简单 DTO 与显式响应状态；鉴权拦截器、异常映射、服务层逻辑、嵌套泛型与动态路由未验证。生成结果需要人工审阅。',
  });
  return CanonicalApiModelSchema.parse(model);
}
