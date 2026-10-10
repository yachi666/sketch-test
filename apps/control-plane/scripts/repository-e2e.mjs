/** Verify existing live repository generation jobs; never creates model calls or executes target APIs. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = process.env.REPOSITORY_CP_URL ?? 'http://127.0.0.1:3802';
const sourceId = process.env.REPOSITORY_API_VERSION_ID;
const jobIds = process.env.REPOSITORY_JOB_IDS?.split(',').filter(Boolean) ?? [];
assert(sourceId && jobIds.length, 'Set REPOSITORY_API_VERSION_ID and REPOSITORY_JOB_IDS');
let token = process.env.REPOSITORY_TOKEN;
if (!token) {
  const response = await fetch(`${base}/api/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(
    response.status,
    200,
    'Provide a token if explicit development guest access is disabled',
  );
  token = (await response.json()).token;
}
async function get(path) {
  const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200, path);
  return response.json();
}
const source = await get(`/api/api-versions/${sourceId}`);
assert.equal(source.sourceType, 'code-discovery');
assert.match(source.metadata.extra.commit, /^[a-f0-9]{40}$/);
assert(source.endpoints.length > 0);
const jobs = [];
for (const id of jobIds) {
  const job = await get(`/api/generation-jobs/${id}`);
  assert.equal(job.status, 'completed', `${id}: ${job.errorCode}`);
  const { drafts } = await get(`/api/generation-jobs/${id}/drafts`);
  assert(drafts.length > 0);
  const verified = [];
  for (const entry of drafts) {
    const draft = await get(`/api/drafts/${entry.id}`);
    assert.equal(draft.status, 'pending');
    assert.equal(draft.sourceInfo.commit, source.metadata.extra.commit);
    assert.equal(draft.sourceInfo.sourceHash, source.contentHash);
    const endpoint = source.endpoints.find((e) => e.id === draft.sourceInfo.endpointId);
    assert(endpoint);
    assert.equal(draft.definition.request.method, endpoint.method);
    assert.equal(
      draft.definition.request.url,
      `\${env.baseUrl}${endpoint.path.replace(/\{([^}]+)\}/g, (_, name) => `\${env.${name}}`)}`,
    );
    assert(
      draft.definition.assertions.some(
        (a) =>
          a.target === 'status' &&
          a.operator === 'equals' &&
          endpoint.responses.some((r) => r.statusCode === a.expected),
      ),
    );
    assert(
      draft.sourceInfo.codeLocations.every(
        (l) =>
          l.location.includes(`/blob/${source.metadata.extra.commit}/`) &&
          /#L\d+$/.test(l.location),
      ),
    );
    if (endpoint.method === 'POST' && endpoint.path === '/api/workspace/staff') {
      const body = draft.definition.request.body;
      assert.equal(body.type, 'json');
      assert(
        body.value.staffId && body.value.teamId,
        'Generated request must include the discovered required DTO fields',
      );
    }
    verified.push({
      id: draft.id,
      name: draft.definition.name,
      method: endpoint.method,
      path: endpoint.path,
      model: draft.sourceInfo.model,
      commit: draft.sourceInfo.commit,
      sourceLocations: draft.sourceInfo.codeLocations.map((l) => l.location),
      status: draft.status,
    });
  }
  jobs.push({
    id,
    status: job.status,
    selectedEndpoints: job.config.endpointIds.length,
    draftCount: drafts.length,
    coveredEndpoints: new Set(drafts.map((d) => d.sourceInfo.endpointId)).size,
    drafts: verified,
  });
}
const anonymous = await fetch(`${base}/api/import/repository`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ repositoryUrl: source.metadata.extra.repositoryUrl }),
});
assert.equal(anonymous.status, 401);
const invalid = await fetch(`${base}/api/import/repository`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ repositoryUrl: 'http://127.0.0.1/private' }),
});
assert.equal(invalid.status, 400);
const result = {
  ok: true,
  repositoryUrl: source.metadata.extra.repositoryUrl,
  commit: source.metadata.extra.commit,
  apiVersionId: source.id,
  sourceHash: source.contentHash,
  scannedFiles: source.metadata.extra.files.length,
  endpointCount: source.endpoints.length,
  jobs,
  anonymousStatus: anonymous.status,
  unsafeUrlStatus: invalid.status,
  targetApiExecuted: false,
};
if (process.env.REPOSITORY_EVIDENCE_PATH)
  await writeFile(process.env.REPOSITORY_EVIDENCE_PATH, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
