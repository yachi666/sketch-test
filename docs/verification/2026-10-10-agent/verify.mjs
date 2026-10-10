import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('./', import.meta.url);
const save = (name, data) => writeFileSync(new URL(name, dir), JSON.stringify(data, null, 2));
const base = 'http://127.0.0.1:3812';
// Use the already-enabled local QA session endpoint; never persist its token.
const session = await (await fetch(`${base}/api/auth/guest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
assert.ok(session.token);
async function get(path) {
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, path);
  return response.json();
}
const original = JSON.parse(readFileSync(new URL('real-generation.json', dir)));
const job = await get(`/api/generation-jobs/${original.job.id}`);
const draft = await get(`/api/drafts/${original.drafts[0].id}`);
assert.equal(job.status, 'completed');
assert.equal(draft.status, 'accepted');
assert.equal(draft.sourceInfo.model, job.config.model);
assert.equal(draft.sourceInfo.provider, job.config.provider);
assert.deepEqual(draft.sourceInfo, original.drafts[0].sourceInfo);
assert.deepEqual(draft.definition, original.drafts[0].definition);
const source = await get(`/api/api-versions/${job.apiVersionId}`);
assert.equal(draft.sourceInfo.sourceHash, source.contentHash);
const versions = await get(`/api/test-cases/${draft.testCaseId}/versions`);
assert.equal(versions.versions.length, 1);
const version = versions.versions[0];
// Current service uses publishedBy as the publication marker; publishedAt has a DB default.
assert.equal(version.publishedBy, null);
assert.deepEqual(version.definition, draft.definition);
save('accepted-case.json', { job, draft, versions });
const checks = {
  checkedAt: new Date().toISOString(), jobId: job.id, draftId: draft.id, testCaseId: draft.testCaseId,
  provider: job.config.provider, model: job.config.model,
  durationMs: Date.parse(job.completedAt) - Date.parse(job.createdAt),
  completed: true, acceptedWithoutPublishing: true, sourceHashMatches: true,
  definitionAndProvenancePreservedAfterReview: true,
  persistedAgentId: Object.hasOwn(draft.sourceInfo, 'agentId'),
  persistedAgentVersion: Object.hasOwn(draft.sourceInfo, 'agentVersion'),
  testcaseVersionFields: Object.keys(version),
  draftPublishedAtAmbiguity: version.publishedAt !== null,
};
save('checks.json', checks);
console.log(JSON.stringify(checks, null, 2));
