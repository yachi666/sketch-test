#!/usr/bin/env node
/**
 * SketchTest CLI — trigger runs and check results from CI pipelines.
 *
 * Commands:
 *   sketchtest run <workflowVersionId>         Trigger a published workflow version and wait
 *   sketchtest run-workflow <workflowVersionId> Alias for run
 *   sketchtest status <runId>             Check run status
 *   sketchtest report <runId>             Get run report (JSON/text/github)
 *
 * Options:
 *   --cp-url <url>          Control Plane URL (default: http://localhost:3802)
 *   --token <token>         Auth token (or set SKETCHTEST_TOKEN env var)
 *   --wait                  Wait for run to complete (default: true)
 *   --no-wait               Exit immediately after triggering
 *   --timeout <seconds>     Max wait time (default: 300)
 *   --poll-interval <s>     Poll interval in seconds (default: 3)
 *   --output <format>       Output format: json | text | github (default: text)
 */

import { configureClient, request } from './cp-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OutputFormat = 'text' | 'json' | 'github';

interface ParsedArgs {
  command: string;
  args: string[];
  options: Record<string, string | boolean>;
}

interface RunSummary {
  id: string;
  apiVersionId: string | null;
  status: string;
  runnerId: string | null;
  claimedAt: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface RunReport {
  run: RunSummary;
  steps: Array<{
    stepIndex: number;
    events: Array<{
      stepIndex: number;
      eventType: string;
      payload: unknown;
      timestamp: string;
    }>;
    status: string;
    durationMs?: number;
  }>;
}

interface TriggerResult {
  runId: string;
  plan?: unknown;
}

// ---------------------------------------------------------------------------
// Arg parser (zero external deps)
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): ParsedArgs {
  const options: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let i = 2;

  while (i < argv.length) {
    const arg = argv[i];
    if (!arg) break;
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        const key = arg.slice(2, eqIndex);
        const value = arg.slice(eqIndex + 1);
        options[key] = value;
      } else {
        const key = arg.slice(2);
        if (key.startsWith('no-') && i + 1 >= argv.length) {
          options[key.slice(3)] = false;
        } else if (i + 1 < argv.length && !argv[i + 1]?.startsWith('--')) {
          const value = argv[i + 1];
          if (value === undefined) break;
          options[key] = value;
          i++;
        } else {
          if (key.startsWith('no-')) {
            options[key.slice(3)] = false;
          } else {
            options[key] = true;
          }
        }
      }
    } else {
      positional.push(arg);
    }
    i++;
  }

  return { command: positional[0] ?? '', args: positional.slice(1), options };
}

function strOpt(
  options: Record<string, string | boolean>,
  key: string,
  envVar?: string,
): string | undefined {
  if (typeof options[key] === 'string') return options[key] as string;
  if (envVar && process.env[envVar]) return process.env[envVar];
  return undefined;
}

function numOpt(options: Record<string, string | boolean>, key: string, fallback: number): number {
  const val = options[key];
  if (typeof val === 'string') {
    const n = parseInt(val, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function outputText(message: string): void {
  process.stdout.write(`${message}\n`);
}

function outputError(message: string): void {
  process.stderr.write(`${message}\n`);
}

function githubGroup(title: string): void {
  outputText(`::group::${title}`);
}

function githubEndGroup(): void {
  outputText('::endgroup::');
}

function githubError(message: string): void {
  outputText(`::error::${message}`);
}

function githubWarning(message: string): void {
  outputText(`::warning::${message}`);
}

function githubNotice(message: string): void {
  outputText(`::notice::${message}`);
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

const EXIT = {
  PASSED: 0,
  FAILED: 1,
  INCONCLUSIVE: 2,
  ERROR: 3,
  CANCELLED: 4,
} as const;

function exitCodeForStatus(status: string): number {
  switch (status) {
    case 'passed':
      return EXIT.PASSED;
    case 'failed':
    case 'blocked':
      return EXIT.FAILED;
    case 'inconclusive':
      return EXIT.INCONCLUSIVE;
    case 'cancelled':
      return EXIT.CANCELLED;
    default:
      return EXIT.ERROR;
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  const { command, args, options } = parsed;

  if (!command) {
    outputError('Usage: sketchtest <command> [options]');
    outputError('');
    outputError('Commands:');
    outputError('  run <workflowVersionId>         Trigger a published workflow version');
    outputError('  run-workflow <workflowVersionId> Alias for run');
    outputError('  status <runId>            Check run status');
    outputError('  report <runId>            Get run report');
    outputError('');
    outputError('Options:');
    outputError('  --cp-url <url>          Control Plane URL (default: http://localhost:3802)');
    outputError('  --token <token>         Auth token (or set SKETCHTEST_TOKEN)');
    outputError('  --wait / --no-wait      Wait for run completion (default: --wait)');
    outputError('  --timeout <seconds>     Max wait time (default: 300)');
    outputError('  --poll-interval <s>     Poll interval in seconds (default: 3)');
    outputError('  --output <format>       json | text | github (default: text)');
    process.exit(EXIT.ERROR);
  }

  const cpUrl = strOpt(options, 'cp-url', 'SKETCHTEST_CP_URL') ?? 'http://localhost:3802';
  const token = strOpt(options, 'token', 'SKETCHTEST_TOKEN') ?? '';
  const output = (strOpt(options, 'output') ?? 'text') as OutputFormat;
  // Default: wait for completion. Use --no-wait to disable.
  const shouldWait = options['wait'] !== false;
  const timeoutSec = numOpt(options, 'timeout', 300);
  const pollIntervalSec = numOpt(options, 'poll-interval', 3);

  configureClient({ baseUrl: cpUrl, token });

  switch (command) {
    case 'run': {
      const workflowVersionId = args[0];
      if (!workflowVersionId) {
        outputError('Error: workflowVersionId is required for "run" command');
        outputError('Usage: sketchtest run <workflowVersionId> [options]');
        process.exit(EXIT.ERROR);
      }
      await handleRun(workflowVersionId, {
        shouldWait,
        timeoutSec,
        pollIntervalSec,
        output,
      });
      break;
    }
    case 'run-workflow': {
      const workflowVersionId = args[0];
      if (!workflowVersionId) {
        outputError('Error: workflowVersionId is required for "run-workflow" command');
        outputError('Usage: sketchtest run-workflow <workflowVersionId> [options]');
        process.exit(EXIT.ERROR);
      }
      await handleRunWorkflow(workflowVersionId, {
        shouldWait,
        timeoutSec,
        pollIntervalSec,
        output,
      });
      break;
    }
    case 'status': {
      const runId = args[0];
      if (!runId) {
        outputError('Error: runId is required for "status" command');
        process.exit(EXIT.ERROR);
      }
      await handleStatus(runId, output);
      break;
    }
    case 'report': {
      const runId = args[0];
      if (!runId) {
        outputError('Error: runId is required for "report" command');
        process.exit(EXIT.ERROR);
      }
      await handleReport(runId, output);
      break;
    }
    default:
      outputError(`Error: unknown command "${command}"`);
      outputError('Run "sketchtest" without arguments to see usage.');
      process.exit(EXIT.ERROR);
  }
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

interface RunOptions {
  shouldWait: boolean;
  timeoutSec: number;
  pollIntervalSec: number;
  output: OutputFormat;
}

async function handleRun(workflowVersionId: string, opts: RunOptions): Promise<void> {
  try {
    const body = { workflowVersionId };

    const result = await request<TriggerResult>('/api/runs/from-workflow', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (opts.output === 'github') {
      githubGroup(`SketchTest Run: ${result.runId}`);
    }

    if (!opts.shouldWait) {
      if (opts.output === 'json') {
        outputText(JSON.stringify(result));
      } else {
        outputText(`Run triggered: ${result.runId}`);
      }
      process.exit(EXIT.PASSED);
    }

    const summary = await pollRun(result.runId, {
      timeoutSec: opts.timeoutSec,
      pollIntervalSec: opts.pollIntervalSec,
    });

    printRunResult(summary, opts.output);

    if (opts.output === 'github') {
      githubEndGroup();
    }

    process.exit(exitCodeForStatus(summary.status));
  } catch (err) {
    if (opts.output === 'github') {
      githubError(`SketchTest run failed: ${err instanceof Error ? err.message : String(err)}`);
      githubEndGroup();
    }
    outputError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(EXIT.ERROR);
  }
}

async function handleRunWorkflow(workflowVersionId: string, opts: RunOptions): Promise<void> {
  try {
    const body = { workflowVersionId };

    const result = await request<TriggerResult>('/api/runs/from-workflow', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (opts.output === 'github') {
      githubGroup(`SketchTest Workflow Run: ${result.runId}`);
    }

    if (!opts.shouldWait) {
      if (opts.output === 'json') {
        outputText(JSON.stringify(result));
      } else {
        outputText(`Run triggered: ${result.runId}`);
      }
      process.exit(EXIT.PASSED);
    }

    const summary = await pollRun(result.runId, {
      timeoutSec: opts.timeoutSec,
      pollIntervalSec: opts.pollIntervalSec,
    });

    printRunResult(summary, opts.output);

    if (opts.output === 'github') {
      githubEndGroup();
    }

    process.exit(exitCodeForStatus(summary.status));
  } catch (err) {
    if (opts.output === 'github') {
      githubError(
        `SketchTest workflow run failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      githubEndGroup();
    }
    outputError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(EXIT.ERROR);
  }
}

async function handleStatus(runId: string, output: OutputFormat): Promise<void> {
  try {
    const response = await request<{ run: RunSummary }>(`/api/runs/${runId}`);
    const run = response.run;
    if (output === 'json') {
      outputText(JSON.stringify(run));
    } else if (output === 'github') {
      outputText(`::notice::Run ${runId}: ${run.status}`);
      printRunStatus(run, output);
    } else {
      outputText(`Run: ${run.id}`);
      outputText(`Status: ${run.status}`);
      outputText(`Created: ${run.createdAt}`);
      if (run.finishedAt) outputText(`Finished: ${run.finishedAt}`);
      if (run.runnerId) outputText(`Runner: ${run.runnerId}`);
    }
    process.exit(exitCodeForStatus(run.status));
  } catch (err) {
    outputError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(EXIT.ERROR);
  }
}

async function handleReport(runId: string, output: OutputFormat): Promise<void> {
  try {
    const report = await request<RunReport>(`/api/runs/${runId}/report`);
    if (output === 'json') {
      outputText(JSON.stringify(report));
    } else if (output === 'github') {
      printReportGitHub(report);
    } else {
      printReportText(report);
    }
    process.exit(exitCodeForStatus(report.run.status));
  } catch (err) {
    outputError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(EXIT.ERROR);
  }
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

const TERMINAL_STATES = new Set(['passed', 'failed', 'inconclusive', 'cancelled', 'lost']);

interface PollOptions {
  timeoutSec: number;
  pollIntervalSec: number;
}

async function pollRun(runId: string, opts: PollOptions): Promise<RunSummary> {
  const deadline = Date.now() + opts.timeoutSec * 1000;
  let lastStatus = 'queued';

  while (Date.now() < deadline) {
    const response = await request<{ run: RunSummary }>(`/api/runs/${runId}`);
    const run = response.run;

    if (run.status !== lastStatus) {
      process.stderr.write(`  Status: ${run.status}\n`);
      lastStatus = run.status;
    }

    if (TERMINAL_STATES.has(run.status)) {
      return run;
    }

    await sleep(opts.pollIntervalSec * 1000);
  }

  throw new Error(
    `Timeout waiting for run ${runId} to complete (waited ${opts.timeoutSec}s, last status: ${lastStatus})`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function printRunResult(run: RunSummary, format: OutputFormat): void {
  if (format === 'json') {
    outputText(JSON.stringify(run));
    return;
  }

  if (format === 'github') {
    printRunStatus(run, format);
    return;
  }

  // text format
  outputText('');
  outputText('──────────── Run Result ────────────');
  outputText(`Run ID:     ${run.id}`);
  outputText(`Status:     ${run.status}`);
  outputText(`Created:    ${run.createdAt}`);
  if (run.finishedAt) outputText(`Finished:   ${run.finishedAt}`);
  if (run.runnerId) outputText(`Runner:     ${run.runnerId}`);
  outputText('────────────────────────────────────');
}

function printRunStatus(run: RunSummary, _format: OutputFormat): void {
  switch (run.status) {
    case 'passed':
      githubNotice(`Run ${run.id} PASSED`);
      break;
    case 'failed':
      githubError(`Run ${run.id} FAILED`);
      break;
    case 'inconclusive':
      githubWarning(`Run ${run.id} INCONCLUSIVE`);
      break;
    case 'cancelled':
      githubWarning(`Run ${run.id} CANCELLED`);
      break;
    default:
      githubNotice(`Run ${run.id}: ${run.status}`);
  }
}

function printReportText(report: RunReport): void {
  const { run, steps } = report;

  outputText('');
  outputText('══════════════ Run Report ══════════════');
  outputText(`Run ID:     ${run.id}`);
  outputText(`Status:     ${run.status}`);
  outputText(`Created:    ${run.createdAt}`);
  if (run.finishedAt) outputText(`Finished:   ${run.finishedAt}`);
  outputText(`Steps:      ${steps.length}`);
  outputText('');

  for (const step of steps) {
    const icon = step.status === 'passed' ? '✓' : step.status === 'failed' ? '✗' : '?';
    outputText(
      `  Step ${step.stepIndex}: ${icon} ${step.status}${step.durationMs ? ` (${step.durationMs}ms)` : ''}`,
    );

    // Show assertion results
    const assertionEvents = step.events.filter((e) => e.eventType === 'assertion.evaluated');
    for (const ae of assertionEvents) {
      const payload = ae.payload as Record<string, unknown>;
      const passed = payload['passed'] ? '  PASS' : '  FAIL';
      outputText(`    ${passed}  ${payload['description'] ?? '(no description)'}`);
    }
  }

  outputText('');
  outputText('════════════════════════════════════════');
}

function printReportGitHub(report: RunReport): void {
  const { run, steps } = report;

  githubGroup('SketchTest Run Report');
  outputText(`Run: ${run.id}`);
  outputText(`Status: ${run.status}`);
  outputText(`Steps: ${steps.length}`);

  for (const step of steps) {
    const stepLabel = `Step ${step.stepIndex} — ${step.status}`;
    if (step.status === 'failed') {
      githubError(stepLabel);
    } else if (step.status === 'passed') {
      githubNotice(stepLabel);
    } else {
      githubWarning(stepLabel);
    }

    const assertionEvents = step.events.filter((e) => e.eventType === 'assertion.evaluated');
    for (const ae of assertionEvents) {
      const payload = ae.payload as Record<string, unknown>;
      if (payload['passed']) continue; // Only report failures
      const desc = payload['description'] ?? '(no description)';
      const actual = payload['actual'] ?? 'N/A';
      const expected = payload['expected'] ?? 'N/A';
      githubError(`Assertion failed: ${desc} — expected: ${expected}, actual: ${actual}`);
    }
  }

  githubEndGroup();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err) => {
  outputError(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(EXIT.ERROR);
});
