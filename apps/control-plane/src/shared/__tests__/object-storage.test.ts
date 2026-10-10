import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createObjectStore, FileObjectStore, S3ObjectStore } from '../object-storage.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FileObjectStore', () => {
  test('round-trips object bytes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sketchtest-objects-'));
    roots.push(root);
    const store = new FileObjectStore(root);
    await store.put('runs/run-1/manifest.json', '{"ok":true}', 'application/json');
    expect(await store.exists('runs/run-1/manifest.json')).toBe(true);
    const stored = await store.get('runs/run-1/manifest.json');
    expect(new TextDecoder().decode(stored.body)).toBe('{"ok":true}');
  });

  test('rejects traversal outside the store root', async () => {
    const store = new FileObjectStore('/tmp/store');
    await expect(store.put('../secret', 'x', 'text/plain')).rejects.toThrow(/inside/);
  });
});

describe('createObjectStore', () => {
  test('uses filesystem storage outside production', () => {
    expect(createObjectStore({ NODE_ENV: 'test' })).toBeInstanceOf(FileObjectStore);
  });

  test('requires complete S3 configuration in production', () => {
    expect(() => createObjectStore({ NODE_ENV: 'production' })).toThrow(/S3_ENDPOINT/);
  });

  test('creates S3 storage for complete production configuration', () => {
    expect(
      createObjectStore({
        NODE_ENV: 'production',
        S3_ENDPOINT: 'https://s3.example.com',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY: 'access',
        S3_SECRET_KEY: 'secret',
        S3_BUCKET: 'evidence',
      }),
    ).toBeInstanceOf(S3ObjectStore);
  });
});
