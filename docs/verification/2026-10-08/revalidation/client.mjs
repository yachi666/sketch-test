import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
export { assert };
export const dir = new URL('./', import.meta.url);
const access = JSON.parse(readFileSync(new URL('../../../../.services/verification-access.json', import.meta.url), 'utf8'));
export const { base, token, workspaceId } = access;
export const read = (file) => JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
export const save = (file, value) => writeFileSync(new URL(file, dir), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function api(path, body, method = body === undefined ? 'GET' : 'POST', expected) {
 const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : {'content-type':'application/json'}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000) });
 const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
 if (expected) assert.equal(r.status, expected, `${path}: ${text.slice(0,500)}`);
 else if (!r.ok) throw new Error(`${path}: ${r.status} ${text.slice(0,500)}`);
 return data;
}
export async function finish(id) {
 for(let i=0;i<160;i++) {const report = await api(`/api/runs/${id}/report`); if(!['pending','claimed','running'].includes(report.run.status)) {save(`report-${id}.json`,report);return report;} await pause(1000);}
 throw new Error(`Run timeout ${id}`);
}
export async function jobFinish(id) {
 for(let i=0;i<180;i++) { const job = await api(`/api/generation-jobs/${id}`); if(['completed','failed','cancelled'].includes(job.status)) return job; await pause(1000); }
 throw new Error(`Generation timeout ${id}`);
}
