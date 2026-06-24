/**
 * Runner Daemon — connects to Control Plane, polls for work, executes plans.
 *
 * This is the standalone Runner process. It:
 * 1. Registers with the Control Plane (or uses an existing token)
 * 2. Starts a heartbeat loop (every 15s)
 * 3. Long-polls CP for pending runs
 * 4. Executes the ExecutionPlan using executePlan()
 * 5. Uploads events after each step
 * 6. Reports final status to CP
 * 7. Gracefully shuts down on SIGTERM/SIGINT (marks itself offline)
 *
 * Usage: npx tsx src/daemon.ts
 *
 * Environment variables:
 *   CP_URL           — Control Plane base URL (default: http://localhost:3802)
 *   WORKSPACE_ID     — Workspace ID for registration (default: ws_default)
 *   RUNNER_NAME      — Runner display name (default: runner-{pid})
 *   RUNNER_VERSION   — Runner version string (default: 0.1.0)
 *   RUNNER_LABELS    — Comma-separated labels (default: empty)
 *   RUNNER_TOKEN     — Pre-existing token (skip registration)
 *   RUNNER_ID        — Required if RUNNER_TOKEN is set (otherwise auto-generated)
 *
 * Startup output:
 *   [runner] Registered as rnr_abc123
 *   [runner] Token: sk-xxxx... (save this!)
 *   [runner] Heartbeat started (every 15s)
 *   [runner] Polling for work at http://localhost:3802
 */

import { executePlan } from './index.js';
import type { ExecutionPlan } from '@sketch-test/runner-protocol';

// ── Configuration ──

const CP_URL = process.env['CP_URL'] ?? 'http://localhost:3802';
const WORKSPACE_ID = process.env['WORKSPACE_ID'] ?? 'ws_default';
const RUNNER_NAME = process.env['RUNNER_NAME'] ?? `runner-${process.pid}`;
const RUNNER_VERSION = process.env['RUNNER_VERSION'] ?? '0.1.0';
const RUNNER_LABELS = (process.env['RUNNER_LABELS'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const HEARTBEAT_INTERVAL_MS = 15_000;
const POLL_INTERVAL_MS = 2000;

// ── State ──

let runnerId: string;
let runnerToken: string;
let running = true;

// ── CP API helpers ──

interface CpRun {
  id: string;
  plan: ExecutionPlan;
}

async function cpRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${CP_URL}${path}`;
  const headers = new Headers(options.headers as Record<string, string> | undefined);
  headers.set('X-Runner-Token', runnerToken);
  if (!headers.has('Content-Type') && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

/** Register with the Control Plane. Returns the runner ID from the response. */
async function registerWithCP(): Promise<{ id: string; token: string }> {
  const response = await fetch(`${CP_URL}/api/runners/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId: WORKSPACE_ID,
      name: RUNNER_NAME,
      version: RUNNER_VERSION,
      labels: RUNNER_LABELS,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Registration failed (HTTP ${response.status}): ${body}`);
  }

  const data = (await response.json()) as { id: string; token: string };
  return data;
}

/** Long-poll for a pending run. */
async function pollForWork(): Promise<CpRun | null> {
  try {
    const response = await cpRequest('/api/runs/next');
    if (response.status === 204) return null;
    if (!response.ok) {
      console.error(`[runner] CP returned ${response.status}`);
      return null;
    }
    const data = (await response.json()) as { run: CpRun };
    return data.run;
  } catch (err) {
    console.error(`[runner] Failed to poll CP: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** Upload step events to the Control Plane. */
async function uploadEvents(
  runId: string,
  events: Array<{
    id: string;
    runId: string;
    stepIndex: number;
    eventType: string;
    payload: unknown;
  }>,
): Promise<void> {
  try {
    const response = await cpRequest(`/api/runs/${runId}/events`, {
      method: 'POST',
      body: JSON.stringify({ events }),
    });
    if (!response.ok) {
      console.error(`[runner] Failed to upload events: HTTP ${response.status}`);
    }
  } catch (err) {
    console.error(`[runner] Failed to upload events: ${err instanceof Error ? err.message : err}`);
  }
}

/** Report run status to the Control Plane. */
async function reportStatus(runId: string, status: string): Promise<void> {
  try {
    await cpRequest(`/api/runs/${runId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  } catch (err) {
    console.error(`[runner] Failed to report status: ${err instanceof Error ? err.message : err}`);
  }
}

/** Send a heartbeat to the Control Plane. */
async function sendHeartbeat(): Promise<void> {
  try {
    const response = await cpRequest(`/api/runners/${runnerId}/heartbeat`, {
      method: 'POST',
      body: JSON.stringify({ capacity: {} }),
    });
    if (!response.ok) {
      console.error(`[runner] Heartbeat failed: HTTP ${response.status}`);
    }
  } catch (err) {
    console.error(`[runner] Heartbeat error: ${err instanceof Error ? err.message : err}`);
  }
}

/** Mark the runner as offline on the Control Plane. */
async function markOffline(): Promise<void> {
  try {
    await cpRequest(`/api/runners/${runnerId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'offline' }),
    });
    console.log('[runner] Marked offline');
  } catch (err) {
    console.error(`[runner] Failed to mark offline: ${err instanceof Error ? err.message : err}`);
  }
}

// ── Heartbeat loop ──

function startHeartbeatLoop(): void {
  setInterval(async () => {
    if (running) {
      await sendHeartbeat();
    }
  }, HEARTBEAT_INTERVAL_MS);
}

// ── Shutdown handler ──

async function shutdown(signal: string): Promise<void> {
  if (!running) return;
  console.log(`[runner] Received ${signal}, shutting down...`);
  running = false;

  await markOffline();

  // Give the offline request a moment to complete
  setTimeout(() => {
    process.exit(0);
  }, 500);
}

// ── Run executor ──

async function executeRun(run: CpRun): Promise<void> {
  console.log(`[runner] Executing run ${run.id} (${run.plan.steps.length} steps)`);

  const result = await executePlan(run.plan, {
    runId: run.id,
    runnerId,
    runnerVersion: RUNNER_VERSION,
  });

  // Build stepId → stepIndex map from the plan
  const stepIndexMap = new Map<string, number>();
  for (let i = 0; i < run.plan.steps.length; i++) {
    stepIndexMap.set(run.plan.steps[i]!.stepId, i);
  }
  stepIndexMap.set('run', -1); // run-level events (run.started, run.finished)

  // Upload events batch, mapping stepId to stepIndex
  const uploadBatch = result.events
    .filter((e) => e.stepId !== 'run') // skip run-level events for step_events table
    .map((e) => ({
      id: `${run.id}-evt-${e.sequence}`,
      runId: run.id,
      stepIndex: stepIndexMap.get(e.stepId) ?? 0,
      eventType: e.eventType,
      payload: e,
    }));

  if (uploadBatch.length > 0) {
    await uploadEvents(run.id, uploadBatch);
  }

  // Report final status
  const status = result.status === 'passed' ? 'passed' : 'failed';
  await reportStatus(run.id, status);

  console.log(
    `[runner] Run ${run.id} completed: ${result.stepsPassed}/${run.plan.steps.length} passed (${result.totalDurationMs}ms)`,
  );
}

// ── Main ──

async function main(): Promise<void> {
  console.log(`[runner] Starting daemon...`);

  // ── Authentication: register or use existing token ──
  if (process.env['RUNNER_TOKEN']) {
    runnerToken = process.env['RUNNER_TOKEN'];
    runnerId = process.env['RUNNER_ID'] ?? '';

    if (!runnerId) {
      console.error(
        '[runner] ERROR: RUNNER_TOKEN is set but RUNNER_ID is not. ' +
          'When using a pre-existing token, you must also set RUNNER_ID.',
      );
      process.exit(1);
    }

    console.log(`[runner] Using existing runner ID: ${runnerId}`);
  } else {
    try {
      const registration = await registerWithCP();
      runnerId = registration.id;
      runnerToken = registration.token;

      console.log(`[runner] Registered as ${runnerId}`);
      console.log(`[runner] Token: ${runnerToken} (save this!)`);
    } catch (err) {
      console.error(`[runner] Failed to register: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  }

  // ── Start heartbeat ──
  startHeartbeatLoop();
  console.log(`[runner] Heartbeat started (every ${HEARTBEAT_INTERVAL_MS / 1000}s)`);

  // ── Register shutdown handlers ──
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  // ── Main polling loop ──
  console.log(`[runner] Polling for work at ${CP_URL}`);

  while (running) {
    const run = await pollForWork();
    if (run) {
      try {
        await executeRun(run);
      } catch (err) {
        console.error(`[runner] Run ${run.id} failed:`, err);
        await reportStatus(run.id, 'failed');
      }
    }
    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error('[runner] Daemon crashed:', err);
  process.exit(1);
});
