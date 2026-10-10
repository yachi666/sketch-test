import {api,save,workspaceId,jobFinish,assert,finish} from './live-client.mjs';
const e={checks:[],assets:{}};async function check(name,fn){try{e.checks.push({name,status:'passed',value:await fn()});console.log('PASS',name)}catch(x){e.checks.push({name,status:'failed',error:x.message});console.log('FAIL',name,x.message)}save('github-full-flow.json',e)}
await check('real GitHub minimal OpenAPI 3.2 import',async()=>{const x=await api('/api/import',{sourceType:'url',sourceLocation:'http://sketchtest-verification-sources/github-public-acceptance.json'});e.assets.apiVersionId=x.apiVersionId;return x});
await check('Arazzo 1.1 import, publish, independent Runner real GitHub flow',async()=>{const source=`arazzo: 1.1.0
info:
  title: GitHub real metadata and commits
  version: 1.0.0
sourceDescriptions:
  - name: github
    url: http://sketchtest-verification-sources/github-public-acceptance.json
    type: openapi
workflows:
  - workflowId: githubRegression
    summary: GitHub 真实元数据和提交历史回归
    steps:
      - stepId: metadata
        operationId: $sourceDescriptions.github.getRepository
        parameters:
          - name: owner
            in: path
            value: nodejs
          - name: repo
            in: path
            value: node
        successCriteria:
          - condition: $statusCode == 200
      - stepId: commits
        operationId: $sourceDescriptions.github.listCommits
        parameters:
          - name: owner
            in: path
            value: nodejs
          - name: repo
            in: path
            value: node
          - name: per_page
            in: query
            value: 30
        successCriteria:
          - condition: $statusCode == 200
`;save('github-real.arazzo.yml',source);const x=await api('/api/workflows/import/arazzo',{sourceText:source,sourceLocation:'http://sketchtest-verification-sources/github-real.arazzo.yml',sources:{github:e.assets.apiVersionId}});e.assets.arazzo=x;const v=x.workflows[0].workflowVersionId;await api(`/api/workflow-versions/${v}/publish`,{});const r=await api('/api/runs/from-workflow',{workflowVersionId:v});e.assets.arazzoRun=r;const report=await finish(r.runId);assert.equal(report.run.status,'passed');const manifest=await api(`/api/runs/${r.runId}/evidence-manifest`);save('arazzo-evidence-manifest.json',manifest);return {x,run:r,externalizedEvents:manifest.events.filter(x=>x.objectKey).length}});
await check('real AI generation of executable GitHub test draft',async()=>{const x=await api('/api/api-versions/'+e.assets.apiVersionId);save('github-canonical.json',x);const model=x.spec??x.specJson??x.model??x;const endpoints=model.endpoints??x.apiVersion?.spec?.endpoints;const job=await api('/api/generation-jobs',{workspaceId,apiVersionId:e.assets.apiVersionId,strategy:'pi',...(endpoints?{endpointIds:[endpoints.find(x=>x.operationId==='getRepository').id]}:{}),objective:'生成一条读取公开 Node.js 仓库元数据的只读正向用例。只使用 GET /repos/{owner}/{repo}，owner=nodejs，repo=node；基地址 ${env.baseUrl}。断言状态 200、full_name 等于 nodejs/node。不要生成提交历史列表用例。'});e.assets.aiJobId=job.id;const done=await jobFinish(job.id);assert.equal(done.status,'completed');const ds=await api(`/api/generation-jobs/${job.id}/drafts`);const full=await api(`/api/drafts/${ds.drafts[0].id}`);save('github-ai-draft-review.json',full);e.assets.aiDraftId=full.id;return {job:done,draft:full}});
