import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const documents = [
  'README.md',
  'README.zh-CN.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'docs/GITHUB_AUTOMATION.md',
];
const errors = [];

// Validate local file links in the maintained entry-point docs without network
// requests. Historical evidence and third-party URLs are deliberately excluded.
for (const document of documents) {
  const source = readFileSync(join(root, document), 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const match of source.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) continue;
    const path = decodeURIComponent(target.split(/[?#]/)[0]);
    if (path && !existsSync(resolve(root, dirname(document), path))) {
      errors.push(`${document}: missing local link target ${target}`);
    }
  }
}

function inspectActions(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      inspectActions(path);
    } else if (/\.ya?ml$/.test(entry.name)) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) {
        const reference = match[1];
        if (reference.startsWith('./')) continue;
        if (!/^[\w.-]+\/[\w./-]+@[a-f\d]{40}$/.test(reference)) {
          errors.push(`${path}: external action must use a full commit SHA: ${reference}`);
        }
      }
    }
  }
}
inspectActions(join(root, '.github', 'actions'));
inspectActions(join(root, '.github', 'workflows'));

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Documentation file links and immutable action references are valid.');
}
