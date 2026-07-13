/**
 * Default-deny authorization boundary for Control Plane HTTP routes.
 *
 * Public and Runner protocol routes are deliberately enumerated. Every other
 * route requires a user JWT, a role permitted for the operation, and matching
 * explicit workspace identifiers. Resource-ID ownership is checked separately
 * so a caller cannot bypass isolation by omitting workspaceId.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '../../db/db.js';
import { sendError } from '../../shared/errors.js';
import { type AuthUser, authenticateBearer } from './auth.middleware.js';
import type { User } from './iam.service.js';

type Role = User['role'];

const ROLE_LEVEL: Record<Role, number> = {
  viewer: 0,
  editor: 1,
  maintainer: 2,
  owner: 3,
};

const PUBLIC_ROUTES = new Set([
  'GET /health/live',
  'GET /health',
  'GET /ready',
  'GET /metrics',
  'POST /api/auth/login',
]);

const RUNNER_ROUTES = new Set([
  'POST /api/runners/register',
  'POST /api/runners/:id/heartbeat',
  'GET /api/runs/next',
  'PUT /api/runs/:id/claim',
  'PATCH /api/runs/:id',
  'POST /api/runs/:id/events',
  'POST /api/runs/:id/evidence-manifest',
  'POST /api/secrets/:id/decrypt',
]);

const OWNER_MUTATIONS = [
  /^\/api\/workspaces(?:\/|$)/,
  /^\/api\/users\/[^/]+\/role$/,
  /^\/api\/service-accounts(?:\/|$)/,
];

const MAINTAINER_MUTATIONS = [
  /^\/api\/environments(?:\/|$)/,
  /^\/api\/environment-versions(?:\/|$)/,
  /^\/api\/secrets(?:\/|$)/,
  /^\/api\/policies(?:\/|$)/,
  /^\/api\/schedules(?:\/|$)/,
  /^\/api\/runners(?:\/|$)/,
];

interface OwnershipRule {
  route: RegExp;
  param: string;
  query: string;
}

const OWNERSHIP_RULES: OwnershipRule[] = [
  {
    route: /^\/api\/api-versions\/:id$/,
    param: 'id',
    query: 'SELECT workspace_id FROM api_versions WHERE id = $1',
  },
  {
    route: /^\/api\/api-versions\/:targetId\/diff$/,
    param: 'targetId',
    query: 'SELECT workspace_id FROM api_versions WHERE id = $1',
  },
  {
    route: /^\/api\/runs\/:id(?:\/.*)?$/,
    param: 'id',
    query: 'SELECT workspace_id FROM runs WHERE id = $1',
  },
  {
    route: /^\/api\/users\/:id\/role$/,
    param: 'id',
    query: 'SELECT workspace_id FROM users WHERE id = $1',
  },
  {
    route: /^\/api\/service-accounts\/:id(?:\/.*)?$/,
    param: 'id',
    query: 'SELECT workspace_id FROM service_accounts WHERE id = $1',
  },
  {
    route: /^\/api\/environments\/:id(?:\/.*)?$/,
    param: 'id',
    query: 'SELECT workspace_id FROM environments WHERE id = $1',
  },
  {
    route: /^\/api\/environment-versions\/:id$/,
    param: 'id',
    query:
      'SELECT e.workspace_id FROM environment_versions v JOIN environments e ON e.id = v.environment_id WHERE v.id = $1',
  },
  {
    route: /^\/api\/secrets\/:id(?:\/.*)?$/,
    param: 'id',
    query: 'SELECT workspace_id FROM secrets WHERE id = $1',
  },
  {
    route: /^\/api\/workflows\/:id(?:\/.*)?$/,
    param: 'id',
    query: 'SELECT workspace_id FROM workflows WHERE id = $1',
  },
  {
    route: /^\/api\/workflow-versions\/:id(?:\/.*)?$/,
    param: 'id',
    query:
      'SELECT w.workspace_id FROM workflow_versions v JOIN workflows w ON w.id = v.workflow_id WHERE v.id = $1',
  },
  {
    route: /^\/api\/test-cases\/:id(?:\/.*)?$/,
    param: 'id',
    query: 'SELECT workspace_id FROM test_cases WHERE id = $1',
  },
  {
    route: /^\/api\/test-case-versions\/:id(?:\/.*)?$/,
    param: 'id',
    query:
      'SELECT t.workspace_id FROM test_case_versions v JOIN test_cases t ON t.id = v.test_case_id WHERE v.id = $1',
  },
  {
    route: /^\/api\/generation-jobs\/:id(?:\/.*)?$/,
    param: 'id',
    query: 'SELECT workspace_id FROM generation_jobs WHERE id = $1',
  },
  {
    route: /^\/api\/drafts\/:id(?:\/.*)?$/,
    param: 'id',
    query:
      'SELECT j.workspace_id FROM generated_drafts d JOIN generation_jobs j ON j.id = d.job_id WHERE d.id = $1',
  },
  {
    route: /^\/api\/datasets\/:id(?:\/.*)?$/,
    param: 'id',
    query: 'SELECT workspace_id FROM datasets WHERE id = $1',
  },
  {
    route: /^\/api\/dataset-versions\/:id$/,
    param: 'id',
    query:
      'SELECT d.workspace_id FROM dataset_versions v JOIN datasets d ON d.id = v.dataset_id WHERE v.id = $1',
  },
  {
    route: /^\/api\/test-suites\/:id(?:\/.*)?$/,
    param: 'id',
    query: 'SELECT workspace_id FROM test_suites WHERE id = $1',
  },
  {
    route: /^\/api\/test-suite-versions\/:id(?:\/.*)?$/,
    param: 'id',
    query:
      'SELECT s.workspace_id FROM test_suite_versions v JOIN test_suites s ON s.id = v.test_suite_id WHERE v.id = $1',
  },
  {
    route: /^\/api\/policies\/:id(?:\/.*)?$/,
    param: 'id',
    query: 'SELECT workspace_id FROM policies WHERE id = $1',
  },
  {
    route: /^\/api\/schedules\/:id(?:\/.*)?$/,
    param: 'id',
    query: 'SELECT workspace_id FROM schedule_configs WHERE id = $1',
  },
  {
    route: /^\/api\/runners\/:id(?:\/.*)?$/,
    param: 'id',
    query: 'SELECT workspace_id FROM runners WHERE id = $1',
  },
];

function routeKey(request: FastifyRequest): string {
  return `${request.method.toUpperCase()} ${request.routeOptions.url ?? request.url.split('?')[0]}`;
}

function minimumRole(request: FastifyRequest): Role {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return 'viewer';
  }
  const path = request.routeOptions.url ?? request.url.split('?')[0] ?? '';
  if (OWNER_MUTATIONS.some((pattern) => pattern.test(path))) return 'owner';
  if (MAINTAINER_MUTATIONS.some((pattern) => pattern.test(path))) return 'maintainer';
  return 'editor';
}

function collectExplicitWorkspaceIds(request: FastifyRequest): string[] {
  const ids: string[] = [];
  const route = request.routeOptions.url ?? '';
  const params = (request.params ?? {}) as Record<string, unknown>;
  const query = (request.query ?? {}) as Record<string, unknown>;
  const body = (request.body ?? {}) as Record<string, unknown>;

  if (route.startsWith('/api/workspaces/:id') && typeof params['id'] === 'string') {
    ids.push(params['id']);
  }
  for (const value of [query['workspaceId'], body['workspaceId']]) {
    if (typeof value === 'string' && value.length > 0) ids.push(value);
  }
  return ids;
}

async function resourceWorkspaceId(request: FastifyRequest): Promise<string | null | undefined> {
  const route = request.routeOptions.url ?? '';
  const rule = OWNERSHIP_RULES.find((candidate) => candidate.route.test(route));
  if (!rule) return undefined;
  const params = (request.params ?? {}) as Record<string, unknown>;
  const id = params[rule.param];
  if (typeof id !== 'string' || id.length === 0) return undefined;
  const result = await pool.query(rule.query, [id]);
  if (result.rows.length === 0) return null;
  const workspaceId = result.rows[0]?.workspace_id;
  return typeof workspaceId === 'string' ? workspaceId : null;
}

async function authenticateUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthUser | null> {
  const header = request.headers.authorization;
  if (!header) {
    sendError(reply, 401, 'UNAUTHORIZED', 'Missing Authorization header');
    return null;
  }
  const user = authenticateBearer(header);
  if (!user) {
    sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or expired token');
    return null;
  }
  const identity = await pool.query(
    `SELECT email, display_name, role
     FROM users WHERE id = $1 AND workspace_id = $2`,
    [user.id, user.workspaceId],
  );
  const row = identity.rows[0];
  if (!row) {
    sendError(reply, 401, 'UNAUTHORIZED', 'User is no longer active');
    return null;
  }
  const currentUser: AuthUser = {
    ...user,
    email: row.email as string,
    displayName: row.display_name as string,
    role: row.role as Role,
  };
  request.user = currentUser;
  return currentUser;
}

async function allowInitialWorkspaceBootstrap(request: FastifyRequest): Promise<boolean> {
  if (routeKey(request) !== 'POST /api/workspaces') return false;
  const result = await pool.query('SELECT EXISTS (SELECT 1 FROM workspaces) AS exists');
  return result.rows[0]?.exists !== true;
}

/** Global Fastify preHandler. Public and Runner routes remain route-authenticated. */
export async function authorizeControlPlaneRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const key = routeKey(request);
  if (PUBLIC_ROUTES.has(key) || RUNNER_ROUTES.has(key)) return;
  if (!request.headers.authorization && (await allowInitialWorkspaceBootstrap(request))) return;

  const user = await authenticateUser(request, reply);
  if (!user || reply.sent) return;

  const required = minimumRole(request);
  if (ROLE_LEVEL[user.role] < ROLE_LEVEL[required]) {
    sendError(reply, 403, 'FORBIDDEN', `Requires ${required} role or higher`);
    return;
  }

  const explicitIds = collectExplicitWorkspaceIds(request);
  if (explicitIds.some((workspaceId) => workspaceId !== user.workspaceId)) {
    sendError(reply, 403, 'FORBIDDEN', 'Cross-workspace access is not allowed');
    return;
  }

  const ownedBy = await resourceWorkspaceId(request);
  if (ownedBy === null) {
    sendError(reply, 404, 'NOT_FOUND', 'Resource not found');
    return;
  }
  if (ownedBy !== undefined && ownedBy !== user.workspaceId) {
    sendError(reply, 404, 'NOT_FOUND', 'Resource not found');
  }
}
