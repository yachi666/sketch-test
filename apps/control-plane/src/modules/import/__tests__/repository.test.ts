import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';

vi.mock('../../../db/db.js', () => ({ pool: { query: vi.fn() } }));

import { analyzeRepository, parseRepositoryInput } from '../repository.service.js';

test.each([
  'http://github.com/a/b',
  'https://github.com.evil.test/a/b',
  'https://user:pass@github.com/a/b',
  'https://github.com/a/b/tree/main',
  'https://127.0.0.1/a/b',
  'https://github.com/a/b?token=secret',
])('rejects unsafe repository URL %s', (repositoryUrl) => {
  expect(() => parseRepositoryInput({ repositoryUrl })).toThrow();
});
test('normalizes git suffix and keeps branch separate', () => {
  expect(
    parseRepositoryInput({
      repositoryUrl: 'https://github.com/owner/repo.git',
      ref: 'feature/test',
      directory: 'src/main/',
    }),
  ).toEqual({
    slug: 'owner/repo',
    repositoryUrl: 'https://github.com/owner/repo',
    ref: 'feature/test',
    directory: 'src/main',
  });
  expect(() =>
    parseRepositoryInput({ repositoryUrl: 'https://github.com/a/b', directory: '../other' }),
  ).toThrow();
});
function remote(options: { truncated?: boolean; incorrectBlob?: boolean; status?: number } = {}) {
  const content =
    '@RestController public class HealthController { @GetMapping("/health") public Object health() { return ResponseEntity.ok(1); } }';
  const sha = createHash('sha1')
    .update(`blob ${Buffer.byteLength(content)}\0${content}`)
    .digest('hex');
  return vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    expect(init?.redirect).toBe('error');
    const url = String(input);
    if (options.status) return new Response('', { status: options.status });
    if (url.includes('/commits/'))
      return Response.json({ sha: 'a'.repeat(40), commit: { tree: { sha: 'b'.repeat(40) } } });
    if (url.includes('/git/trees/'))
      return Response.json({
        truncated: options.truncated ?? false,
        tree: [
          {
            path: 'src/main/java/HealthController.java',
            sha: options.incorrectBlob ? 'c'.repeat(40) : sha,
            type: 'blob',
            mode: '100644',
            size: content.length,
          },
          { path: '.env', sha, type: 'blob', mode: '100644', size: 40 },
        ],
      });
    expect(url).toBe(
      `https://raw.githubusercontent.com/a/b/${'a'.repeat(40)}/src/main/java/HealthController.java`,
    );
    return new Response(content);
  });
}
test('pins raw reads to commit and verifies blob hash while excluding secret/config files', async () => {
  const fetcher = remote();
  const result = await analyzeRepository({ repositoryUrl: 'https://github.com/a/b' }, fetcher);
  expect(result.commit).toBe('a'.repeat(40));
  expect(result.scannedFiles).toBe(1);
  expect(result.model.endpoints[0]?.path).toBe('/health');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
test('refuses partial trees or mismatched snapshot content', async () => {
  await expect(
    analyzeRepository({ repositoryUrl: 'https://github.com/a/b' }, remote({ truncated: true })),
  ).rejects.toThrow('不完整');
  await expect(
    analyzeRepository({ repositoryUrl: 'https://github.com/a/b' }, remote({ incorrectBlob: true })),
  ).rejects.toThrow('不一致');
});
test('surfaces rate limits and private/missing repositories without persisting fake success', async () => {
  await expect(
    analyzeRepository({ repositoryUrl: 'https://github.com/a/b' }, remote({ status: 429 })),
  ).rejects.toThrow('限流');
  await expect(
    analyzeRepository({ repositoryUrl: 'https://github.com/a/b' }, remote({ status: 404 })),
  ).rejects.toThrow('公开仓库');
});
