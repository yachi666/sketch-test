/**
 * @sketch-test/adapter-postman — Response mapping
 *
 * Converts Postman stored response examples into canonical Response objects.
 *
 * Postman responses are user-saved examples that serve as documentation
 * and expected contract definitions. Each response carries:
 * - HTTP status code and status text
 * - Response headers
 * - Response body (raw text)
 *
 * Invariants:
 * - Status code is always present (Postman requires it for stored responses)
 * - Content type is inferred from response headers (defaults to application/json)
 * - Synthetic schema refs are created for response bodies
 * - Empty responses array returned when no stored responses exist
 */

import type { Response } from '@sketch-test/canonical-api-model';
import type { EntityId, HttpStatusCode } from '@sketch-test/contracts-common';
import type { PostmanResponse } from '../types.js';
import type { SourceContext } from './shared.js';

/**
 * Map Postman stored response examples to canonical Response[].
 *
 * Each stored response becomes one Response entry. Returns an empty array
 * when no responses are present.
 */
export function mapResponses(
  responses: PostmanResponse[] | undefined,
  ctx: SourceContext,
  endpointId: string,
): Response[] {
  if (!responses || responses.length === 0) return [];

  return responses.map((resp, index) => {
    const statusCode = resp.code as HttpStatusCode;
    const respId = `${endpointId}-resp-${statusCode}` as EntityId;

    // Build content map if body is present
    const content: Record<
      string,
      { schema: { ref: string; displayName?: string }; example?: unknown }
    > = {};

    if (resp.body) {
      const ctHeader = resp.header?.find(
        (h) => !h.disabled && h.key.toLowerCase() === 'content-type',
      );
      const mediaType = ctHeader?.value || 'application/json';

      content[mediaType] = {
        schema: {
          ref: `/_postman/${endpointId}/responses/${statusCode}`,
          displayName: `${statusCode} response body`,
        },
        example: resp.body,
      };
    }

    // Build headers map if present
    const headers: Record<string, { schema: { ref: string }; description?: string }> = {};
    if (resp.header) {
      for (const h of resp.header) {
        if (!h.disabled) {
          headers[h.key] = {
            schema: {
              ref: `/_postman/${endpointId}/responses/${statusCode}/header/${h.key}`,
            },
            description: h.description,
          };
        }
      }
    }

    const mapped: Response = {
      id: respId,
      statusCode,
      description: resp.name || resp.status || `${statusCode}`,
      content: Object.keys(content).length > 0 ? content : undefined,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      sourceLocation: {
        sourceId: ctx.sourceId,
        sourceLabel: ctx.sourceLabel,
        sourceVersion: ctx.sourceVersion,
        sourceHash: ctx.sourceHash,
        location: `response[${index}]`,
        ingestedAt: ctx.ingestedAt,
      },
    };

    return mapped;
  });
}
