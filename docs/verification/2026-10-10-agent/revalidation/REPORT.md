# 真实数据复验 — 2026-10-10 16:32–16:35（上海）

本次重新创建任务并真实调用模型和 GitHub API，使用实际 Docker Control Plane、PostgreSQL、AI Worker、Runner 与正式 Web。没有使用模型替身或固定响应。

## 结果

12 项功能检查通过；另发现 1 项模型说明质量问题。此轮未改动产品代码。

| 链路 | 真实证据 |
|---|---|
| Agent 配置 | 新建独立验收 Agent，v1→v4；检查完成后保持停用，原有三个 Agent 不变 |
| 用例生成 | `gj_662e4841`，DeepSeek `deepseek-flash`，完成，1 条草稿，7 条执行事件 |
| 配置冻结 | 任务执行使用 v1；后续修改模型、停用均不回写任务 |
| 接受与发布 | 新建验收用例 `tc_44b2a8b3` / `tcv_97fb78f6`，核对只读请求与断言后发布 |
| 实际 HTTP | `GET https://api.github.com/repos/nodejs/node`，独立 Runner 执行 |
| 执行结果 | `run_3e91608b`，passed，745 ms，2/2 断言通过，零重试 |
| 断言 | HTTP 状态实际 200；`$.full_name` 实际 `nodejs/node` |
| 计划生成 | `ap_2c512f42017d4bb8`，测试计划 Agent v1；仅包含新验收用例，保持建议草稿 |
| 溯源 | 用例详情 → 执行记录；模型/Agent 版本、Worker、工具/模型耗时与 token、原始输出可见 |
| 原始产出 | 审核接口修改用例名称后，原始模型输出及来源哈希保持不变 |

异常路径也已实测：停用 Agent 生成返回 409、过期版本编辑返回 409、无在线 Worker 的模型返回 503 且不自动替换、未发布用例执行返回 404。专用 PostgreSQL schema 的 `agents-e2e.ts` 再次通过，包括工作区隔离和多厂商路由；这些边界测试使用确定性 Worker 消息，与本次真实模型/HTTP 验证分别计证。

## 发现与边界

- **模型说明有一处错误**：rationale 将运行前提写成 `env.repo=nodejs`，正确值为 `node`。实际冻结环境与执行请求正确，因此两项断言通过。生成说明仍需审核，不能当作执行结论；保留原文便于追溯。
- OpenAI、GLM 没有可用的真实凭据，未对其进行真实网络调用。不能将本轮 DeepSeek 结果外推为所有厂商均已实测通过。
- 本轮仅发布和运行了专门创建的只读验收用例；未修改既有已发布版本，未发布或执行新计划建议。
- 连接检测是在线心跳检测；本轮额外通过真实生成确认了现有 DeepSeek 凭据有效。

## 可复查入口

- [执行报告](http://localhost:8180/reports/run_3e91608b)
- [用例及来源](http://localhost:8180/cases?generationJobId=gj_662e4841)
- [Agent 管理](http://localhost:8180/settings/agents)
- `live-result.json`：原始任务、配置历史、模型事件、产出、Runner 报告和计划建议。
- `agent-history.jpg`、`case-trace.jpg`、`run-report.jpg`：实际页面截图。

脚本 `verify-live.mjs` 创建独立验收 Agent 和真实模型任务；`verify-execution.mjs` 在核对只读请求后接受、发布、执行验收用例并生成计划建议。重新运行会新增验收数据及真实模型调用。
