import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const file=new URL('./live-result.json',import.meta.url);const result=JSON.parse(await readFile(file,'utf8'));
const base='http://127.0.0.1:3812';const {token}=await(await fetch(base+'/api/auth/guest',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
async function api(path,body,method=body?'POST':'GET',status){const r=await fetch(base+path,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(status)assert.equal(r.status,status,JSON.stringify(d));else assert(r.ok,JSON.stringify(d));return d;}
async function save(){await writeFile(file,JSON.stringify(result,null,2));}
const draft=result.execution.outputs[0];const definition=draft.originalDefinition;
// Reviewed public GET-only request and exact assertions before accepting/publishing this isolated QA record.
assert.equal(definition.request.method,'GET');assert.equal(definition.sideEffect,'read-only');assert.equal(definition.request.url,'${env.baseUrl}/repos/${env.owner}/${env.repo}');
const environment=await api('/api/environment-versions/envv_2e8751d6');assert.equal(environment.baseUrl,'https://api.github.com');assert.deepEqual(environment.variables,{repo:'node',owner:'nodejs'});
result.accepted=await api(`/api/drafts/${draft.id}/accept`,{modifications:{...definition,name:'真实链路验收 · GitHub nodejs/node · '+result.job.id}});
result.checks.push('审核接口接受草稿并保存修改');await save();
await api(`/api/test-case-versions/${result.accepted.versionId}/run`,{environmentVersionId:environment.id},'POST',404);result.checks.push('未发布版本不能运行');
result.published=await api(`/api/test-case-versions/${result.accepted.versionId}/publish`,{});
result.run=await api(`/api/test-case-versions/${result.accepted.versionId}/run`,{environmentVersionId:environment.id});await save();console.log('run created',result.run.runId);
for(let i=0;i<45;i++){result.report=await api(`/api/runs/${result.run.runId}/report`);if(['passed','failed','error','cancelled'].includes(result.report.run.status))break;await new Promise(r=>setTimeout(r,2000));}
result.provenance=await api(`/api/test-cases/${result.accepted.testCaseId}/provenance`);result.execution=await api(`/api/generation-jobs/${result.job.id}/execution`);
assert.equal(result.provenance.sources[0].jobId,result.job.id);assert.equal(result.execution.agent.version,1);assert.equal(result.execution.outputs[0].originalDefinition.name,definition.name);
await save();assert.equal(result.report.run.status,'passed');result.checks.push('独立 Runner 对真实 GitHub API 执行通过','用例详情来源绑定准确','修改名称后仍保留原始模型输出');
const {agents}=await api('/api/agents');const planAgent=agents.find(a=>a.enabled&&a.capability==='plan');
const {job}=await api('/api/plan-suggestions',{agentId:planAgent.id,objective:`验收：严格只选用例 ${result.accepted.testCaseId}，生成单成员最小只读回归计划。该用例已发布并通过 GitHub 真实数据执行。不要添加其他成员或待补齐项。仅生成草稿。`});
result.planJobId=job.id;await save();
for(let i=0;i<65;i++){const {jobs}=await api('/api/plan-suggestions');result.plan=jobs.find(j=>j.id===job.id);if(['completed','failed','cancelled'].includes(result.plan.status))break;await new Promise(r=>setTimeout(r,2000));}
await save();assert.equal(result.plan.status,'completed');assert.equal(result.plan.agent.id,planAgent.id);assert.deepEqual(result.plan.proposal.members.map(m=>m.key),[result.accepted.testCaseId]);result.checks.push('真实计划 Agent 生成单成员建议并保留配置来源');await save();
console.log(JSON.stringify({jobId:result.job.id,testCaseId:result.accepted.testCaseId,runId:result.run.runId,status:result.report.run.status,planId:job.id,checks:result.checks},null,2));
