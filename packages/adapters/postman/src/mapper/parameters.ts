/**
 * @sketch-test/adapter-postman — Parameter mapping
 *
 * Converts Postman request parameters (URL variables, query params, headers)
 * into canonical Parameter[] with stable identifiers and source locations.
 *
 * Invariants:
 * - Content-Type headers are excluded from header parameters (handled by body mapper)
 * - Disabled parameters are omitted
 * - All parameters carry source locations pointing back to their Postman origin
 */

import type { Parameter, ParameterLocation } from '@sketch-test/canonical-api-model';
import type { EntityId } from '@sketch-test/contracts-common';
import type { PostmanHeader, PostmanUrl } from '../types.js';
import type { SourceContext } from './shared.js';

/** Build a stable parameter id: {endpointId}-param-{name} */
function createParamId(endpointId: string, name: string): EntityId {
  return `${endpointId}-param-${name}` as EntityId;
}

/** Build a source location for a parameter */
function paramSourceLocation(ctx: SourceContext, location: string) {
  return {
    sourceId: ctx.sourceId,
    sourceLabel: ctx.sourceLabel,
    sourceVersion: ctx.sourceVersion,
    sourceHash: ctx.sourceHash,
    location,
    ingestedAt: ctx.ingestedAt,
  };
}

/**
 * Map Postman URL variables (path template params like :userId) to
 * canonical parameters with `in: 'path'`.
 */
export function mapUrlParams(url: PostmanUrl, ctx: SourceContext, endpointId: string): Parameter[] {
  if (!url.variable || url.variable.length === 0) return [];

  return url.variable.map((v) => ({
    id: createParamId(endpointId, v.key),
    name: v.key,
    in: 'path' as ParameterLocation,
    required: true,
    deprecated: false,
    allowEmptyValue: false,
    description: v.description,
    example: v.value || undefined,
    sourceLocation: paramSourceLocation(ctx, `url.variable.${v.key}`),
  }));
}

/**
 * Map Postman query parameters to canonical parameters with `in: 'query'`.
 */
export function mapQueryParams(
  url: PostmanUrl,
  ctx: SourceContext,
  endpointId: string,
): Parameter[] {
  if (!url.query || url.query.length === 0) return [];

  return url.query
    .filter((q) => !q.disabled)
    .map((q) => ({
      id: createParamId(endpointId, q.key),
      name: q.key,
      in: 'query' as ParameterLocation,
      required: false,
      deprecated: false,
      allowEmptyValue: false,
      description: q.description,
      example: q.value || undefined,
      sourceLocation: paramSourceLocation(ctx, `url.query.${q.key}`),
    }));
}

/**
 * Map Postman headers to canonical header parameters.
 *
 * Content-Type headers are excluded — they are handled by the body
 * mapper as the body's media type.
 */
export function mapHeaders(
  headers: PostmanHeader[],
  ctx: SourceContext,
  endpointId: string,
): Parameter[] {
  return headers
    .filter((h) => !h.disabled && h.key.toLowerCase() !== 'content-type')
    .map((h) => ({
      id: createParamId(endpointId, h.key),
      name: h.key,
      in: 'header' as ParameterLocation,
      required: false,
      deprecated: false,
      allowEmptyValue: false,
      description: h.description,
      example: h.value || undefined,
      sourceLocation: paramSourceLocation(ctx, `header.${h.key}`),
    }));
}

/**
 * Extract Content-Type value from Postman headers.
 * Returns undefined if not found or if headers are empty.
 */
export function findContentType(headers?: PostmanHeader[]): string | undefined {
  if (!headers) return undefined;
  const ct = headers.find((h) => !h.disabled && h.key.toLowerCase() === 'content-type');
  return ct?.value;
}
