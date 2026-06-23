import type { Diagnostic } from '@sketch-test/contracts-common';
import { parse as parseJson } from 'jsonc-parser';
import type { PostmanEnvironment } from '../types.js';

/**
 * Parse a Postman Environment from raw input.
 *
 * Accepts either a pre-parsed object or raw JSON string (which will be
 * parsed with jsonc-parser for tolerance of BOM, comments, and trailing
 * commas).
 *
 * Returns the parsed environment (if valid) along with any diagnostics.
 */
export function parseEnvironment(raw: unknown): {
  env: PostmanEnvironment | null;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];

  if (typeof raw === 'string') {
    try {
      const parsed = parseJson(raw);
      if (parsed === undefined) {
        return {
          env: null,
          diagnostics: [
            {
              severity: 'error',
              code: 'PARSE_ERROR',
              message: 'Failed to parse input as JSON',
            },
          ],
        };
      }
      return parseEnvironment(parsed);
    } catch {
      return {
        env: null,
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
      env: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'PARSE_ERROR',
          message: 'Input is not a valid JSON object',
        },
      ],
    };
  }

  const e = raw as Record<string, unknown>;

  // Validate name
  if (typeof e['name'] !== 'string' || e['name'].trim().length === 0) {
    return {
      env: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'INVALID_ENVIRONMENT',
          message: 'Environment must have a non-empty name',
        },
      ],
    };
  }

  // Validate values array
  if (!Array.isArray(e['values'])) {
    return {
      env: null,
      diagnostics: [
        {
          severity: 'error',
          code: 'INVALID_ENVIRONMENT',
          message: 'Environment must have a values array',
        },
      ],
    };
  }

  return { env: raw as PostmanEnvironment, diagnostics };
}
