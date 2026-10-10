import {assert,api,save,workspaceId} from './live-client.mjs';
const e={checks:[]};
async function check(name,fn){try{e.checks.push({name,status:'passed',value:await fn()});console.log('PASS',name)}catch(x){e.checks.push({name,status:'failed',error:x.message});console.log('FAIL',name,x.message)}save('import-results.json',e)}
await check('normalized official weather OpenAPI import',async()=>{const x=await api('/api/import',{sourceType:'url',sourceLocation:'http://sketchtest-verification-sources/open-meteo-normalized.yml'});save('weather-normalized-import.json',x);assert(x.endpointCount>0);return x});
await check('policy resource constraints require approval',async()=>{const x=await api('/api/policies/evaluate',{workspaceId,subject:{id:'verification',role:'owner'},action:'run:start',resource:{environment:'production'}});assert.equal(x.decision,'require-approval');return x});
