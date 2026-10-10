import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base=process.env.CP_URL??'http://127.0.0.1:3812';
const login=await(await fetch(base+'/api/auth/guest',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
assert(login.token);
const evidence={at:new Date().toISOString(),checks:[]};
async function api(path,body,method=body?'POST':'GET',status){
 const r=await fetch(base+path,{method,headers:{authorization:`Bearer ${login.token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const d=await r.json();if(status)assert.equal(r.status,status,JSON.stringify(d));else assert(r.ok,`${r.status} ${JSON.stringify(d)}`);return d;
}
async function save(){await writeFile(new URL('./live-result.json',import.meta.url),JSON.stringify(evidence,null,2));}
const original=await api('/api/generation-jobs/gj_d1987170/execution');
const {agents}=await api('/api/agents');const reference=agents.find(a=>a.id===original.agent.id);assert(reference);
const {schemaVersion,id,version,provider,connectionRef,connectionName,...config}=reference;
const name='真实数据验收 Agent · '+new Date().toISOString().slice(11,19);
const agent=(await api('/api/agents',{...config,name},'POST',201)).agent;evidence.agent=agent;
const connection=await api(`/api/provider-connections/${agent.connectionId}/check`,{});assert(connection.available);evidence.checks.push('在线连接检查');
const spec=await api('/api/api-versions/av_fa206a0a');
evidence.source={apiVersionId:'av_fa206a0a',contentHash:spec.contentHash};
const task={workspaceId:login.user.workspaceId,apiVersionId:'av_fa206a0a',strategy:'pi',endpointIds:original.config.endpointIds,agentId:agent.id,objective:'真实功能验收：只生成 1 条公开 Node.js GitHub 仓库元数据只读用例，严格使用 requestTemplate，断言 HTTP 200 以及 $.full_name 等于 nodejs/node。owner 和 repo 由环境变量提供。'};
evidence.job=await api('/api/generation-jobs',task,'POST',201);await save();console.log('created',evidence.job.id);
await api(`/api/agents/${agent.id}`,{expectedVersion:1,config:{...config,name,enabled:false}},'PUT');
await api('/api/generation-jobs',task,'POST',409);evidence.checks.push('停用 Agent 拒绝新任务');
await api(`/api/agents/${agent.id}`,{expectedVersion:1,config:{...config,name}},'PUT',409);evidence.checks.push('过期版本编辑拒绝');
await api(`/api/agents/${agent.id}`,{expectedVersion:2,config:{...config,name,model:'verification-unavailable-model'}},'PUT');
await api('/api/generation-jobs',task,'POST',503);evidence.checks.push('离线模型拒绝生成，不自动替换模型');
await api(`/api/agents/${agent.id}`,{expectedVersion:3,config:{...config,name,enabled:false}},'PUT');
for(let n=0;n<65;n++){
 evidence.execution=await api(`/api/generation-jobs/${evidence.job.id}/execution`);
 if(['completed','failed','cancelled'].includes(evidence.execution.status))break;
 await new Promise(r=>setTimeout(r,2000));
}
await save();assert.equal(evidence.execution.status,'completed');assert.equal(evidence.execution.agent.version,1);assert.equal(evidence.execution.outputs.length,1);
evidence.checks.push('真实 DeepSeek 生成完成','排队任务配置不受后续修改与停用影响');
const definition=evidence.execution.outputs[0].originalDefinition;
assert.equal(definition.sideEffect,'read-only');assert.equal(definition.request.method,'GET');assert.equal(definition.request.url,'${env.baseUrl}/repos/${env.owner}/${env.repo}');
assert(definition.assertions.some(a=>a.target==='status'&&a.operator==='equals'&&a.expected===200));
assert(definition.assertions.some(a=>a.target==='jsonPath'&&a.path==='$.full_name'&&a.operator==='equals'&&a.expected==='nodejs/node'));
assert(evidence.execution.events.some(e=>e.type==='model.completed'));assert(evidence.execution.events.some(e=>e.type==='tool.completed'));
evidence.history=await api(`/api/agents/${agent.id}/versions`);assert.deepEqual(evidence.history.versions.map(v=>v.config.version),[4,3,2,1]);
await save();console.log(JSON.stringify({jobId:evidence.job.id,status:evidence.execution.status,definition,checks:evidence.checks},null,2));
