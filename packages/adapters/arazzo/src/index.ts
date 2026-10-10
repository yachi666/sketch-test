import type { CanonicalApiModel, Endpoint } from '@sketch-test/canonical-api-model';
import type { Diagnostic, EntityId } from '@sketch-test/contracts-common';
import {
  WORKFLOW_DSL_VERSION,
  type WorkflowAssertion,
  type WorkflowDefinition,
  WorkflowDefinitionSchema,
  type WorkflowExtraction,
  type WorkflowStep,
} from '@sketch-test/workflow-dsl';
import { parseDocument, stringify } from 'yaml';

export const SUPPORTED_ARAZZO_VERSIONS = ['1.1.0'] as const;

export interface ArazzoAdapterOptions {
  sourceLabel: string;
  /** Canonical OpenAPI sources keyed by Source Description Object name. */
  openApiSources: Readonly<Record<string, CanonicalApiModel | ArazzoOpenApiSourceBinding>>;
  /** Absolute retrieval URL used to resolve relative source-description URLs. */
  documentUrl?: string;
  /** Reject source bindings without retrieval URL and content-hash evidence. */
  requireVerifiedSources?: boolean;
  maxSourceBytes?: number;
  maxYamlAliasCount?: number;
}

export interface ArazzoOpenApiSourceBinding {
  model: CanonicalApiModel;
  retrievalUrl: string;
  contentHash: string;
}

export interface ArazzoImportResult {
  success: boolean;
  workflows: WorkflowDefinition[];
  diagnostics: Diagnostic[];
  sourceDescriptions: Array<{ name: string; url: string; type: string }>;
}

export interface ArazzoExportOptions {
  info: { title: string; version: string; summary?: string; description?: string };
  sourceDescriptions: Array<{ name: string; url: string; type?: 'openapi' }>;
  openApiSources: Readonly<Record<string, CanonicalApiModel>>;
}

export interface ArazzoExportResult {
  success: boolean;
  source: string | null;
  diagnostics: Diagnostic[];
}

interface ArazzoDocument {
  arazzo: string;
  info: { title: string; version: string; summary?: string; description?: string };
  sourceDescriptions: ArazzoSourceDescription[];
  workflows: ArazzoWorkflow[];
}

interface ArazzoSourceDescription {
  name: string;
  url: string;
  type?: string;
}

interface ArazzoWorkflow {
  workflowId: string;
  summary?: string;
  description?: string;
  inputs?: unknown;
  dependsOn?: string[];
  parameters?: ArazzoParameter[];
  steps: ArazzoStep[];
  successActions?: unknown[];
  failureActions?: unknown[];
  outputs?: Record<string, unknown>;
}

interface ArazzoStep {
  stepId: string;
  description?: string;
  operationId?: string;
  operationPath?: string;
  workflowId?: string;
  channelPath?: string;
  action?: string;
  dependsOn?: string[];
  parameters?: ArazzoParameter[];
  requestBody?: { contentType?: string; payload?: unknown; replacements?: unknown[] };
  successCriteria?: ArazzoCriterion[];
  onSuccess?: unknown[];
  onFailure?: ArazzoFailureAction[];
  outputs?: Record<string, unknown>;
  timeout?: number;
}

interface ArazzoParameter {
  name?: string;
  in?: string;
  value?: unknown;
  reference?: string;
}

interface ArazzoCriterion {
  condition?: string;
  context?: string;
  type?: string | { type?: string; version?: string };
}

interface ArazzoFailureAction {
  name?: string;
  type?: string;
  retryAfter?: number;
  retryLimit?: number;
  criteria?: unknown[];
  stepId?: string;
  workflowId?: string;
}

const DEFAULT_MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_YAML_ALIAS_COUNT = 100;

function diagnostic(
  code: string,
  message: string,
  path: string,
  severity: Diagnostic['severity'] = 'error',
): Diagnostic {
  return { severity, code, message, path };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSourceBinding(
  value: CanonicalApiModel | ArazzoOpenApiSourceBinding,
): value is ArazzoOpenApiSourceBinding {
  return 'model' in value && 'retrievalUrl' in value && 'contentHash' in value;
}

function sourceModel(
  value: CanonicalApiModel | ArazzoOpenApiSourceBinding | undefined,
): CanonicalApiModel | undefined {
  return value && isSourceBinding(value) ? value.model : value;
}

function parseArazzoSource(
  source: string,
  options: ArazzoAdapterOptions,
): { document?: ArazzoDocument; diagnostics: Diagnostic[] } {
  const sourceBytes = new TextEncoder().encode(source).byteLength;
  const maxBytes = options.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES;
  if (sourceBytes > maxBytes) {
    return {
      diagnostics: [
        diagnostic(
          'ARAZZO_SOURCE_TOO_LARGE',
          `Arazzo source is ${sourceBytes} bytes; the configured limit is ${maxBytes} bytes.`,
          '$',
        ),
      ],
    };
  }

  const parsed = parseDocument(source, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
    version: '1.2',
  });
  if (parsed.errors.length > 0) {
    return {
      diagnostics: [
        diagnostic(
          'INVALID_ARAZZO_SYNTAX',
          `Arazzo source is not valid JSON or YAML 1.2: ${parsed.errors[0]?.message ?? 'parse failed'}`,
          '$',
        ),
      ],
    };
  }

  let value: unknown;
  try {
    value = parsed.toJS({
      maxAliasCount: options.maxYamlAliasCount ?? DEFAULT_MAX_YAML_ALIAS_COUNT,
    });
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          'ARAZZO_ALIAS_BUDGET_EXCEEDED',
          `Arazzo YAML alias expansion exceeded the configured safety budget: ${error instanceof Error ? error.message : String(error)}`,
          '$',
        ),
      ],
    };
  }

  if (!isRecord(value)) {
    return {
      diagnostics: [
        diagnostic('INVALID_ARAZZO_DOCUMENT', 'Arazzo document must be an object.', '$'),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  if (value['arazzo'] !== '1.1.0') {
    diagnostics.push(
      diagnostic(
        'UNSUPPORTED_ARAZZO_VERSION',
        `Arazzo version ${String(value['arazzo'])} is not supported; supported versions: ${SUPPORTED_ARAZZO_VERSIONS.join(', ')}.`,
        '$.arazzo',
      ),
    );
  }
  if (!isRecord(value['info'])) {
    diagnostics.push(diagnostic('INVALID_ARAZZO_INFO', 'Arazzo info must be an object.', '$.info'));
  } else if (
    typeof value['info']['title'] !== 'string' ||
    typeof value['info']['version'] !== 'string'
  ) {
    diagnostics.push(
      diagnostic(
        'INVALID_ARAZZO_INFO',
        'Arazzo info.title and info.version must be strings.',
        '$.info',
      ),
    );
  }
  if (!Array.isArray(value['sourceDescriptions']) || value['sourceDescriptions'].length === 0) {
    diagnostics.push(
      diagnostic(
        'INVALID_ARAZZO_SOURCES',
        'Arazzo sourceDescriptions must be a non-empty array.',
        '$.sourceDescriptions',
      ),
    );
  } else {
    value['sourceDescriptions'].forEach((sourceDescription, index) => {
      if (
        !isRecord(sourceDescription) ||
        typeof sourceDescription['name'] !== 'string' ||
        typeof sourceDescription['url'] !== 'string' ||
        (sourceDescription['type'] !== undefined && typeof sourceDescription['type'] !== 'string')
      ) {
        diagnostics.push(
          diagnostic(
            'INVALID_ARAZZO_SOURCE',
            'Each source description requires string name and url fields.',
            `$.sourceDescriptions[${index}]`,
          ),
        );
      }
    });
  }
  if (!Array.isArray(value['workflows']) || value['workflows'].length === 0) {
    diagnostics.push(
      diagnostic(
        'INVALID_ARAZZO_WORKFLOWS',
        'Arazzo workflows must be a non-empty array.',
        '$.workflows',
      ),
    );
  } else {
    value['workflows'].forEach((workflow, workflowIndex) => {
      if (
        !isRecord(workflow) ||
        typeof workflow['workflowId'] !== 'string' ||
        !Array.isArray(workflow['steps']) ||
        workflow['steps'].length === 0
      ) {
        diagnostics.push(
          diagnostic(
            'INVALID_ARAZZO_WORKFLOW',
            'Each workflow requires workflowId and a non-empty steps array.',
            `$.workflows[${workflowIndex}]`,
          ),
        );
        return;
      }
      workflow['steps'].forEach((step, stepIndex) => {
        if (!isRecord(step) || typeof step['stepId'] !== 'string') {
          diagnostics.push(
            diagnostic(
              'INVALID_ARAZZO_STEP',
              'Each workflow step requires a string stepId.',
              `$.workflows[${workflowIndex}].steps[${stepIndex}]`,
            ),
          );
        }
      });
    });
  }

  return diagnostics.length > 0
    ? { diagnostics }
    : { document: value as unknown as ArazzoDocument, diagnostics };
}

function translateRuntimeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const input = value.match(/^\$inputs\.([A-Za-z0-9_.-]+)$/);
    if (input) return `\${${input[1]}}`;
    const stepOutput = value.match(/^\$steps\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_.-]+)$/);
    if (stepOutput) return `\${${stepOutput[1]}.${stepOutput[2]}}`;
    return value;
  }
  if (Array.isArray(value)) return value.map(translateRuntimeValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, translateRuntimeValue(child)]),
    );
  }
  return value;
}

function resolveOperation(
  operationId: string,
  options: ArazzoAdapterOptions,
  path: string,
): { endpoint?: Endpoint; model?: CanonicalApiModel; diagnostics: Diagnostic[] } {
  let sourceName: string | undefined;
  let targetOperationId = operationId;
  const qualified = operationId.match(
    /^\$sourceDescriptions\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_.-]+)$/,
  );
  if (qualified) {
    sourceName = qualified[1];
    targetOperationId = qualified[2] ?? operationId;
  }

  const candidates = sourceName
    ? [[sourceName, sourceModel(options.openApiSources[sourceName])] as const]
    : Object.entries(options.openApiSources).map(
        ([name, source]) => [name, sourceModel(source)] as const,
      );
  const matches = candidates.flatMap(([_name, model]) =>
    model
      ? model.endpoints
          .filter((endpoint) => endpoint.operationId === targetOperationId)
          .map((endpoint) => ({ model, endpoint }))
      : [],
  );

  if (matches.length === 0) {
    return {
      diagnostics: [
        diagnostic(
          'ARAZZO_OPERATION_NOT_FOUND',
          `Arazzo operationId "${operationId}" did not resolve to an imported OpenAPI operation.`,
          path,
        ),
      ],
    };
  }
  if (matches.length > 1) {
    return {
      diagnostics: [
        diagnostic(
          'ARAZZO_OPERATION_AMBIGUOUS',
          `Arazzo operationId "${operationId}" matches multiple source descriptions; qualify it with $sourceDescriptions.<name>.`,
          path,
        ),
      ],
    };
  }
  const match = matches[0];
  return { endpoint: match?.endpoint, model: match?.model, diagnostics: [] };
}

function joinServerAndPath(serverUrl: string, endpointPath: string): string {
  return `${serverUrl.replace(/\/$/, '')}/${endpointPath.replace(/^\//, '')}`;
}

function pointerToJsonPath(pointer: string): string {
  if (!pointer.startsWith('#/')) return pointer;
  return `$.${pointer
    .slice(2)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .join('.')}`;
}

function mapOutputs(
  outputs: Record<string, unknown> | undefined,
  path: string,
): { extractions: WorkflowExtraction[]; diagnostics: Diagnostic[] } {
  const extractions: WorkflowExtraction[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const [name, expression] of Object.entries(outputs ?? {})) {
    if (typeof expression !== 'string') {
      diagnostics.push(
        diagnostic(
          'ARAZZO_SELECTOR_NOT_SUPPORTED',
          `Selector output "${name}" is outside the supported runtime-expression subset.`,
          `${path}.${name}`,
        ),
      );
      continue;
    }
    if (expression.startsWith('$response.body#/')) {
      extractions.push({
        name,
        source: 'body',
        expression: pointerToJsonPath(expression.slice('$response.body'.length)),
        scope: 'workflow',
      });
    } else if (expression.startsWith('$response.header.')) {
      extractions.push({
        name,
        source: 'header',
        expression: expression.slice('$response.header.'.length),
        scope: 'workflow',
      });
    } else if (expression === '$statusCode') {
      extractions.push({ name, source: 'status', expression: '$', scope: 'workflow' });
    } else {
      diagnostics.push(
        diagnostic(
          'ARAZZO_RUNTIME_EXPRESSION_NOT_SUPPORTED',
          `Output expression "${expression}" is outside the supported subset.`,
          `${path}.${name}`,
        ),
      );
    }
  }
  return { extractions, diagnostics };
}

function mapCriteria(
  criteria: ArazzoCriterion[] | undefined,
  path: string,
): { assertions: WorkflowAssertion[]; diagnostics: Diagnostic[] } {
  const assertions: WorkflowAssertion[] = [];
  const diagnostics: Diagnostic[] = [];
  for (let index = 0; index < (criteria ?? []).length; index += 1) {
    const criterion = criteria?.[index];
    const condition = criterion?.condition?.trim();
    const status = condition?.match(/^\$statusCode\s*==\s*(\d{3})$/);
    if (status) {
      assertions.push({ target: 'status', operator: 'equals', expected: Number(status[1]) });
    } else {
      diagnostics.push(
        diagnostic(
          'ARAZZO_CRITERION_NOT_SUPPORTED',
          `Criterion "${condition ?? ''}" is outside the supported simple status subset.`,
          `${path}[${index}]`,
        ),
      );
    }
  }
  return { assertions, diagnostics };
}

function inferSideEffect(method: Endpoint['method']): WorkflowStep['sideEffect'] {
  return method === 'GET' || method === 'HEAD' || method === 'QUERY'
    ? 'read-only'
    : 'cleanup-required';
}

function mapStep(
  step: ArazzoStep,
  workflowParameters: ArazzoParameter[],
  options: ArazzoAdapterOptions,
  path: string,
): { step?: WorkflowStep; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  if (step.workflowId) {
    return {
      diagnostics: [
        diagnostic(
          'ARAZZO_WORKFLOW_CHAINING_NOT_SUPPORTED',
          'Nested workflow calls are not part of the sequential HTTP subset.',
          `${path}.workflowId`,
        ),
      ],
    };
  }
  if (step.channelPath || step.action) {
    return {
      diagnostics: [
        diagnostic(
          'ARAZZO_ASYNCAPI_NOT_SUPPORTED',
          'AsyncAPI send/receive steps require a separate execution engine.',
          path,
        ),
      ],
    };
  }
  if (step.operationPath) {
    return {
      diagnostics: [
        diagnostic(
          'ARAZZO_OPERATION_PATH_NOT_SUPPORTED',
          'operationPath resolution is not enabled; use a resolvable operationId.',
          `${path}.operationPath`,
        ),
      ],
    };
  }
  if (!step.operationId) {
    return {
      diagnostics: [
        diagnostic('ARAZZO_OPERATION_REQUIRED', 'Sequential HTTP steps require operationId.', path),
      ],
    };
  }
  if (step.dependsOn && step.dependsOn.length > 0) {
    diagnostics.push(
      diagnostic(
        'ARAZZO_DEPENDS_ON_NOT_SUPPORTED',
        'Explicit dependency graphs are outside the sequential execution subset.',
        `${path}.dependsOn`,
      ),
    );
  }
  if (step.onSuccess && step.onSuccess.length > 0) {
    diagnostics.push(
      diagnostic(
        'ARAZZO_CONTROL_FLOW_NOT_SUPPORTED',
        'Conditional success actions are outside the sequential execution subset.',
        `${path}.onSuccess`,
      ),
    );
  }

  const resolved = resolveOperation(step.operationId, options, `${path}.operationId`);
  diagnostics.push(...resolved.diagnostics);
  const endpoint = resolved.endpoint;
  const model = resolved.model;
  if (!endpoint || !model) return { diagnostics };
  const serverUrl = model.servers[0]?.url;
  if (!serverUrl) {
    diagnostics.push(
      diagnostic(
        'ARAZZO_SERVER_REQUIRED',
        `Operation "${step.operationId}" has no canonical server URL.`,
        `${path}.operationId`,
      ),
    );
    return { diagnostics };
  }

  let url = joinServerAndPath(serverUrl, endpoint.path);
  const headers: Record<string, string> = {};
  const mergedParameters = new Map<string, ArazzoParameter>();
  for (const parameter of [...workflowParameters, ...(step.parameters ?? [])]) {
    if (parameter.reference) {
      diagnostics.push(
        diagnostic(
          'ARAZZO_REUSABLE_NOT_SUPPORTED',
          'Reusable parameter references are not enabled in the supported subset.',
          `${path}.parameters`,
        ),
      );
      continue;
    }
    mergedParameters.set(`${parameter.in}:${parameter.name}`, parameter);
  }

  const query: string[] = [];
  for (const parameter of mergedParameters.values()) {
    if (!parameter.name || !parameter.in || parameter.value === undefined) {
      diagnostics.push(
        diagnostic(
          'INVALID_ARAZZO_PARAMETER',
          'Operation parameters require name, in, and value.',
          `${path}.parameters`,
        ),
      );
      continue;
    }
    const value = String(translateRuntimeValue(parameter.value));
    if (parameter.in === 'path') {
      url = url.replace(`:${parameter.name}`, value);
    } else if (parameter.in === 'query') {
      query.push(`${encodeURIComponent(parameter.name)}=${value}`);
    } else if (parameter.in === 'header') {
      headers[parameter.name] = value;
    } else if (parameter.in === 'cookie') {
      headers['Cookie'] = `${parameter.name}=${value}`;
    } else if (parameter.in === 'querystring') {
      diagnostics.push(
        diagnostic(
          'ARAZZO_QUERYSTRING_NOT_EXECUTABLE',
          'Whole-query-string serialization is not implemented.',
          `${path}.parameters`,
        ),
      );
    } else {
      diagnostics.push(
        diagnostic(
          'INVALID_ARAZZO_PARAMETER_LOCATION',
          `Unsupported parameter location "${parameter.in}".`,
          `${path}.parameters`,
        ),
      );
    }
  }
  if (query.length > 0) url += `${url.includes('?') ? '&' : '?'}${query.join('&')}`;

  if (step.requestBody?.replacements && step.requestBody.replacements.length > 0) {
    diagnostics.push(
      diagnostic(
        'ARAZZO_PAYLOAD_REPLACEMENTS_NOT_SUPPORTED',
        'Payload replacements are outside the supported request-body subset.',
        `${path}.requestBody.replacements`,
      ),
    );
  }
  if (step.requestBody?.contentType) headers['Content-Type'] = step.requestBody.contentType;

  const criteria = mapCriteria(step.successCriteria, `${path}.successCriteria`);
  diagnostics.push(...criteria.diagnostics);
  const outputs = mapOutputs(step.outputs, `${path}.outputs`);
  diagnostics.push(...outputs.diagnostics);

  let retry: WorkflowStep['retry'];
  if (step.onFailure && step.onFailure.length > 0) {
    const action = step.onFailure.length === 1 ? step.onFailure[0] : undefined;
    if (
      action?.type === 'retry' &&
      !action.criteria?.length &&
      !action.stepId &&
      !action.workflowId
    ) {
      const retryLimit = action.retryLimit ?? 0;
      const retryAfter = action.retryAfter ?? 1;
      if (retryLimit <= 10 && retryAfter >= 0 && retryAfter <= 60) {
        retry = {
          maxRetries: retryLimit,
          baseDelayMs: Math.max(1, Math.round(retryAfter * 1000)),
          backoffMultiplier: 1,
          retryOnNetworkError: true,
        };
      } else {
        diagnostics.push(
          diagnostic(
            'ARAZZO_RETRY_LIMIT_EXCEEDED',
            'Retry actions must fit the platform bounds: retryLimit <= 10 and retryAfter <= 60s.',
            `${path}.onFailure`,
          ),
        );
      }
    } else {
      diagnostics.push(
        diagnostic(
          'ARAZZO_FAILURE_ACTION_NOT_SUPPORTED',
          'Only one unconditional bounded retry action is supported.',
          `${path}.onFailure`,
        ),
      );
    }
  }

  const mapped: WorkflowStep = {
    id: step.stepId as EntityId,
    name: step.description ?? step.stepId,
    description: step.description,
    useTest: {
      kind: 'inline',
      method: endpoint.method,
      url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: translateRuntimeValue(step.requestBody?.payload),
    },
    assertions: criteria.assertions,
    extract: outputs.extractions,
    retry,
    onFailure: 'stop',
    enabled: true,
    timeoutMs: step.timeout,
    sideEffect: inferSideEffect(endpoint.method),
  };
  const validated = WorkflowDefinitionSchema.shape.steps.element.safeParse(mapped);
  if (!validated.success) {
    diagnostics.push(
      diagnostic(
        'ARAZZO_WORKFLOW_STEP_INVALID',
        validated.error.issues.map((issue) => issue.message).join('; '),
        path,
      ),
    );
    return { diagnostics };
  }
  return { step: validated.data, diagnostics };
}

export function importArazzoText(
  source: string,
  options: ArazzoAdapterOptions,
): ArazzoImportResult {
  const parsed = parseArazzoSource(source, options);
  if (!parsed.document) {
    return {
      success: false,
      workflows: [],
      diagnostics: parsed.diagnostics,
      sourceDescriptions: [],
    };
  }
  const document = parsed.document;
  const diagnostics = [...parsed.diagnostics];
  const sourceDescriptions = document.sourceDescriptions.map((sourceDescription, index) => {
    const type = sourceDescription.type ?? 'openapi';
    if (type !== 'openapi') {
      diagnostics.push(
        diagnostic(
          type === 'asyncapi'
            ? 'ARAZZO_ASYNCAPI_NOT_SUPPORTED'
            : 'ARAZZO_SOURCE_TYPE_NOT_SUPPORTED',
          `Source description type "${type}" is outside the OpenAPI execution boundary.`,
          `$.sourceDescriptions[${index}].type`,
        ),
      );
    }
    const suppliedSource = options.openApiSources[sourceDescription.name];
    if (!suppliedSource && type === 'openapi') {
      diagnostics.push(
        diagnostic(
          'ARAZZO_SOURCE_NOT_PROVIDED',
          `Canonical OpenAPI source "${sourceDescription.name}" was not supplied to the adapter.`,
          `$.sourceDescriptions[${index}]`,
        ),
      );
    } else if (suppliedSource && type === 'openapi') {
      if (isSourceBinding(suppliedSource)) {
        let expectedUrl: string | undefined;
        try {
          expectedUrl = new URL(sourceDescription.url, options.documentUrl).href;
        } catch {
          diagnostics.push(
            diagnostic(
              'ARAZZO_SOURCE_URL_NOT_RESOLVABLE',
              `Relative source URL "${sourceDescription.url}" requires an absolute documentUrl.`,
              `$.sourceDescriptions[${index}].url`,
            ),
          );
        }
        let actualUrl: string | undefined;
        try {
          actualUrl = new URL(suppliedSource.retrievalUrl).href;
        } catch {
          diagnostics.push(
            diagnostic(
              'ARAZZO_SOURCE_URL_NOT_RESOLVABLE',
              'Supplied retrieval URL must be absolute.',
              `$.sourceDescriptions[${index}].url`,
            ),
          );
        }
        if (expectedUrl && actualUrl && expectedUrl !== actualUrl) {
          diagnostics.push(
            diagnostic(
              'ARAZZO_SOURCE_URL_MISMATCH',
              `Resolved source URL "${expectedUrl}" does not match the supplied retrieval URL.`,
              `$.sourceDescriptions[${index}].url`,
            ),
          );
        }
        if (
          suppliedSource.contentHash !== suppliedSource.model.metadata.sourceHash ||
          !/^[a-f0-9]{64}$/.test(suppliedSource.contentHash)
        ) {
          diagnostics.push(
            diagnostic(
              'ARAZZO_SOURCE_HASH_MISMATCH',
              'Supplied source content hash does not match canonical source provenance.',
              `$.sourceDescriptions[${index}]`,
            ),
          );
        }
      } else if (options.requireVerifiedSources) {
        diagnostics.push(
          diagnostic(
            'ARAZZO_SOURCE_PROVENANCE_REQUIRED',
            `Source "${sourceDescription.name}" requires retrieval URL and content-hash evidence.`,
            `$.sourceDescriptions[${index}]`,
          ),
        );
      }
    }
    return { name: sourceDescription.name, url: sourceDescription.url, type };
  });

  const workflows: WorkflowDefinition[] = [];
  for (let workflowIndex = 0; workflowIndex < document.workflows.length; workflowIndex += 1) {
    const workflow = document.workflows[workflowIndex];
    if (!workflow) continue;
    const path = `$.workflows[${workflowIndex}]`;
    if (workflow.dependsOn?.length) {
      diagnostics.push(
        diagnostic(
          'ARAZZO_WORKFLOW_DEPENDENCY_NOT_SUPPORTED',
          'Workflow dependency graphs are outside the sequential subset.',
          `${path}.dependsOn`,
        ),
      );
    }
    if (workflow.successActions?.length || workflow.failureActions?.length) {
      diagnostics.push(
        diagnostic(
          'ARAZZO_CONTROL_FLOW_NOT_SUPPORTED',
          'Workflow-level success and failure actions are outside the sequential subset.',
          path,
        ),
      );
    }
    if (workflow.inputs !== undefined) {
      diagnostics.push(
        diagnostic(
          'ARAZZO_INPUT_SCHEMA_PRESERVED',
          'Workflow input schemas are retained in the raw source; runtime expressions are mapped as workflow inputs.',
          `${path}.inputs`,
          'info',
        ),
      );
    }
    if (workflow.outputs && Object.keys(workflow.outputs).length > 0) {
      diagnostics.push(
        diagnostic(
          'ARAZZO_WORKFLOW_OUTPUTS_PRESERVED',
          'Workflow-level outputs are retained in the raw source; step outputs drive executable variable flow.',
          `${path}.outputs`,
          'info',
        ),
      );
    }

    const steps: WorkflowStep[] = [];
    for (let stepIndex = 0; stepIndex < workflow.steps.length; stepIndex += 1) {
      const mapped = mapStep(
        workflow.steps[stepIndex] as ArazzoStep,
        workflow.parameters ?? [],
        options,
        `${path}.steps[${stepIndex}]`,
      );
      diagnostics.push(...mapped.diagnostics);
      if (mapped.step) steps.push(mapped.step);
    }

    if (steps.length > 0) {
      const candidate: WorkflowDefinition = {
        schemaVersion: WORKFLOW_DSL_VERSION,
        id: workflow.workflowId as EntityId,
        name: workflow.summary ?? workflow.workflowId,
        description: workflow.description,
        tags: ['arazzo-1.1'],
        steps,
      };
      const validated = WorkflowDefinitionSchema.safeParse(candidate);
      if (validated.success) {
        workflows.push(validated.data);
      } else {
        diagnostics.push(
          diagnostic(
            'ARAZZO_WORKFLOW_INVALID',
            validated.error.issues.map((issue) => issue.message).join('; '),
            path,
          ),
        );
      }
    }
  }

  const hasErrors = diagnostics.some((entry) => entry.severity === 'error');
  return {
    success: !hasErrors && workflows.length === document.workflows.length,
    workflows: hasErrors ? [] : workflows,
    diagnostics,
    sourceDescriptions,
  };
}

function reverseRuntimeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const reference = value.match(/^\$\{([A-Za-z0-9_.-]+)\}$/);
    if (!reference?.[1]) return value;
    const [stepId, ...outputParts] = reference[1].split('.');
    return outputParts.length > 0
      ? `$steps.${stepId}.outputs.${outputParts.join('.')}`
      : `$inputs.${stepId}`;
  }
  if (Array.isArray(value)) return value.map(reverseRuntimeValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, reverseRuntimeValue(child)]),
    );
  }
  return value;
}

function matchEndpointUrl(
  url: string,
  endpoint: Endpoint,
  model: CanonicalApiModel,
): { pathValues: Array<{ name: string; value: string }>; query: string } | null {
  const serverUrl = model.servers[0]?.url;
  if (!serverUrl) return null;
  const [urlWithoutQuery, query = ''] = url.split('?', 2);
  const pathNames: string[] = [];
  const tokenizedPath = endpoint.path.replace(/:([A-Za-z0-9_.-]+)/g, (_match, name: string) => {
    const index = pathNames.push(name) - 1;
    return `__ARAZZO_PATH_${index}__`;
  });
  let pattern = `${serverUrl.replace(/\/$/, '')}/${tokenizedPath.replace(/^\//, '')}`.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
  for (let index = 0; index < pathNames.length; index += 1) {
    pattern = pattern.replace(`__ARAZZO_PATH_${index}__`, '([^/?]+)');
  }
  const match = urlWithoutQuery?.match(new RegExp(`^${pattern}$`));
  if (!match) return null;
  return {
    pathValues: pathNames.map((name, index) => ({
      name,
      value: match[index + 1] ?? '',
    })),
    query,
  };
}

function resolveWorkflowStepForExport(
  step: WorkflowStep,
  options: ArazzoExportOptions,
  path: string,
): {
  sourceName?: string;
  endpoint?: Endpoint;
  pathValues: Array<{ name: string; value: string }>;
  query: string;
  diagnostics: Diagnostic[];
} {
  if (step.useTest.kind !== 'inline') {
    return {
      pathValues: [],
      query: '',
      diagnostics: [
        diagnostic(
          'ARAZZO_TEST_VERSION_EXPORT_NOT_SUPPORTED',
          'Arazzo export requires frozen inline request semantics.',
          `${path}.useTest`,
        ),
      ],
    };
  }
  const inline = step.useTest;
  const matches = Object.entries(options.openApiSources).flatMap(([sourceName, model]) =>
    model.endpoints.flatMap((endpoint) => {
      if (endpoint.method !== inline.method || !endpoint.operationId) return [];
      const urlMatch = matchEndpointUrl(inline.url, endpoint, model);
      return urlMatch ? [{ sourceName, endpoint, ...urlMatch }] : [];
    }),
  );
  if (matches.length !== 1) {
    return {
      pathValues: [],
      query: '',
      diagnostics: [
        diagnostic(
          matches.length === 0
            ? 'ARAZZO_EXPORT_OPERATION_NOT_FOUND'
            : 'ARAZZO_EXPORT_OPERATION_AMBIGUOUS',
          `Inline step "${step.id}" must match exactly one supplied canonical OpenAPI operation.`,
          path,
        ),
      ],
    };
  }
  const match = matches[0];
  return {
    sourceName: match?.sourceName,
    endpoint: match?.endpoint,
    pathValues: match?.pathValues ?? [],
    query: match?.query ?? '',
    diagnostics: [],
  };
}

function extractionToRuntimeExpression(extraction: WorkflowExtraction): string | null {
  if (extraction.source === 'header') return `$response.header.${extraction.expression}`;
  if (extraction.source === 'status') return '$statusCode';
  if (extraction.source !== 'body' || !extraction.expression.startsWith('$.')) return null;
  const pointer = extraction.expression
    .slice(2)
    .split('.')
    .map((segment) => segment.replace(/~/g, '~0').replace(/\//g, '~1'))
    .join('/');
  return `$response.body#/${pointer}`;
}

export function exportArazzoText(
  workflows: readonly WorkflowDefinition[],
  options: ArazzoExportOptions,
): ArazzoExportResult {
  const diagnostics: Diagnostic[] = [];
  if (workflows.length === 0) {
    return {
      success: false,
      source: null,
      diagnostics: [
        diagnostic('ARAZZO_EXPORT_EMPTY', 'At least one workflow is required.', '$.workflows'),
      ],
    };
  }

  const exportedWorkflows = workflows.map((workflow, workflowIndex) => {
    const steps = workflow.steps.map((step, stepIndex) => {
      const path = `$.workflows[${workflowIndex}].steps[${stepIndex}]`;
      const resolved = resolveWorkflowStepForExport(step, options, path);
      diagnostics.push(...resolved.diagnostics);
      const inline = step.useTest.kind === 'inline' ? step.useTest : undefined;
      const parameters: Array<{ name: string; in: string; value: unknown }> =
        resolved.pathValues.map(({ name, value }) => ({
          name,
          in: 'path',
          value: reverseRuntimeValue(value),
        }));
      for (const entry of resolved.query.split('&').filter(Boolean)) {
        const separator = entry.indexOf('=');
        const name = decodeURIComponent(separator >= 0 ? entry.slice(0, separator) : entry);
        const value = separator >= 0 ? entry.slice(separator + 1) : '';
        parameters.push({ name, in: 'query', value: reverseRuntimeValue(value) });
      }
      for (const [name, value] of Object.entries(inline?.headers ?? {})) {
        if (name.toLowerCase() === 'content-type') continue;
        if (name.toLowerCase() === 'cookie') {
          for (const cookie of value.split(';')) {
            const [cookieName, ...cookieValue] = cookie.trim().split('=');
            if (cookieName) {
              parameters.push({
                name: cookieName,
                in: 'cookie',
                value: reverseRuntimeValue(cookieValue.join('=')),
              });
            }
          }
        } else {
          parameters.push({ name, in: 'header', value: reverseRuntimeValue(value) });
        }
      }

      const successCriteria: Array<{ condition: string }> = [];
      for (const assertion of step.assertions ?? []) {
        if (
          assertion.target === 'status' &&
          assertion.operator === 'equals' &&
          typeof assertion.expected === 'number'
        ) {
          successCriteria.push({ condition: `$statusCode == ${assertion.expected}` });
        } else {
          diagnostics.push(
            diagnostic(
              'ARAZZO_ASSERTION_EXPORT_NOT_SUPPORTED',
              `Assertion on step "${step.id}" is outside the simple status subset.`,
              `${path}.assertions`,
            ),
          );
        }
      }

      const outputs: Record<string, string> = {};
      for (const extraction of step.extract ?? []) {
        const expression = extractionToRuntimeExpression(extraction);
        if (expression) outputs[extraction.name] = expression;
        else {
          diagnostics.push(
            diagnostic(
              'ARAZZO_EXTRACTION_EXPORT_NOT_SUPPORTED',
              `Extraction "${extraction.name}" is outside the supported subset.`,
              `${path}.extract`,
            ),
          );
        }
      }

      const contentType = Object.entries(inline?.headers ?? {}).find(
        ([name]) => name.toLowerCase() === 'content-type',
      )?.[1];
      return {
        stepId: step.id,
        ...(step.description ? { description: step.description } : {}),
        operationId:
          resolved.sourceName && resolved.endpoint?.operationId
            ? `$sourceDescriptions.${resolved.sourceName}.${resolved.endpoint.operationId}`
            : '',
        ...(parameters.length > 0 ? { parameters } : {}),
        ...(inline?.body !== undefined
          ? {
              requestBody: {
                ...(contentType ? { contentType } : {}),
                payload: reverseRuntimeValue(inline.body),
              },
            }
          : {}),
        ...(successCriteria.length > 0 ? { successCriteria } : {}),
        ...(step.retry && step.retry.maxRetries > 0
          ? {
              onFailure: [
                {
                  name: `retry-${step.id}`,
                  type: 'retry',
                  retryAfter: step.retry.baseDelayMs / 1000,
                  retryLimit: step.retry.maxRetries,
                },
              ],
            }
          : {}),
        ...(Object.keys(outputs).length > 0 ? { outputs } : {}),
        ...(step.timeoutMs ? { timeout: step.timeoutMs } : {}),
      };
    });
    return {
      workflowId: workflow.id,
      summary: workflow.name,
      ...(workflow.description ? { description: workflow.description } : {}),
      steps,
    };
  });

  if (diagnostics.some((entry) => entry.severity === 'error')) {
    return { success: false, source: null, diagnostics };
  }
  return {
    success: true,
    source: stringify({
      arazzo: '1.1.0',
      info: options.info,
      sourceDescriptions: options.sourceDescriptions.map((sourceDescription) => ({
        ...sourceDescription,
        type: sourceDescription.type ?? 'openapi',
      })),
      workflows: exportedWorkflows,
    }),
    diagnostics,
  };
}
