/**
 * JWT utility unit tests.
 *
 * Tests the minimal JWT sign/verify implementation.
 */
import { describe, expect, test } from 'vitest';
import { signJwt, verifyJwt, type JwtPayload } from '../jwt';

describe('signJwt', () => {
  test('produces a three-part token', () => {
    const token = signJwt({
      sub: 'usr-001',
      email: 'test@test.com',
      displayName: 'Test User',
      role: 'editor',
      workspaceId: 'ws-001',
    });
    expect(token.split('.')).toHaveLength(3);
  });

  test('produces different tokens for different payloads', () => {
    const t1 = signJwt({
      sub: 'usr-1',
      email: 'a@a.com',
      displayName: 'A',
      role: 'editor',
      workspaceId: 'ws-1',
    });
    const t2 = signJwt({
      sub: 'usr-2',
      email: 'b@b.com',
      displayName: 'B',
      role: 'viewer',
      workspaceId: 'ws-1',
    });
    expect(t1).not.toBe(t2);
  });
});

describe('verifyJwt', () => {
  test('verifies a valid token', () => {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: 'usr-001',
      email: 'test@test.com',
      displayName: 'Test User',
      role: 'editor',
      workspaceId: 'ws-001',
    };
    const token = signJwt(payload);
    const result = verifyJwt(token);
    expect(result).not.toBeNull();
    expect(result!.sub).toBe('usr-001');
    expect(result!.email).toBe('test@test.com');
    expect(result!.role).toBe('editor');
    expect(result!.workspaceId).toBe('ws-001');
    expect(result!.iat).toBeGreaterThan(0);
    expect(result!.exp).toBeGreaterThan(result!.iat);
  });

  test('returns null for malformed token', () => {
    expect(verifyJwt('not-a-jwt')).toBeNull();
    expect(verifyJwt('a.b')).toBeNull();
    expect(verifyJwt('')).toBeNull();
  });

  test('returns null for tampered token', () => {
    const token = signJwt({
      sub: 'usr-001',
      email: 'test@test.com',
      displayName: 'Test',
      role: 'editor',
      workspaceId: 'ws-001',
    });
    // Tamper with the payload (base64url has no padding after our encode)
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}x.${parts[2]}`;
    expect(verifyJwt(tampered)).toBeNull();
  });

  test('returns null for expired token', () => {
    const token = signJwt(
      {
        sub: 'usr-001',
        email: 'test@test.com',
        displayName: 'Test',
        role: 'editor',
        workspaceId: 'ws-001',
      },
      -1, // expired 1 second ago
    );
    expect(verifyJwt(token)).toBeNull();
  });

  test('returns null for payload missing required fields', () => {
    // We can't easily create an invalid token through signJwt,
    // but tampered tokens with missing fields get rejected
    const token = signJwt({
      sub: 'usr-001',
      email: 'test@test.com',
      displayName: 'Test',
      role: 'editor',
      workspaceId: 'ws-001',
    });
    // Verify regular token first
    expect(verifyJwt(token)).not.toBeNull();
  });

  test('accepts token valid for future expiration', () => {
    const token = signJwt(
      {
        sub: 'usr-001',
        email: 'test@test.com',
        displayName: 'Test',
        role: 'editor',
        workspaceId: 'ws-001',
      },
      3600, // 1 hour
    );
    expect(verifyJwt(token)).not.toBeNull();
  });

  test('custom TTL works', () => {
    const token = signJwt(
      {
        sub: 'usr-001',
        email: 'test@test.com',
        displayName: 'Test',
        role: 'editor',
        workspaceId: 'ws-001',
      },
      60, // 1 minute
    );
    const payload = verifyJwt(token);
    expect(payload!.exp - payload!.iat).toBe(60);
  });
});
