/**
 * Minimal JWT implementation using Node.js built-in crypto.
 *
 * Produces HS256-signed JWTs for session management.
 * No external dependencies — uses crypto.createHmac + base64url encoding.
 *
 * This replaces the in-memory session store with stateless, verifiable tokens
 * that survive server restarts and work across multiple CP instances.
 */

import crypto from 'node:crypto';

// ── Key management ──────────────────────────────────────────────────────

let _cachedSecret: Buffer | null = null;

function getJwtSecret(): Buffer {
  if (_cachedSecret) return _cachedSecret;

  const raw = process.env['JWT_SECRET'];
  if (!raw) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('JWT_SECRET must be set in production');
    }
    const generated = crypto.randomBytes(32).toString('hex');
    console.warn(
      '[jwt] JWT_SECRET not set — generated ephemeral key for this session. ' +
        'Set JWT_SECRET env var for persistent tokens across restarts.',
    );
    _cachedSecret = Buffer.from(generated, 'utf8');
    return _cachedSecret;
  }
  if (raw.length < 16) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('JWT_SECRET must be at least 32 characters in production');
    }
    console.warn(
      '[jwt] JWT_SECRET is shorter than 16 chars — consider using a stronger key (32+ chars).',
    );
  }
  _cachedSecret = Buffer.from(raw, 'utf8');
  return _cachedSecret;
}

// ── Base64url helpers ───────────────────────────────────────────────────

function base64urlEncode(data: string): string {
  return Buffer.from(data, 'utf8').toString('base64url').replace(/=+$/, '');
}

function base64urlDecode(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

// ── JWT Sign & Verify ───────────────────────────────────────────────────

export interface JwtPayload {
  sub: string; // subject (user ID)
  email: string;
  displayName: string;
  role: string;
  workspaceId: string;
  iat: number; // issued at (unix seconds)
  exp: number; // expiration (unix seconds)
}

const JWT_ROLES = new Set(['owner', 'maintainer', 'editor', 'viewer']);

/** Default token lifetime: 24 hours. */
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/**
 * Create a signed JWT token for the given payload.
 */
export function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const secret = getJwtSecret();
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url')
    .replace(/=+$/, '');

  return `${signingInput}.${signature}`;
}

/**
 * Verify and decode a JWT token. Returns the payload if valid, null otherwise.
 */
export function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  try {
    const header = JSON.parse(base64urlDecode(headerB64)) as Record<string, unknown>;
    if (header['alg'] !== 'HS256' || header['typ'] !== 'JWT') return null;
  } catch {
    return null;
  }

  // Verify signature
  const signingInput = `${headerB64}.${payloadB64}`;
  const secret = getJwtSecret();
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url')
    .replace(/=+$/, '');

  const suppliedSignature = Buffer.from(signatureB64);
  const expectedSignature = Buffer.from(expectedSig);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  // Decode payload
  let decoded: unknown;
  try {
    decoded = JSON.parse(base64urlDecode(payloadB64));
  } catch {
    return null;
  }

  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const payload = decoded as Record<string, unknown>;

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload['exp'] !== 'number' || !Number.isFinite(payload['exp'])) return null;
  if (typeof payload['iat'] !== 'number' || !Number.isFinite(payload['iat'])) return null;
  if (payload['exp'] <= now || payload['iat'] > now + 60) return null;

  // Validate required fields
  if (typeof payload['sub'] !== 'string' || payload['sub'].length === 0) return null;
  if (typeof payload['email'] !== 'string' || payload['email'].length === 0) return null;
  if (typeof payload['displayName'] !== 'string') return null;
  if (typeof payload['role'] !== 'string' || !JWT_ROLES.has(payload['role'])) return null;
  if (typeof payload['workspaceId'] !== 'string' || payload['workspaceId'].length === 0)
    return null;

  return payload as unknown as JwtPayload;
}
