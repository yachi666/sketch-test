import { describe, expect, it } from 'vitest';
import { detectFormat } from '../index.js';

describe('detectFormat — HAR', () => {
  it('detects HAR format', () => {
    const input = {
      log: {
        version: '1.2',
        creator: { name: 'Browser', version: '1.0' },
        entries: [
          {
            request: { method: 'GET', url: 'https://api.example.com/users' },
            response: { status: 200, statusText: 'OK' },
          },
        ],
      },
    };

    const results = detectFormat(input);
    expect(results).toHaveLength(1);
    expect(results[0]!.format).toBe('har');
    expect(results[0]!.confidence).toBe(0.95);
    expect(results[0]!.version).toBeUndefined();
  });

  it('rejects objects that look like HAR but lack entries', () => {
    const input = { log: { version: '1.2', creator: { name: 'Test' } } };
    const results = detectFormat(input);
    expect(results[0]!.format).not.toBe('har');
  });
});
