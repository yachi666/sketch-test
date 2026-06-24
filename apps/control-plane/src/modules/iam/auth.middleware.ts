/**
 * Auth Middleware — simplified dev authentication for M1.
 *
 * Uses an in-memory session store (Map) with random bearer tokens.
 * This is NOT production auth — it is designed for local development and
 * integration testing. In production, replace with a proper JWT/OIDC flow.
 *
 * Session tokens are generated via crypto.randomBytes and stored in memory.
 * They expire after 24 hours of inactivity.
 */

import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../../shared/errors.js';
import type { User } from './iam.service.js';

// ── Session types ──────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: User['role'];
  workspaceId: string;
}

interface SessionEntry {
  userId: string;
  user: AuthUser;
  createdAt: number;
}

// ── Session store ──────────────────────────────────────────────────────────────

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * In-memory session store: token → session entry.
 * Other modules can import this to inspect or clear sessions.
 */
export const authSessions = new Map<string, SessionEntry>();

/** Create a session for a user. Returns the bearer token. */
export function createSession(user: AuthUser): string {
  // Evict expired sessions before creating a new one
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

/** Destroy a session by token. */
export function destroySession(token: string): void {
  authSessions.delete(token);
}

/** Look up a session by token. Returns the user if valid, null otherwise. */
function lookupSession(token: string): AuthUser | null {
  const entry = authSessions.get(token);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
    authSessions.delete(token);
    return null;
  }

  return entry.user;
}

// ── Fastify preHandler hook ────────────────────────────────────────────────────

/**
 * Fastify preHandler hook factory. Validates the bearer token from the
 * Authorization header, attaches `request.user`, and optionally checks roles.
 *
 * Usage:
 *   app.get('/api/auth/me', { preHandler: requireAuth() }, handler);
 *   app.delete('/admin', { preHandler: requireAuth({ roles: ['owner'] }) }, handler);
 */
export function requireAuth(options?: { roles?: User['role'][] }) {
  return async function preHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header) {
      sendError(reply, 401, 'UNAUTHORIZED', 'Missing Authorization header');
      return;
    }

    const parts = header.split(' ');
    if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
      sendError(reply, 401, 'UNAUTHORIZED', 'Authorization header must be "Bearer <token>"');
      return;
    }

    const token = parts[1]!;
    const user = lookupSession(token);
    if (!user) {
      sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or expired token');
      return;
    }

    if (options?.roles && !options.roles.includes(user.role)) {
      sendError(reply, 403, 'FORBIDDEN', `Requires one of roles: ${options.roles.join(', ')}`);
      return;
    }

    // Attach user to request for downstream handlers
    (request as unknown as Record<string, unknown>)['user'] = user;
  };
}

// ── Fastify type augmentation ──────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}
