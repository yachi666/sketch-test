import { describe, expect, it } from 'vitest';
import { detectFormat } from '../index.js';

describe('detectFormat — cURL', () => {
  it('detects a simple curl GET command', () => {
    const results = detectFormat('curl https://api.example.com/users');
    expect(results).toHaveLength(1);
    expect(results[0]!.format).toBe('curl');
    expect(results[0]!.confidence).toBe(0.9);
  });

  it('detects a curl POST with headers', () => {
    const results = detectFormat(
      'curl -X POST https://api.example.com/users -H "Content-Type: application/json" -d \'{"name":"John"}\'',
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.format).toBe('curl');
    expect(results[0]!.confidence).toBe(0.9);
  });

  it('rejects plain strings that are not curl', () => {
    const results = detectFormat('GET /api/users HTTP/1.1');
    expect(results).toHaveLength(1);
    expect(results[0]!.format).toBe('unknown');
  });

  it('rejects non-string input when no other detector matches', () => {
    const results = detectFormat(42);
    expect(results).toHaveLength(1);
    expect(results[0]!.format).toBe('unknown');
  });
});
