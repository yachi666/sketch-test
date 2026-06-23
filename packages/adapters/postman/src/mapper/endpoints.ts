/**
 * @sketch-test/adapter-postman — Endpoint mapping
 *
 * Core mapping layer that converts Postman Collection items into
 * canonical Endpoint objects.
 *
 * Responsibilities:
 * - Flatten nested Postman folder hierarchies into flat item lists
 * - Build endpoint paths from PostmanUrl (path[] array, fallback to URL parsing)
 * - Map query params, path variables, headers, body, and responses
 * - Generate stable endpoint IDs: {METHOD}-{normalizedPath}
 * - Produce diagnostics for unsupported constructs
 *
 * Invariants:
 * - Each flat request maps to exactly one Endpoint
 * - Endpoint IDs are deterministic and stable
 * - Folders without request children are skipped (tag accumulation only)
 * - All endpoints carry at least one source location
 */

import type { Endpoint, Parameter } from '@sketch-test/canonical-api-model';
import type {
  Diagnostic,
  EntityId,
  HttpMethod,
  SourceLocation,
} from '@sketch-test/contracts-common';
import type { PostmanItem, PostmanUrl } from '../types.js';
import { mapHeaders, mapQueryParams, mapUrlParams } from './parameters.js';
import { mapRequestBody } from './request-bodies.js';
import { mapResponses } from './responses.js';
import type { SourceContext } from './shared.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface FlatItem {
  item: PostmanItem;
  tags: string[];
  folderPath: string;
}

// ─── Flattening ──────────────────────────────────────────────────────

/**
 * Recursively flatten nested Postman folder items into a flat list.
 *
 * Folder names are accumulated as tags onto their descendants.
 * Items that are both a folder AND a request are treated as requests
 * (the folder's children still get the name as a tag).
 */
export function flattenItems(items: PostmanItem[], parentTags: string[] = []): FlatItem[] {
  const result: FlatItem[] = [];
  for (const item of items) {
    // Check if this is a folder: has `.item` children, no `.request`
    if (item.item && Array.isArray(item.item) && !item.request) {
      const folderTags = [...parentTags, item.name];
      result.push(...flattenItems(item.item, folderTags));
    } else if (item.request) {
      // This is a request item (leaf)
      result.push({
        item,
        tags: parentTags,
        folderPath: parentTags.join(' / '),
      });
    }
  }
  return result;
}

// ─── Path Building ───────────────────────────────────────────────────

/**
 * Build an endpoint path string from a Postman URL.
 *
 * Priority order:
 * 1. Use path[] array if present (joins segments with /)
 * 2. Fallback to parsing the raw URL and extracting pathname
 * 3. Fallback to '/' if parsing fails
 */
export function buildPath(url: PostmanUrl | string): string {
  const u = typeof url === 'string' ? { raw: url, path: [] } : url;
  if (Array.isArray(u.path) && u.path.length > 0) {
    return `/${u.path.join('/')}`;
  }
  // Fallback: parse from raw URL
  try {
    const parsed = new URL(u.raw);
    return parsed.pathname;
  } catch {
    return '/';
  }
}

/** Ensure the path starts with a leading slash. */
function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

/** Build a stable endpoint id: {METHOD}-{normalizedPath}. */
function buildEndpointId(method: string, path: string): string {
  return `${method}-${path}`;
}

// ─── Endpoint Mapping ────────────────────────────────────────────────

/**
 * Map a single flattened Postman item into a canonical Endpoint.
 *
 * Produces diagnostics for:
 * - Unsupported request body modes (file, graphql)
 * - Non-standard HTTP methods (still mapped with warning)
 */
export function mapToEndpoint(
  flat: FlatItem,
  ctx: SourceContext,
): { endpoint: Endpoint; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const { item, tags } = flat;
  const request = item.request;
  if (!request) {
    diagnostics.push({
      severity: 'error',
      code: 'MISSING_REQUEST',
      message: `Item "${item.name}" has no request object`,
    });
    return {
      endpoint: {
        id: '' as EntityId,
        method: 'GET' as HttpMethod,
        path: '/',
        deprecated: false,
        parameters: [],
        requestBodies: [],
        responses: [],
        sourceLocations: [],
      },
      diagnostics,
    };
  }

  // Validate HTTP method
  const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const method = request.method.toUpperCase();

  if (!validMethods.includes(method)) {
    diagnostics.push({
      severity: 'warning',
      code: 'UNSUPPORTED_HTTP_METHOD',
      message: `Unsupported HTTP method "${method}" at "${item.name}"`,
    });
  }

  // Build normalized path
  const rawPath = buildPath(request.url);
  const normalizedPath = normalizePath(rawPath);
  const id = buildEndpointId(method, normalizedPath);

  // Parse URL object for structured parameter extraction
  const url = typeof request.url === 'string' ? undefined : request.url;

  // Map parameters
  const parameters: Parameter[] = [];

  if (url?.query) {
    parameters.push(...mapQueryParams(url, ctx, id));
  }
  if (url?.variable) {
    parameters.push(...mapUrlParams(url, ctx, id));
  }
  if (request.header) {
    parameters.push(...mapHeaders(request.header, ctx, id));
  }

  // Map request body
  const bodyResult = mapRequestBody(request.body, request.header, ctx, id);
  diagnostics.push(...bodyResult.diagnostics);

  // Map responses
  const responses = mapResponses(item.response, ctx, id);

  // Build source location
  const sourceLocation: SourceLocation = {
    sourceId: ctx.sourceId,
    sourceLabel: ctx.sourceLabel,
    sourceVersion: ctx.sourceVersion,
    sourceHash: ctx.sourceHash,
    location: item.name || id,
    ingestedAt: ctx.ingestedAt,
  };

  const endpoint: Endpoint = {
    id: id as EntityId,
    method: method as HttpMethod,
    path: normalizedPath,
    summary: item.name,
    description: item.description,
    deprecated: false,
    tags: tags.length > 0 ? tags : undefined,
    parameters,
    requestBodies: bodyResult.body ? [bodyResult.body] : [],
    responses,
    sourceLocations: [sourceLocation],
  };

  return { endpoint, diagnostics };
}
