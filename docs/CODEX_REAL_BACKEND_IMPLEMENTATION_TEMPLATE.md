# Codex 模板：将 SketchTest 的所有产品页面接入真实后端

> 用途：把此模板作为 Codex 任务的起始指令。它适用于逐步消除 Web
> 产品路径中的静态数据、浏览器本地产品状态、假成功提示和 Fixture 专用执行。
> 一次任务只完成一个可验证的纵向切片，不把整份模板当作一次性重写要求。

## 给 Codex 的任务指令

你正在把 SketchTest 的一个 Web 产品面接入真实的后端闭环。先阅读根目录
`CLAUDE.md`、目标包的 `CLAUDE.md`、`CONTEXT.md`、
`docs/CODEX_PRODUCT_GOAL.md`，以及本模板。不要假定已有页面的数据或状态为真实。

### 目标

将选定功能实现为以下闭环：

```text
Web UI
  -> Control Plane HTTP API（JWT、RBAC、workspace 隔离）
  -> PostgreSQL 元数据 / S3 证据对象
  -> 独立 Runner 或 AI Worker（如适用）
  -> Control Plane 查询 API
  -> Web 刷新后的真实展示
```

### 不可违反的规则

1. 已发布的 `ApiVersion`、`TestCaseVersion`、`WorkflowVersion`、
   `EnvironmentVersion` 与 `DatasetVersion` 不可变。
2. Control Plane、Runner 和 AI Worker 必须是独立进程；只能通过版本化契约通信。
3. 生产 UI 不得依赖 `src/data.ts`、localStorage 产品记录、浏览器 mock、固定数字、
   固定成功提示或 `http://localhost:3800` Fixture 目标。
4. localStorage 仅可保存 UI 偏好、登录会话或可丢弃的编辑草稿；不得作为可共享、
   可审计或可执行的产品事实来源。
5. 不支持的能力必须禁用并说明原因，或返回可追溯诊断；不得伪造“已导入”、
   “已分析”或“已执行”成功状态。
6. 不要为绕过现有契约而进行跨包实现导入。新增/修改契约时，先枚举所有消费者、
   更新 Golden tests，并明确版本兼容策略。
7. 密钥不能进入浏览器可读状态、RunEvent、日志、报告正文或对象存储预览。

### 每个纵向切片的工作流

1. **定位事实来源**：列出 UI 现在使用的静态数据、Zustand state、localStorage、
   API 调用与缺失的后端能力。
2. **定义领域命令与查询**：先确定资源所有者、workspace 边界、版本/草稿语义、
   幂等键、错误码和审计事件；再决定 HTTP 路由。
3. **实现后端**：按模块增加 Zod 验证、授权、service、repository/migration、
   路由和测试。跨进程动作创建持久化 Job 或 Run，不在 HTTP 请求中伪执行。
4. **实现前端**：所有产品数据都从 `cp-client`/resource hook 获取；处理 loading、
   empty、forbidden、failure、刷新和并发修改。删除相应 mock fallback，而非保留它。
5. **端到端验证**：至少证明“创建/触发 → 刷新页面 → 数据仍存在且与其他用户/工作区隔离”。
   涉及 Runner/AI 时，证明独立进程确实完成任务并产出可查询证据。
6. **反向审查**：搜索 `src/data.ts`、`initial*`、`mock`、`demo`、`fixture`、
   `localStorage`、固定 URL 与仅 toast 的成功路径，确保目标功能不再依赖它们。
7. **交付记录**：报告修改的契约、迁移、路由、页面和测试；只声称已由实际命令或浏览器
   运行证明的能力。

## 产品面 → 真实后端设计

| 产品面 | 真实数据与命令 | 后端责任与建议 API | Web 完成标准 |
| --- | --- | --- | --- |
| Dashboard | 覆盖率、最近 Run、失败 StepRun、工作流健康度 | 新增只读 `GET /api/dashboard?range=7d`；在 service 内按当前 workspace 聚合 `runs`、`run_events`、测试/工作流版本，不把统计写死在页面 | 页面不再导入 `workflows` 或固定指标；筛选/刷新后显示当前 workspace 的聚合结果 |
| 报告中心 | Run 列表、报告、StepRun、脱敏请求/响应、证据清单 | 复用/扩展 `GET /api/runs`、`GET /api/runs/:id`、`GET /api/runs/:id/report` 和 evidence 查询；只从 Evidence Ledger 返回脱敏后的预览 | 列表和详情由 `runId` 查询；深链接刷新可用；不存在及跨 workspace 访问返回不泄露存在性的 404，当前 workspace 的角色拒绝返回 403 |
| 用例管理队列 | API Diff、失败 Run、GeneratedDraft、修复草稿任务 | 新增持久化的 `case_work_items`（或由证据/变更可确定地投影）；`GET /api/case-work-items`、`POST /api/case-work-items/:id/create-repair-draft` | 队列不再是 `caseTasks`；接受/拒绝/修复后刷新可见，操作可审计 |
| 导入中心 | URL、上传文件、粘贴文本、预检、诊断、冲突与导入结果 | 引入 `import_jobs`、对象存储源文件与诊断；支持 `POST /api/imports/url`、`/file`、`/text`，`GET /api/imports/:id`，确认后发布不可变 ApiVersion | 上传/粘贴不只加入浏览器队列；刷新仍能看到 Job、诊断与最终版本；不能实现的格式显示真实诊断 |
| API 资产管理 | ApiVersion、CanonicalApiModel、端点、Schema、Diff、手工定义草稿 | 只读浏览使用 API version/endpoints/openapi/diff 查询；手工编辑必须生成新的草稿/来源，再经校验发布为新 ApiVersion，绝不原地改发布版本 | 移除 `data.ts` 初始端点、浏览器 import worker 和内存 CRUD；新建/编辑后重载仍一致且可追溯来源 |
| 业务流程编辑器 | Workflow 草稿、WorkflowVersion、编译诊断、发布、执行 | 使用现有 workflows/version/publish/compile/run-from-workflow API；补足草稿保存的乐观锁与 workflow version 查询 | 列表来自 CP；“新建流程”可用；保存后跨会话存在；运行必须引用已发布版本的 ExecutionPlan，不能拼 Fixture URL |
| 环境与变量 | Environment、EnvironmentVersion、普通变量、Secret 引用、覆盖规则 | Environment CRUD 后创建不可变 version；普通变量放入 EnvironmentVersion 或独立的版本化变量模型；Secret 仅以 `secretId`/引用进出 API | 环境/变量 CRUD 不写 localStorage；环境切换改变真实 version；浏览器永不接收 Secret 值 |
| 请求发送与变量取值测试 | Ad-hoc Run、StepRun、提取结果 | `POST /api/runs` 创建带来源的 ad-hoc Run，Runner 执行；结果经现有 run 查询返回 | 保留真实轮询，但输入来自选定环境版本与实际端点；不再用 demo 端点或固定 host 变量 |
| 测试计划、质量门禁与调度 | TestSuite、TestSuiteVersion、Schedule、QualityGateResult | 使用现有 suites/schedules APIs；每次调度冻结成员版本、环境版本与 ExecutionPlan，并写入 audit/event | 创建、版本化、启停、立即执行与运行详情均经刷新验证，不以 mock 拦截作为产品证据 |
| AI 仓库分析 | RepositoryAnalysisJob、只读 Git Snapshot、Finding、GeneratedDraft | 新建独立 `apps/ai-worker`；CP 提供 `POST /api/repository-analyses`、job/findings 查询和从 finding 创建 draft 的命令。凭证仅由服务端 secret reference 使用 | “开始分析”创建真实 Job；轮询展示真实状态；finding 含 commit、文件行号、证据与置信度；生成草稿实际进入审核流程 |

## 统一实现约束

### 数据与授权

- 每一张 workspace 资源表都必须拥有或可原子验证 `workspace_id`。
- 在路由前验证 JWT，在 service/repository 层再次按资源 workspace 验证；跨工作区统一表现为
  不泄露资源存在性的 404。
- 所有写命令接受验证后的结构化输入；对用户重复提交的创建/触发操作使用幂等键。
- 草稿更新使用 revision/ETag 乐观锁。发布操作只能从有效草稿产生新版本，且写入审计记录。

### 长任务与实时性

- 导入、AI 分析、长时间编译和执行都创建持久化 Job/Run；HTTP 只返回 ID 与初始状态。
- Web 可轮询查询 API；不要通过 `setTimeout` 直接伪造状态流转。
- Runner 只领取已经编译且 hash 有效的 `ExecutionPlan`；AI Worker 只读取经策略过滤的 Git 快照。
- 每个终态必须是可查询的 `succeeded`、`failed`、`cancelled` 或 `inconclusive`，并带诊断/证据引用。

### 推荐的前端资源模式

```ts
// 每个页面使用同一模式；不在失败时退回 demo 数据。
const resource = useResource(() => cpClient.listRuns(filters), [filters]);

if (resource.loading) return <LoadingState />;
if (resource.error) return <ErrorState error={resource.error} onRetry={resource.refetch} />;
if (resource.data.items.length === 0) return <EmptyState />;
return <RunTable runs={resource.data.items} />;
```

Mutation 成功后必须重新获取权威资源或接收明确的服务端返回值；不得仅修改浏览器副本来制造成功。

## 验收清单（每个切片必须逐项回答）

- [ ] UI 不再读取该功能的 `src/data.ts`、`initial*`、mock 或 localStorage 产品记录。
- [ ] 写操作经过 JWT、RBAC、workspace 所有权和请求 schema 校验。
- [ ] 数据写入 PostgreSQL；大对象/原文/证据按需要进入 S3 兼容对象存储。
- [ ] 发布资源保持不可变；草稿与已发布版本的语义清晰。
- [ ] 刷新浏览器、重新登录和不同进程实例后结果仍可查询。
- [ ] 无权限、不存在、冲突、验证失败、后台任务失败与空数据均有真实且可理解的 UI 状态。
- [ ] 新增/变更的 Control Plane 单元与路由测试通过；契约变更已更新 Golden tests。
- [ ] 涉及 Web 的能力经过浏览器实测；涉及 Runner/Worker 的能力经过独立进程 E2E 证明。
- [ ] 已运行与本切片相称的 `lint`、`check`、`test`、`build`，并记录命令和结果。

## 任务输入与交付格式

开始执行前，将以下占位符替换为本次切片：

```text
目标产品面：<例如：报告中心>
用户可见结果：<例如：用户刷新 /reports 后看到当前 workspace 的真实 Run>
权威后端资源：<例如：runs、run_events、evidence manifest>
允许新增的 API/迁移/契约：<明确列出>
不在本次范围：<明确列出>
验收命令：<明确列出>
```

最终交付必须按此格式说明：

```text
结果：<已完成的用户能力>
真实链路：<UI → API → 持久化/Runner/Worker → UI>
变更：<关键文件和路由>
验证：<实际运行的命令、浏览器/E2E 证据>
未做：<明确保留的下一切片，不把它描述成已完成>
```

## 建议执行顺序

1. 报告中心（已有 Run/Evidence 查询能力，最容易消除最明显的假数据）。
2. 业务流程读取、草稿保存、发布与从版本运行（移除固定 Fixture 计划）。
3. 环境/变量与 Secret 引用（让执行输入可持久化且安全）。
4. API 资产浏览、手工定义草稿与完整导入 Job。
5. Dashboard 聚合与用例工作队列（建立在真实 Run/API Diff/Draft 数据之上）。
6. 独立 AI Worker 与仓库分析（最后接入，因为它需要 Git 凭证、队列和证据治理）。

每完成一步，都应从导航和代码中移除对应 mock 路径；若该功能尚未真实可用，宁可暂时隐藏入口，
也不要以演示数据对外宣称产品已完成。
