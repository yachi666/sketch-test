import type { DetectionResult } from '../index.js';

export function detectCurl(content: unknown): DetectionResult | null {
  if (typeof content !== 'string') return null;

  // Match strings starting with optional whitespace followed by "curl "
  if (/^\s*curl\s+/i.test(content)) {
    return {
      format: 'curl',
      confidence: 0.90,
      label: 'cURL command',
    };
  }

  return null;
}
