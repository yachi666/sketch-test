/**
 * Postman execution-model preservation.
 *
 * CanonicalApiModel deliberately represents API shape, not the full Postman
 * runtime. This module keeps the source execution semantics beside the
 * canonical projection so an import never silently discards scripts, scope,
 * ordering, examples, or extension resources.
 */
import type { PostmanCollection, PostmanEvent, PostmanItem, PostmanVariable } from './types.js';

export const POSTMAN_EXECUTION_MODEL_VERSION = 'sketch-test.postman-execution/v1';

export interface PostmanExecutionScript {
  scope: 'collection' | 'folder' | 'request';
  itemPath: string;
  listen: 'test' | 'prerequest' | string;
  disabled: boolean;
  sourcePath?: string;
  source: string;
}

export interface PostmanExecutionRequest {
  itemPath: string;
  name: string;
  order: number;
  method: string;
  url: unknown;
  auth?: unknown;
  variables: PostmanVariable[];
  scripts: PostmanExecutionScript[];
  examples: unknown[];
}

export interface PostmanExecutionModel {
  schemaVersion: typeof POSTMAN_EXECUTION_MODEL_VERSION;
  format: 'v2.1' | 'v3.0';
  collection: {
    name: string;
    description?: string;
    variables: PostmanVariable[];
    auth?: unknown;
    scripts: PostmanExecutionScript[];
  };
  requests: PostmanExecutionRequest[];
  resources: Array<{ path: string; mediaType: string; content: string }>;
}

function eventScripts(
  events: PostmanEvent[] | undefined,
  scope: PostmanExecutionScript['scope'],
  itemPath: string,
): PostmanExecutionScript[] {
  if (!events) return [];
  return events.map((event) => ({
    scope,
    itemPath,
    listen: event.listen,
    disabled: event.disabled === true,
    source: event.script.exec?.join('\n') ?? event.script.src ?? '',
  }));
}

/** Build a lossless execution manifest for a v2.1 collection. */
export function buildV2ExecutionModel(collection: PostmanCollection): PostmanExecutionModel {
  const requests: PostmanExecutionRequest[] = [];
  let order = 0;

  const visit = (
    items: PostmanItem[],
    parentPath: string,
    inheritedScripts: PostmanExecutionScript[],
  ) => {
    for (const item of items) {
      const itemPath = parentPath ? `${parentPath}/${item.name}` : item.name;
      const folderScripts = item.request
        ? inheritedScripts
        : [...inheritedScripts, ...eventScripts(item.event, 'folder', itemPath)];
      if (item.request) {
        requests.push({
          itemPath,
          name: item.name,
          order: order++,
          method: item.request.method,
          url: item.request.url,
          auth: item.request.auth ?? item.auth,
          variables: item.variable ?? [],
          scripts: [...folderScripts, ...eventScripts(item.event, 'request', itemPath)],
          examples: item.response ?? [],
        });
      }
      if (item.item) visit(item.item, itemPath, folderScripts);
    }
  };

  visit(collection.item, '', []);
  return {
    schemaVersion: POSTMAN_EXECUTION_MODEL_VERSION,
    format: 'v2.1',
    collection: {
      name: collection.info.name,
      description: collection.info.description,
      variables: collection.variable ?? [],
      auth: collection.auth,
      scripts: eventScripts(collection.event, 'collection', ''),
    },
    requests,
    resources: [],
  };
}
