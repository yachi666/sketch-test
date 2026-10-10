import { existsSync, globSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only disposable build caches. Runtime state, evidence, logs, and installed
// dependencies are deliberately outside this command's cleanup targets.
const root = fileURLToPath(new URL('..', import.meta.url));
const dryRun = process.argv.includes('--dry-run');
const packageRoots = [
  root,
  ...globSync(['apps/*/package.json', 'packages/*/*/package.json', 'tooling/*/package.json'], {
    cwd: root,
  }).map((manifest) => path.dirname(path.join(root, manifest))),
];
const targets = packageRoots.flatMap((directory) => [
  ...['.turbo', '.vite', '.npm-cache', 'node_modules/.vite', 'node_modules/.cache'].map((cache) =>
    path.join(directory, cache),
  ),
  ...globSync('*.tsbuildinfo', { cwd: directory }).map((file) => path.join(directory, file)),
]);
const present = targets.filter((target) => existsSync(target));
for (const target of present) {
  if (!dryRun) rmSync(target, { recursive: true, force: true });
  console.log(`${dryRun ? 'Would remove' : 'Removed'} ${path.relative(root, target)}`);
}
console.log(`${dryRun ? 'Found' : 'Removed'} ${present.length} generated cache paths.`);
