import {assert,api,save,access,original,base} from './live-client.mjs';
const restore='http://127.0.0.1:3813';
async function restored(path){const r=await fetch(restore+path,{headers:{Authorization:`Bearer ${access.token}`},signal:AbortSignal.timeout(10000)});assert(r.ok,`${path}: ${r.status}`);return r.json()}
for(let i=0;i<30;i++){try{if((await fetch(restore+'/ready')).ok)break}catch{}await new Promise(r=>setTimeout(r,1000))}
const live=await api(`/api/runs/${original.assets.runId}/report`),r=await restored(`/api/runs/${original.assets.runId}/report`);assert.deepEqual(r,live);
const counts=await api('/api/runs?pageSize=1'),restoredCounts=await restored('/api/runs?pageSize=1');assert.equal(restoredCounts.total,counts.total);
const manifest=await api(`/api/runs/${original.assets.runId}/evidence-manifest`),restoredManifest=await restored(`/api/runs/${original.assets.runId}/evidence-manifest`);assert.deepEqual(restoredManifest,manifest);
const result={verifiedAt:new Date().toISOString(),readiness:await restored('/ready'),runId:original.assets.runId,reportIdentical:true,runCount:restoredCounts.total,manifestIdentical:true,integrity:await restored(`/api/runs/${original.assets.runId}/evidence-verify`),limitation:'Byte-preserving backup/restore succeeds; existing inline event integrity defect is reproduced after restoration.'};save('recovery-results.json',result);console.log(JSON.stringify(result,null,2));
