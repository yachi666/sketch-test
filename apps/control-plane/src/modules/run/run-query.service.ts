import { z } from 'zod/v3';
import { pool } from '../../db/db.js';

export const RunQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
  status: z
    .enum([
      'all',
      'active',
      'attention',
      'pending',
      'queued',
      'claimed',
      'leased',
      'running',
      'passed',
      'failed',
      'inconclusive',
      'cancelled',
      'lost',
      'orphaned',
    ])
    .default('all'),
  days: z.coerce
    .number()
    .int()
    .refine((value) => [0, 1, 7, 30].includes(value))
    .default(0),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** One statement keeps the page and its counts on the same PostgreSQL snapshot. */
export async function queryRuns(workspaceId: string, query: z.infer<typeof RunQuerySchema>) {
  const result = await pool.query(
    `WITH scoped AS (
      SELECT r.id, r.api_version_id AS "apiVersionId", r.workflow_version_id AS "workflowVersionId",
        r.test_case_version_id AS "testCaseVersionId", r.status, r.runner_id AS "runnerId",
        r.claimed_at AS "claimedAt", r.created_at AS "createdAt", r.finished_at AS "finishedAt",
        COALESCE(wv.definition->>'name', tv.definition->>'name', av.spec_json->'metadata'->>'sourceLabel', '临时请求') AS "sourceName"
      FROM runs r
      LEFT JOIN workflow_versions wv ON wv.id = r.workflow_version_id
      LEFT JOIN test_case_versions tv ON tv.id = r.test_case_version_id
      LEFT JOIN api_versions av ON av.id = r.api_version_id AND av.workspace_id = r.workspace_id
      WHERE r.workspace_id = $1 AND ($2::int = 0 OR r.created_at >= now() - make_interval(days => $2::int))
    ), searched AS (
      SELECT * FROM scoped WHERE $3 = '' OR strpos(lower(concat_ws(' ', id, "sourceName", "apiVersionId", "workflowVersionId", "testCaseVersionId", "runnerId")), lower($3)) > 0
    ), filtered AS (
      SELECT * FROM searched WHERE $4 = 'all' OR status = $4
        OR ($4 = 'active' AND status IN ('pending','queued','claimed','leased','running'))
        OR ($4 = 'attention' AND status IN ('failed','inconclusive','lost','orphaned'))
    ), page_rows AS (
      SELECT * FROM filtered ORDER BY "createdAt" DESC, id DESC LIMIT $5 OFFSET $6
    )
    SELECT COALESCE((SELECT jsonb_agg(p ORDER BY p."createdAt" DESC, p.id DESC) FROM page_rows p), '[]'::jsonb) AS runs,
      (SELECT count(*)::int FROM filtered) AS total,
      (SELECT jsonb_build_object('total', count(*),
        'passed', count(*) FILTER (WHERE status = 'passed'),
        'failed', count(*) FILTER (WHERE status = 'failed'),
        'active', count(*) FILTER (WHERE status IN ('pending','queued','claimed','leased','running')),
        'unresolved', count(*) FILTER (WHERE status IN ('inconclusive','lost','orphaned')),
        'cancelled', count(*) FILTER (WHERE status = 'cancelled'),
        'other', count(*) FILTER (WHERE status NOT IN ('passed','failed','pending','queued','claimed','leased','running','inconclusive','lost','orphaned','cancelled'))
      ) FROM searched) AS summary`,
    [
      workspaceId,
      query.days,
      query.q,
      query.status,
      query.pageSize,
      (query.page - 1) * query.pageSize,
    ],
  );
  return { ...result.rows[0], page: query.page, pageSize: query.pageSize };
}
