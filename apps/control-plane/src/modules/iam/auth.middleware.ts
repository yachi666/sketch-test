/**
 * Auth Middleware — JWT-based authentication.
 *
 * Uses HMAC-SHA256 signed JWTs from ../shared/jwt.ts.
 * Tokens are stateless (no server-side session storage), enabling:
 * - Server restart without logging out users
 * - Multiple CP instances sharing the same JWT_SECRET
 *
 * User-facing routes accept signed JWTs exclusively. Runner and service
 * account credentials use their own explicit channels and must never be
 * treated as browser sessions.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../../shared/errors.js';
import { type JwtPayload, verifyJwt } from '../../shared/jwt.js';
import type { User } from './iam.service.js';

// ── Session types ──────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: User['role'];
  workspaceId: string;
}

// ── Token lookup ───────────────────────────────────────────────────

/** Authenticate a user-facing bearer JWT. */
export function authenticateBearer(header: string): AuthUser | null {
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') return null;

  const token = parts[1];
  if (!token) return null;

  if (token.split('.').length !== 3) return null;
  const payload: JwtPayload | null = verifyJwt(token);
  if (!payload) return null;
  return {
    id: payload.sub,
    email: payload.email,
    displayName: payload.displayName,
    role: payload.role as User['role'],
    workspaceId: payload.workspaceId,
  };
}

/** Return the user attached by the global authorization hook. */
export function authenticatedUser(request: FastifyRequest): AuthUser {
  if (!request.user) {
    throw new Error('Authorization invariant violated: authenticated user is missing');
  }
  return request.user;
}

// ── Fastify preHandler hook ────────────────────────────────────────

/**
 * Fastify preHandler hook factory. Validates a bearer JWT, attaches
 * `request.user`, and optionally checks roles.
 */
export function requireAuth(options?: { roles?: User['role'][] }) {
  return async function preHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header) {
      sendError(reply, 401, 'UNAUTHORIZED', 'Missing Authorization header');
      return;
    }

    const user = authenticateBearer(header);
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
