import { pool } from '../../db/db.js';
import { auditLogId } from '../../shared/id.js';

export interface AuditEventInput {
  workspaceId?: string;
  actorType: 'user' | 'runner' | 'service' | 'system';
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: 'success' | 'denied' | 'failure';
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export async function recordAuditEvent(event: AuditEventInput): Promise<string> {
  const id = auditLogId();
  await pool.query(
    `INSERT INTO audit_logs
       (id, workspace_id, actor_type, actor_id, action, resource_type,
        resource_id, outcome, request_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      event.workspaceId ?? null,
      event.actorType,
      event.actorId,
      event.action,
      event.resourceType,
      event.resourceId,
      event.outcome,
      event.requestId ?? null,
      JSON.stringify(event.metadata ?? {}),
    ],
  );
  return id;
}

export async function listAuditEvents(
  workspaceId: string,
  options: { action?: string; resourceType?: string; limit?: number } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const values: unknown[] = [workspaceId];
  const filters = ['workspace_id = $1'];
  if (options.action) {
    values.push(options.action);
    filters.push(`action = $${values.length}`);
  }
  if (options.resourceType) {
    values.push(options.resourceType);
    filters.push(`resource_type = $${values.length}`);
  }
  values.push(limit);
  const result = await pool.query(
    `SELECT id, workspace_id, actor_type, actor_id, action, resource_type,
            resource_id, outcome, request_id, metadata, created_at
     FROM audit_logs
     WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${values.length}`,
    values,
  );
  return result.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    outcome: row.outcome,
    requestId: row.request_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  }));
}
