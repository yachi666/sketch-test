import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
export {assert};
export const dir=new URL('./',import.meta.url);
export const access=JSON.parse(readFileSync(new URL('../../../.services/verification-access.json',import.meta.url),'utf8'));
export const original=JSON.parse(readFileSync(new URL('platform-results.json',dir),'utf8'));
export const {base,token,workspaceId}=access;
export function save(name,x){writeFileSync(new URL(name,dir),typeof x==='string'?x:JSON.stringify(x,null,2));}
export async function api(path,body,method=body===undefined?'GET':'POST',options={}){const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'content-type':'application/json'}),...options.headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});const txt=await r.text();let data;try{data=JSON.parse(txt)}catch{data=txt}if(options.status){assert.equal(r.status,options.status,`${path}: ${txt}`);return data}if(!r.ok)throw Error(`${method} ${path}: ${r.status} ${txt.slice(0,450)}`);return data;}
export async function finish(id){for(let i=0;i<180;i++){const r=await api(`/api/runs/${id}/report`);if(!['pending','claimed','running','queued','leased'].includes(r.run.status)){save(`report-${id}.json`,r);return r}await new Promise(r=>setTimeout(r,1000))}throw Error(`Run timeout ${id}`)}
export async function jobFinish(id){for(let i=0;i<160;i++){const r=await api(`/api/generation-jobs/${id}`);if(['completed','failed','cancelled'].includes(r.status))return r;await new Promise(r=>setTimeout(r,1000))}throw Error('Job timed out '+id)}
