import { expect, test } from 'vitest';
import { generationRequestUrl } from '../index.js';

test('source and canonical path parameters use the same explicit environment binding', () => {
  const expected = '${env.baseUrl}/repos/${env.owner}/${env.repo}';
  expect(generationRequestUrl('/repos/:owner/:repo')).toBe(expected);
  expect(generationRequestUrl('/repos/{owner}/{repo}')).toBe(expected);
});

test('literal colon action suffixes are not converted to environment parameters', () => {
  expect(generationRequestUrl('/repos/:owner/jobs:batch')).toBe(
    '${env.baseUrl}/repos/${env.owner}/jobs:batch',
  );
});
