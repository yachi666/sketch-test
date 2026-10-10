/**
 * Postman Collection v3 bundle parser.
 *
 * Postman v3 collections are directory trees: request YAML files plus optional
 * definition files and sibling resources. We accept a caller-supplied virtual
 * file map so the adapter remains filesystem-independent and safe for uploads.
 */
import type { Diagnostic } from '@sketch-test/contracts-common';
import { parseDocument } from 'yaml';
import type {
  PostmanExecutionModel,
  PostmanExecutionRequest,
  PostmanExecutionScript,
} from '../execution-model.js';
import { POSTMAN_EXECUTION_MODEL_VERSION } from '../execution-model.js';
import type {
  PostmanCollection,
  PostmanEvent,
  PostmanItem,
  PostmanRequest,
  PostmanVariable,
} from '../types.js';

export interface PostmanV3Bundle {
  /** Relative POSIX paths and UTF-8 contents from one collection directory. */
  files: Record<string, string>;
  /** Optional root directory inside the virtual bundle. */
  rootPath?: string;
}

export interface ParsedPostmanV3Bundle {
  collection: PostmanCollection | null;
  executionModel: PostmanExecutionModel | null;
  diagnostics: Diagnostic[];
}

type RecordValue = Record<string, unknown>;

function normalizePath(value: string): string | null {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..'))
    return null;
  return normalized;
}

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseYaml(path: string, content: string, diagnostics: Diagnostic[]): RecordValue | null {
  const parsed = parseDocument(content);
  if (parsed.errors.length > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'POSTMAN_V3_YAML_PARSE_ERROR',
      path,
      message: `Postman v3 YAML parse failed for ${path}: ${parsed.errors[0]?.message ?? 'unknown error'}`,
    });
    return null;
  }
  const value = asRecord(parsed.toJS());
  if (!value) {
    diagnostics.push({
      severity: 'error',
      code: 'POSTMAN_V3_INVALID_DOCUMENT',
      path,
      message: `Postman v3 YAML document ${path} must contain an object.`,
    });
  }
  return value;
}

function variables(value: unknown): PostmanVariable[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const key = record && asString(record['key'] ?? record['name']);
    if (!record || !key) return [];
    const raw = record['value'] ?? record['default'] ?? '';
    return [
      {
        key,
        value: typeof raw === 'string' ? raw : JSON.stringify(raw),
        description: asString(record['description']),
        disabled: record['disabled'] === true,
      },
    ];
  });
}

function headers(value: unknown): Array<{ key: string; value: string; disabled?: boolean }> {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const record = asRecord(entry);
      const key = record && asString(record['key'] ?? record['name']);
      if (!record || !key) return [];
      const raw = record['value'] ?? '';
      return [
        {
          key,
          value: typeof raw === 'string' ? raw : JSON.stringify(raw),
          disabled: record['disabled'] === true,
        },
      ];
    });
  }
  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record).map(([key, raw]) => ({
    key,
    value: typeof raw === 'string' ? raw : JSON.stringify(raw),
  }));
}

function v3Request(
  document: RecordValue,
  path: string,
  diagnostics: Diagnostic[],
): PostmanRequest | null {
  const request = asRecord(document['request']) ?? document;
  const method = asString(request['method'])?.toUpperCase();
  const urlValue = request['url'] ?? request['address'];
  const url = typeof urlValue === 'string' ? urlValue : asString(asRecord(urlValue)?.['raw']);
  if (!method || !url) {
    diagnostics.push({
      severity: 'error',
      code: 'POSTMAN_V3_INVALID_REQUEST',
      path,
      message: `Postman v3 request ${path} requires method and url.`,
    });
    return null;
  }
  const bodyValue = request['body'];
  const body =
    typeof bodyValue === 'string'
      ? { mode: 'raw' as const, raw: bodyValue }
      : asRecord(bodyValue)
        ? {
            mode: (asString(asRecord(bodyValue)?.['mode']) ?? 'raw') as 'raw',
            raw: asString(asRecord(bodyValue)?.['raw'] ?? asRecord(bodyValue)?.['content']),
          }
        : undefined;
  return {
    method,
    url,
    header: headers(request['headers'] ?? request['header']),
    body,
    description: asString(document['description'] ?? request['description']),
    auth: asRecord(request['auth']) as PostmanRequest['auth'],
  };
}

function mediaType(path: string): string {
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'application/yaml';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs'))
    return 'text/javascript';
  return 'text/plain';
}

function scriptListen(path: string): 'test' | 'prerequest' | string {
  const name = path.toLowerCase();
  return name.includes('pre-request') || name.includes('prerequest') ? 'prerequest' : 'test';
}

function fractionalIndex(document: RecordValue): number | null {
  const request = asRecord(document['request']);
  const candidate =
    document['order'] ?? document['index'] ?? request?.['order'] ?? request?.['index'];
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === 'string' && candidate.trim() !== '') {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function addNestedItem(items: PostmanItem[], itemPath: string, item: PostmanItem): void {
  const segments = itemPath.split('/');
  const requestName = segments.pop();
  if (!requestName) return;
  let siblings = items;
  for (const segment of segments) {
    let folder = siblings.find((candidate) => candidate.name === segment && candidate.item);
    if (!folder) {
      folder = { name: segment, item: [] };
      siblings.push(folder);
    }
    if (!folder.item) folder.item = [];
    siblings = folder.item;
  }
  siblings.push(item);
}

/**
 * Parse a Postman v3 directory export. Unknown resources are kept verbatim in
 * the execution model, which makes the parser forward-compatible with v3's
 * extensible resource directories.
 */
export function parsePostmanV3Bundle(input: PostmanV3Bundle): ParsedPostmanV3Bundle {
  const diagnostics: Diagnostic[] = [];
  const root = input.rootPath ? normalizePath(input.rootPath)?.replace(/\/$/, '') : '';
  if (input.rootPath && root == null) {
    return {
      collection: null,
      executionModel: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'POSTMAN_V3_INVALID_ROOT',
          message: 'Postman v3 rootPath must be a safe relative POSIX path.',
        },
      ],
    };
  }

  const files = Object.entries(input.files).flatMap(([rawPath, content]) => {
    const path = normalizePath(rawPath);
    if (!path) {
      diagnostics.push({
        severity: 'error',
        code: 'POSTMAN_V3_INVALID_PATH',
        message: `Postman v3 bundle contains unsafe path: ${rawPath}`,
      });
      return [];
    }
    if (typeof content !== 'string') {
      diagnostics.push({
        severity: 'error',
        code: 'POSTMAN_V3_INVALID_FILE',
        path,
        message: `Postman v3 file ${path} must be UTF-8 text.`,
      });
      return [];
    }
    if (root && path !== root && !path.startsWith(`${root}/`)) return [];
    return [
      { path: root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path, content },
    ];
  });
  if (files.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'POSTMAN_V3_EMPTY_BUNDLE',
      message: 'Postman v3 bundle has no files inside its root.',
    });
    return { collection: null, executionModel: null, diagnostics };
  }

  const definition = files.find(
    (file) => file.path === 'definition.yaml' || file.path === 'definition.yml',
  );
  const definitionDocument = definition
    ? parseYaml(definition.path, definition.content, diagnostics)
    : null;
  const definitionInfo = asRecord(definitionDocument?.['info']);
  const collectionName =
    asString(definitionDocument?.['name'] ?? definitionInfo?.['name']) ??
    (root?.split('/').at(-1) || 'Postman v3 collection');
  const collectionEvents: PostmanEvent[] = [];
  const collectionScripts: PostmanExecutionScript[] = [];
  const requests: PostmanExecutionRequest[] = [];
  const items: PostmanItem[] = [];
  const requestFiles = files
    .filter((file) => file.path.endsWith('.request.yaml') || file.path.endsWith('.request.yml'))
    .map((file) => {
      const document = parseYaml(file.path, file.content, diagnostics);
      return { ...file, document, index: document ? fractionalIndex(document) : null };
    })
    .sort((a, b) => {
      if (a.index != null && b.index != null && a.index !== b.index) return a.index - b.index;
      if (a.index != null && b.index == null) return -1;
      if (a.index == null && b.index != null) return 1;
      return a.path.localeCompare(b.path);
    });

  for (const [order, file] of requestFiles.entries()) {
    const document = file.document;
    if (!document) continue;
    const request = v3Request(document, file.path, diagnostics);
    if (!request) continue;
    const itemPath = file.path.replace(/\.request\.ya?ml$/, '');
    const requestName = asString(document['name']) ?? itemPath.split('/').at(-1) ?? itemPath;
    const requestScripts: PostmanExecutionScript[] = [];
    const resourcePrefix = `${itemPath}.resources/scripts/`;
    for (const resource of files.filter((candidate) => candidate.path.startsWith(resourcePrefix))) {
      const listen = scriptListen(resource.path);
      const source = resource.content;
      requestScripts.push({
        scope: 'request',
        itemPath,
        listen,
        disabled: false,
        sourcePath: resource.path,
        source,
      });
    }
    const event = requestScripts.map((script) => ({
      listen: script.listen as 'test' | 'prerequest',
      script: { exec: script.source.split('\n') },
    }));
    const examples = files
      .filter((candidate) => candidate.path.startsWith(`${itemPath}.resources/examples/`))
      .map((candidate) => ({ sourcePath: candidate.path, content: candidate.content }));
    const variablesForRequest = variables(document['variables']);
    requests.push({
      itemPath,
      name: requestName,
      order,
      method: request.method,
      url: request.url,
      auth: request.auth,
      variables: variablesForRequest,
      scripts: requestScripts,
      examples,
    });
    addNestedItem(items, itemPath, {
      name: requestName,
      request,
      event,
      variable: variablesForRequest,
      description: asString(document['description']),
    });
  }

  for (const resource of files.filter((file) => file.path.startsWith('.resources/scripts/'))) {
    const script: PostmanExecutionScript = {
      scope: 'collection',
      itemPath: '',
      listen: scriptListen(resource.path),
      disabled: false,
      sourcePath: resource.path,
      source: resource.content,
    };
    collectionScripts.push(script);
    collectionEvents.push({
      listen: script.listen as 'test' | 'prerequest',
      script: { exec: script.source.split('\n') },
    });
  }

  if (requestFiles.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'POSTMAN_V3_EMPTY_COLLECTION',
      message: 'Postman v3 bundle contains no *.request.yaml files.',
    });
  }
  const collection: PostmanCollection = {
    info: {
      name: collectionName,
      schema: 'https://schema.postman.com/collection/yaml/v3.0.0/collection.yaml',
      description: asString(definitionDocument?.['description']),
    },
    item: items,
    auth: asRecord(definitionDocument?.['auth']) as PostmanCollection['auth'],
    variable: variables(definitionDocument?.['variables']),
    event: collectionEvents,
  };
  const executionModel: PostmanExecutionModel = {
    schemaVersion: POSTMAN_EXECUTION_MODEL_VERSION,
    format: 'v3.0',
    collection: {
      name: collectionName,
      description: collection.info.description,
      variables: collection.variable ?? [],
      auth: collection.auth,
      scripts: collectionScripts,
    },
    requests,
    resources: files.map((file) => ({
      path: file.path,
      mediaType: mediaType(file.path),
      content: file.content,
    })),
  };
  return {
    collection: diagnostics.some((diagnostic) => diagnostic.severity === 'error')
      ? null
      : collection,
    executionModel,
    diagnostics,
  };
}
