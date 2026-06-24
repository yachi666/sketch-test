/**
 * Auth Middleware — JWT-based authentication.
 *
 * Uses HMAC-SHA256 signed JWTs from ../shared/jwt.ts.
 * Tokens are stateless (no server-side session storage), enabling:
 * - Server restart without logging out users
 * - Multiple CP instances sharing the same JWT_SECRET
 *
 * The legacy in-memory session store is preserved as a fallback channel
 * (e.g., for service accounts issued via the old path), but new user
 * sessions use JWTs exclusively.
 */

import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../../shared/errors.js';
import { verifyJwt, type JwtPayload } from '../../shared/jwt.js';
import type { User } from './iam.service.js';

// ── Session types ──────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: User['role'];
  workspaceId: string;
}

// ── Legacy session store (kept for transition) ─────────────────────

interface SessionEntry {
  userId: string;
  user: AuthUser;
  createdAt: number;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export const authSessions = new Map<string, SessionEntry>();

export function createSession(user: AuthUser): string {
  const now = Date.now();
  for (const [tok, entry] of authSessions) {
    if (now - entry.createdAt > SESSION_TTL_MS) {
      authSessions.delete(tok);
    }
  }
  const token = crypto.randomBytes(32).toString('base64url');
  authSessions.set(token, { userId: user.id, user, createdAt: now });
  return token;
}

export function destroySession(token: string): void {
  authSessions.delete(token);
}

/** Look up a session by legacy token. */
function lookupSession(token: string): AuthUser | null {
  const entry = authSessions.get(token);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
    authSessions.delete(token);
    return null;
  }
  return entry.user;
}

// ── Token lookup ───────────────────────────────────────────────────

/**
 * Try to authenticate using JWT first, then fall back to legacy sessions.
 */
function authenticate(header: string): AuthUser | null {
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') return null;

  const token = parts[1]!;

  // Try JWT first (stateless, preferred)
  if (token.split('.').length === 3) {
    const payload: JwtPayload | null = verifyJwt(token);
    if (payload) {
      return {
        id: payload.sub,
        email: payload.email,
        displayName: payload.displayName,
        role: payload.role as User['role'],
        workspaceId: payload.workspaceId,
      };
    }
  }

  // Fall back to legacy session token
  return lookupSession(token);
}

// ── Fastify preHandler hook ────────────────────────────────────────

/**
 * Fastify preHandler hook factory. Validates bearer token (JWT or legacy
 * session), attaches `request.user`, and optionally checks roles.
 */
export function requireAuth(options?: { roles?: User['role'][] }) {
  return async function preHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header) {
      sendError(reply, 401, 'UNAUTHORIZED', 'Missing Authorization header');
      return;
    }

    const user = authenticate(header);
    if (!user) {
      sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or expired token');
      return;
    }

    if (options?.roles && !options.roles.includes(user.role)) {
      sendError(reply, 403, 'FORBIDDEN', `Requires one of roles: ${options.roles.join(', ')}`);
      return;
    }

    (request as unknown as Record<string, unknown>)['user'] = user;
  };
}

// ── Fastify type augmentation ──────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}
