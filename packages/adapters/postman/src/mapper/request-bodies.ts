/**
 * @sketch-test/adapter-postman — Request body mapping
 *
 * Converts Postman request body configurations into canonical RequestBody.
 *
 * Body mode → Content-Type mapping:
 * - raw       → check headers for Content-Type, default application/json
 * - urlencoded → application/x-www-form-urlencoded
 * - formdata  → multipart/form-data
 * - file      → unsupported (produces warning diagnostic)
 * - graphql   → unsupported (produces warning diagnostic)
 * - none/undefined → skipped (returns null)
 *
 * Invariants:
 * - Only one RequestBody is produced per request (Postman has a single body)
 * - The body's raw value or structured formdata/urlencoded values become examples
 * - Synthetic schema refs are generated for traceability
 */

import type { RequestBody } from '@sketch-test/canonical-api-model';
import type { Diagnostic, EntityId } from '@sketch-test/contracts-common';
import type { PostmanBody, PostmanHeader } from '../types.js';
import { findContentType } from './parameters.js';
import type { SourceContext } from './shared.js';

/**
 * Map a Postman request body to a canonical RequestBody.
 *
 * Returns `{ body: null }` when no body is present or the mode is 'none'.
 * Unsupported modes produce a warning diagnostic.
 */
export function mapRequestBody(
  body: PostmanBody | undefined,
  headers: PostmanHeader[] | undefined,
  ctx: SourceContext,
  endpointId: string,
): { body: RequestBody | null; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];

  if (!body || body.mode === 'none') {
    return { body: null, diagnostics };
  }

  // Unsupported modes
  if (body.mode === 'file') {
    diagnostics.push({
      severity: 'warning',
      code: 'UNSUPPORTED_BODY_MODE',
      message: `File mode request bodies are not yet supported for ${endpointId}`,
    });
    return { body: null, diagnostics };
  }

  if (body.mode === 'graphql') {
    diagnostics.push({
      severity: 'warning',
      code: 'UNSUPPORTED_BODY_MODE',
      message: `GraphQL mode request bodies are not yet supported for ${endpointId}`,
    });
    return { body: null, diagnostics };
  }

  // Determine media type and example from the body mode
  let mediaType: string;
  let example: unknown;

  switch (body.mode) {
    case 'raw': {
      mediaType = findContentType(headers) || 'application/json';
      example = body.raw ?? undefined;
      break;
    }
    case 'urlencoded': {
      mediaType = 'application/x-www-form-urlencoded';
      if (body.urlencoded && body.urlencoded.length > 0) {
        example = body.urlencoded
          .filter((p) => !p.disabled)
          .reduce(
            (acc: Record<string, string>, p) => {
              acc[p.key] = p.value;
              return acc;
            },
            {} as Record<string, string>,
          );
      }
      break;
    }
    case 'formdata': {
      mediaType = 'multipart/form-data';
      if (body.formdata && body.formdata.length > 0) {
        example = body.formdata
          .filter((p) => !p.disabled)
          .reduce(
            (acc: Record<string, string>, p) => {
              acc[p.key] = p.value;
              return acc;
            },
            {} as Record<string, string>,
          );
      }
      break;
    }
    default: {
      return { body: null, diagnostics };
    }
  }

  const content: Record<
    string,
    { schema: { ref: string; displayName?: string }; example?: unknown }
  > = {
    [mediaType]: {
      schema: {
        ref: `/_postman/${endpointId}/request-body`,
        displayName: `${endpointId} request body`,
      },
      example: example ?? undefined,
    },
  };

  const mapped: RequestBody = {
    id: `${endpointId}-body` as EntityId,
    required: true,
    content,
    sourceLocation: {
      sourceId: ctx.sourceId,
      sourceLabel: ctx.sourceLabel,
      sourceVersion: ctx.sourceVersion,
      sourceHash: ctx.sourceHash,
      location: 'request.body',
      ingestedAt: ctx.ingestedAt,
    },
  };

  return { body: mapped, diagnostics };
}
