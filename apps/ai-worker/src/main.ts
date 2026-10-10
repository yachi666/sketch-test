import { generateDrafts } from './harness.js';
import { configuredModel } from './model.js';
import { generatePlan } from './plan-harness.js';

// One bounded JSON task per independent process. No CP/Runner implementation imports.
// Deployment must explicitly select a provider/model and supply its own model credential.
async function main() {
  const { model, apiKey, streamFn } = configuredModel();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1024 * 1024) throw new Error('Generation input exceeds 1 MiB');
      chunks.push(Buffer.from(chunk));
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const generate =
      input.schemaVersion === 'sketch-test.plan-generation/v1' ? generatePlan : generateDrafts;
    const result = await generate(input, {
      model,
      streamFn,
      apiKey,
      signal: controller.signal,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

main().catch(() => {
  // Never dump raw prompts, provider errors, tool arguments, or credentials to logs.
  process.stderr.write(
    'AI generation failed. Check input, provider configuration and execution limits.\n',
  );
  process.exitCode = 1;
});
