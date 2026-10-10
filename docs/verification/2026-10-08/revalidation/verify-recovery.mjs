import {api,assert,save,read,token,pause} from './client.mjs';
const restored=async path=>{const r=await fetch('http://127.0.0.1:3814'+path,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});assert(r.ok);return r.json()};
const results={checks:[],verifiedAt:new Date().toISOString()};
for(let i=0;i<25;i++){try{results.readiness=await restored('/ready');break}catch{await pause(1000)}}
for(const runId of read('retained-results.json').integrity.map(x=>x.runId)){
 const report=await api(`/api/runs/${runId}/report`);assert.deepEqual(await restored(`/api/runs/${runId}/report`),report);
 const manifest=await api(`/api/runs/${runId}/evidence-manifest`);assert.deepEqual(await restored(`/api/runs/${runId}/evidence-manifest`),manifest);
 const integrity=await restored(`/api/runs/${runId}/evidence-verify`);assert.equal(integrity.valid,true);
 results.checks.push({runId,reportIdentical:true,manifestIdentical:true,integrity});
}
const current=await api('/api/runs?pageSize=1'),copy=await restored('/api/runs?pageSize=1');assert.equal(copy.total,current.total);results.runCount=copy.total;
results.legacy=await restored('/api/runs/run_84626abc/evidence-verify');assert.equal(results.legacy.valid,false);assert.equal(results.legacy.unverifiableLegacyEventIds.length,7);
results.objects=read('storage-recovery-manifest.json').objectCount;results.status='passed';save('recovery-results.json',results);console.log('PASS recovery:',results.runCount,'Runs,',results.objects,'objects; all 6 new Run reports, manifests and integrity checks match');
