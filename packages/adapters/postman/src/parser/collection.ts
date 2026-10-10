import type { Diagnostic } from '@sketch-test/contracts-common';
import { parse as parseJson } from 'jsonc-parser';
import type { PostmanCollection } from '../types.js';

/**
 * Parse a Postman Collection v2.1 document, or the v2-shaped projection of a
 * Postman v3 directory bundle, from raw input.
 *
 * Accepts either a pre-parsed object or raw JSON string (which will be
 * parsed with jsonc-parser for tolerance of BOM, comments, and trailing
 * commas).
 *
 * Returns the parsed collection (if valid) along with any diagnostics.
 */
export function parseCollection(raw: unknown): {
  collection: PostmanCollection | null;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];

  // Handle JSON string input (with jsonc-parser for tolerance)
  if (typeof raw === 'string') {
    try {
      const parsed = parseJson(raw);
      if (parsed === undefined) {
        return {
          collection: null,
          diagnostics: [
            {
              severity: 'error',
              code: 'PARSE_ERROR',
              message: 'Failed to parse input as JSON',
            },
          ],
        };
      }
      return parseCollection(parsed);
    } catch {
      return {
        collection: null,
        diagnostics: [
          {
            severity: 'error',
            code: 'PARSE_ERROR',
            message: 'Input is not valid JSON',
          },
        ],
      };
    }
  }

  if (typeof raw !== 'object' || raw === null) {
    return {
      collection: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'PARSE_ERROR',
          message: 'Input is not a valid JSON object',
        },
      ],
    };
  }

  const c = raw as Record<string, unknown>;

  // Check for Postman Collection v1 before validating v2.1 structure
  // v1 collections have `requests` and `folders` top-level fields instead of `item`
  if ('requests' in c && 'folders' in c) {
    return {
      collection: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'UNSUPPORTED_VERSION',
          message:
            'Postman Collection v1 is not supported. Please upgrade to v2 in Postman (File → Export).',
        },
      ],
    };
  }

  // Validate info.schema
  if (!c['info'] || typeof c['info'] !== 'object') {
    return {
      collection: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'INVALID_COLLECTION',
          message: 'Missing info object',
        },
      ],
    };
  }

  const info = c['info'] as Record<string, unknown>;

  const schema = info['schema'];
  const supportedSchema =
    typeof schema === 'string' &&
    (schema.includes('getpostman.com') ||
      schema.includes('schema.postman.com/collection/yaml/v3.0.0'));
  if (!supportedSchema) {
    return {
      collection: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'INVALID_COLLECTION',
          message:
            'Not a valid Postman Collection: info.schema must reference a supported Postman v2 or v3 collection schema.',
        },
      ],
    };
  }

  // Validate items
  if (!Array.isArray(c['item'])) {
    return {
      collection: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'EMPTY_COLLECTION',
          message: 'Collection has no items',
        },
      ],
    };
  }

  // Validate collection name
  if (typeof info['name'] !== 'string' || info['name'].trim().length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'MISSING_NAME',
      message: 'Collection name is missing or empty',
    });
  }

  return {
    collection: raw as PostmanCollection,
    diagnostics,
  };
}
