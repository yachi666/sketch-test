/** Uses the existing local QA identity and publicly imported API. Never writes tokens to disk. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base=process.env.CP_URL??'http://127.0.0.1:3812';
const login=await (await fetch(base+'/api/auth/guest',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
async function api(path,body,method=body?'POST':'GET'){
 const r=await fetch(base+path,{method,headers:{authorization:`Bearer ${login.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();if(!r.ok)throw Error(`${path}: ${r.status} ${JSON.stringify(data)}`);return data;
}
const jobId='gj_d1987170';
const {agents}=await api('/api/agents');const a=agents.find(a=>a.name==='契约用例 Agent');assert(a);
const {schemaVersion,id,version,provider,connectionRef,connectionName,...config}=a;
if(a.version===1)await api(`/api/agents/${a.id}`,{expectedVersion:1,config:{...config,instructions:config.instructions+' 保留原始来源和断言依据。'}},'PUT');
for(const [name,avatar,capability,instructions] of [
 ['中文场景 Agent','language','test','根据接口证据用中文解释场景与断言依据，只提交待审草稿。'],
 ['测试计划 Agent','plan','plan','根据已有已发布用例制定可复核的测试计划，不编造用例 ID。']
]) if(!agents.some(a=>a.name===name))await api('/api/agents',{...config,name,avatar,capability,instructions});
let execution;
for(let n=0;n<40;n++){
 execution=await api(`/api/generation-jobs/${jobId}/execution`);
 if(['completed','failed','cancelled'].includes(execution.status))break;
 await new Promise(r=>setTimeout(r,3000));
}
assert.equal(execution.status,'completed');assert.equal(execution.agent.version,1);assert.equal(execution.config.model,'deepseek-flash');
assert(execution.events.some(e=>e.type==='model.completed'));assert(execution.events.some(e=>e.type==='tool.completed'));assert.equal(execution.outputs.length,1);
const output=execution.outputs[0];let testCaseId=output.testCaseId;
if(!testCaseId){const accepted=await api(`/api/drafts/${output.id}/accept`,{modifications:{...output.originalDefinition,name:'Agent 溯源验收 · Node.js 公开仓库'}});testCaseId=accepted.testCaseId;}
const provenance=await api(`/api/test-cases/${testCaseId}/provenance`);assert.equal(provenance.sources[0].jobId,jobId);
execution=await api(`/api/generation-jobs/${jobId}/execution`);assert.equal(execution.outputs[0].originalDefinition.name,output.originalDefinition.name);
const history=await api(`/api/agents/${a.id}/versions`);assert.deepEqual(history.versions.map(v=>v.config.version),[2,1]);
const {agents:all}=await api('/api/agents');const planAgent=all.find(a=>a.capability==='plan');
const {job:plan}=await api('/api/plan-suggestions',{agentId:planAgent.id,objective:'选择一个已发布的只读 GitHub 仓库元数据用例，形成一份最小回归计划草稿。保留来源，不发布、不运行。'});
const evidence={verifiedAt:new Date().toISOString(),jobId,testCaseId,agentVersionAtExecution:execution.agent.version,currentAgentVersion:2,execution,provenance,planJobId:plan.id};
await writeFile(new URL('./backend-result.json',import.meta.url),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({jobId,testCaseId,agentVersionAtExecution:1,currentAgentVersion:2,events:execution.events.length,model:execution.config.model,planJobId:plan.id}));
