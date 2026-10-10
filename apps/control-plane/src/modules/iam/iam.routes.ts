/**
 * IAM Routes — Fastify route definitions for workspaces, users, auth, and service accounts.
 *
 * All request bodies are validated with Zod. Errors use the shared sendError helper.
 * User-facing endpoints are protected by the Control Plane's global
 * authorization boundary.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { sendError } from '../../shared/errors.js';
import { signJwt } from '../../shared/jwt.js';
import { authenticatedUser } from './auth.middleware.js';
import {
  createServiceAccount,
  createUser,
  createWorkspace,
  getUser,
  getUserByEmail,
  getWorkspace,
  listServiceAccounts,
  listUsers,
  revokeServiceAccount,
  updateUserRole,
  upgradePasswordHash,
  verifyPassword,
} from './iam.service.js';

// ── Zod schemas ────────────────────────────────────────────────────────────────

const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  ownerEmail: z.string().email().max(255),
  ownerPassword: z.string().min(12).max(255),
  ownerDisplayName: z.string().min(1).max(255).optional(),
});

const CreateUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(6).max(255),
  displayName: z.string().max(255).optional(),
  role: z.enum(['owner', 'maintainer', 'editor', 'viewer']).optional(),
});

const LoginSchema = z.object({
  workspaceId: z.string().min(1).max(256),
  email: z.string().email(),
  password: z.string().min(1),
});

const CreateServiceAccountSchema = z.object({
  workspaceId: z.string(),
  name: z.string().min(1).max(255),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.string().optional(), // ISO 8601
});

// ── Routes ─────────────────────────────────────────────────────────────────────

export async function iamRoutes(app: FastifyInstance): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════════════
  // Workspaces
  // ═══════════════════════════════════════════════════════════════════════════

  /** POST /api/workspaces — Create a workspace and its explicitly provisioned owner. */
  app.post('/api/workspaces', async (request, reply) => {
    const parsed = CreateWorkspaceSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid workspace data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const result = await createWorkspace(
        parsed.data.name,
        parsed.data.ownerEmail,
        parsed.data.ownerPassword,
        parsed.data.description,
        parsed.data.ownerDisplayName,
        !request.user,
      );
      reply.status(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      // Postgres unique violation
      if (
        message.includes('duplicate key') ||
        message.includes('UNIQUE') ||
        message.includes('bootstrap already completed')
      ) {
        return sendError(reply, 409, 'CONFLICT', `Workspace "${parsed.data.name}" already exists`);
      }
      request.log.error({ err }, 'Failed to create workspace');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to create workspace');
    }
  });

  /** GET /api/workspaces — Return the caller's workspace. */
  app.get('/api/workspaces', async (request, reply) => {
    try {
      const workspace = await getWorkspace(authenticatedUser(request).workspaceId);
      reply.send({ workspaces: workspace ? [workspace] : [] });
    } catch (err) {
      request.log.error({ err }, 'Failed to get caller workspace');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get workspace');
    }
  });

  /** GET /api/workspaces/:id — Get a workspace by ID. */
  app.get('/api/workspaces/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const workspace = await getWorkspace(id);
      if (!workspace) {
        return sendError(reply, 404, 'NOT_FOUND', `Workspace ${id} not found`);
      }
      reply.send({ workspace });
    } catch (err) {
      request.log.error({ err }, 'Failed to get workspace');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get workspace');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Users (scoped to a workspace)
  // ═══════════════════════════════════════════════════════════════════════════

  /** GET /api/workspaces/:id/users — List users in a workspace. */
  app.get('/api/workspaces/:id/users', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const users = await listUsers(id);
      reply.send({ users });
    } catch (err) {
      request.log.error({ err }, 'Failed to list users');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list users');
    }
  });

  /** POST /api/workspaces/:id/users — Create a user in a workspace. */
  app.post('/api/workspaces/:id/users', async (request, reply) => {
    const { id: workspaceId } = request.params as { id: string };
    const parsed = CreateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid user data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const user = await createUser(
        workspaceId,
        parsed.data.email,
        parsed.data.password,
        parsed.data.displayName,
        parsed.data.role,
      );
      reply.status(201).send({ user });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('duplicate key') || message.includes('UNIQUE')) {
        return sendError(
          reply,
          409,
          'CONFLICT',
          `User "${parsed.data.email}" already exists in this workspace`,
        );
      }
      if (message.includes('violates foreign key')) {
        return sendError(reply, 404, 'NOT_FOUND', `Workspace ${workspaceId} not found`);
      }
      request.log.error({ err }, 'Failed to create user');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to create user');
    }
  });

  /** PATCH /api/users/:id/role — Update a user's role. */
  app.patch('/api/users/:id/role', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ role: z.enum(['owner', 'maintainer', 'editor', 'viewer']) })
      .safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid role data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const user = await updateUserRole(id, parsed.data.role);
      if (!user) {
        return sendError(reply, 404, 'NOT_FOUND', `User ${id} not found`);
      }
      reply.send({ user });
    } catch (err) {
      request.log.error({ err }, 'Failed to update user role');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to update user role');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Auth
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/auth/guest — Provision the explicitly configured guest identity.
   *
   * This endpoint is disabled by default and intended for login-free demo/QA
   * deployments. It still issues a signed, workspace-bound JWT so every
   * downstream authorization and ownership check remains active.
   */
  app.post('/api/auth/guest', async (request, reply) => {
    if (process.env['GUEST_ACCESS_ENABLED'] !== 'true') {
      return reply.header('cache-control', 'no-store').send({ enabled: false });
    }

    const userId = process.env['GUEST_USER_ID'];
    const workspaceId = process.env['GUEST_WORKSPACE_ID'];
    if (!userId || !workspaceId) {
      return sendError(reply, 503, 'NOT_CONFIGURED', 'Guest access is not configured');
    }

    try {
      const user = await getUser(userId);
      if (!user || user.workspaceId !== workspaceId) {
        return sendError(reply, 503, 'NOT_CONFIGURED', 'Guest identity is not available');
      }

      const token = signJwt({
        sub: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        workspaceId: user.workspaceId,
      });

      reply.header('cache-control', 'no-store').send({
        enabled: true,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          workspaceId: user.workspaceId,
        },
        token,
      });
    } catch (err) {
      request.log.error({ err }, 'Failed to provision guest session');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Guest session provisioning failed');
    }
  });

  /**
   * POST /api/auth/login — Authenticate with email and password.
   *
   * workspaceId is mandatory so duplicate email addresses in separate tenants
   * can never authenticate ambiguously. Returns the user profile and a JWT.
   */
  app.post('/api/auth/login', async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid login data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    const { workspaceId, email, password } = parsed.data;

    try {
      const userWithHash = await getUserByEmail(workspaceId, email);

      if (!userWithHash) {
        return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }

      if (!(await verifyPassword(userWithHash, password))) {
        return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }
      await upgradePasswordHash(userWithHash, password);

      const authUser = {
        id: userWithHash.id,
        email: userWithHash.email,
        displayName: userWithHash.displayName,
        role: userWithHash.role,
        workspaceId: userWithHash.workspaceId,
      };

      const token = signJwt({
        sub: authUser.id,
        email: authUser.email,
        displayName: authUser.displayName,
        role: authUser.role,
        workspaceId: authUser.workspaceId,
      });

      reply.send({
        user: {
          id: authUser.id,
          email: authUser.email,
          displayName: authUser.displayName,
          role: authUser.role,
          workspaceId: authUser.workspaceId,
        },
        token,
      });
    } catch (err) {
      request.log.error({ err }, 'Failed to authenticate');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Authentication failed');
    }
  });

  /**
   * GET /api/auth/me — Return the current authenticated user.
   * Requires a valid Bearer token in the Authorization header.
   */
  app.get('/api/auth/me', async (request, reply) => {
    reply.send({ user: authenticatedUser(request) });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Service Accounts
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/service-accounts — Create a service account.
   * Returns the generated token — this is the only time the token is shown.
   */
  app.post('/api/service-accounts', async (request, reply) => {
    const parsed = CreateServiceAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid service account data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const result = await createServiceAccount(
        parsed.data.workspaceId,
        parsed.data.name,
        parsed.data.scopes,
        parsed.data.expiresAt,
      );
      reply.status(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('violates foreign key')) {
        return sendError(reply, 404, 'NOT_FOUND', `Workspace ${parsed.data.workspaceId} not found`);
      }
      request.log.error({ err }, 'Failed to create service account');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to create service account');
    }
  });

  /** GET /api/workspaces/:id/service-accounts — List service accounts in a workspace. */
  app.get('/api/workspaces/:id/service-accounts', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const accounts = await listServiceAccounts(id);
      reply.send({ serviceAccounts: accounts });
    } catch (err) {
      request.log.error({ err }, 'Failed to list service accounts');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list service accounts');
    }
  });

  /**
   * POST /api/service-accounts/:id/revoke — Revoke a service account.
   * After revocation, the token can no longer be used.
   */
  app.post('/api/service-accounts/:id/revoke', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await revokeServiceAccount(id);
      reply.send({ revoked: true, id });
    } catch (err) {
      request.log.error({ err }, 'Failed to revoke service account');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to revoke service account');
    }
  });
}
