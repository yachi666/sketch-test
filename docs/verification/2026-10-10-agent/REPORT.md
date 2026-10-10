> 后续更新：Agent 后端与正式 Web 已实现并通过真实模型验收，见 [BACKEND.md](BACKEND.md)。以下保留的是接入前的验证记录。

# Agent 新功能 · 真实数据验收

时间：2026-10-10。结论：**部分底层链路通过；当前新界面不满足完整功能验收。**

## 环境与范围

- 新设计原型：`http://127.0.0.1:4318/`，独立内存演示，未接 Control Plane。
- 真实 Web：`http://localhost:8180/`，Control Plane：`http://127.0.0.1:3812/`。
- 工作区：`ws_02eaec7b`。使用现有 QA 登录和现有在线 Worker；未更改认证或厂商凭据。
- PostgreSQL、对象存储 readiness 正常。当前可用厂商/模型：`deepseek / deepseek-v4-flash`。这是服务记录的模型标识，不是厂商返回的底层不可变模型快照。
- 运行环境报告 harness `0.85.1`，仓库 README 描述 `1.1.0`；以下结果以实际 API/浏览器为准。
- 新增 1 次真实模型生成、1 个生成草稿并接受成 1 个未发布用例。未发布、未触发 Runner、未修改已有用例。

## 实测结果

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| 真实模型调用 | 通过 | `gj_811dc055`，一次领取完成，耗时 4728 ms |
| 生成内容 | 通过 | 1 条 GET GitHub 公开仓库元数据草稿，断言 HTTP 200、`full_name = nodejs/node` |
| 人工审核转用例 | 通过 | `draft_f511ff49` → `tc_36b8015d` v1；仍为草稿，未发布 |
| 数据持久化 | 通过 | 刷新页面、重新请求 API 后任务、草稿及用例仍存在 |
| 基础来源关联 | 通过 | jobId、API 版本、sourceHash、inputHash、provider、model、promptVersion、harnessVersion 保留；sourceHash 与源 API 一致 |
| 新 Agent 管理页持久化 | 未实现 | 4318 使用 Zustand 内存、定时器模拟；真实服务无 Agent 管理/厂商连接接口 |
| 多 Agent、GPT/GLM 显式选择 | 未实现/未验证 | 真实创建请求没有 agentId 或模型选择参数；服务选择在线 Worker。当前仅发现 DeepSeek Worker，未声称已验证 GPT/GLM |
| Agent 身份与配置版本追溯 | 未实现 | 实际记录无 agentId、agentVersion、Agent 配置快照；Worker ID 不等于业务 Agent ID |
| 用例详情 → Agent 执行详情 | 未实现 | 真实用例详情缺少原型中的生成来源卡及执行详情入口；审阅页仅展示模型、来源 API 和哈希等基础信息 |
| 分阶段执行、Token、工具调用明细 | 未实现 | 对外 job API 没有原型时间线、token 或模型调用事件；不能用模拟数据代替 |
| 原始生成内容跨人工改动保留 | 尚不满足原型保证 | 本次无修改接受验证通过；源代码 acceptDraft 会把修改后的 definition 写回 generated_drafts，不能据此宣称原始产出不可变 |
| Open-Meteo 官方完整契约生成 | 失败 | 前端可选择，但提交后输入校验拒绝；23 个参数的投影长 6300 字符，超过契约 4096 上限 |

GitHub 使用的是工作区已持久化、人工整理的公开 API 验收契约 `av_fa206a0a`，不是 GitHub 官方完整 OpenAPI；模型调用和数据库记录是真实的。本轮没有请求 GitHub 被测接口，因此生成成功不等于用例执行通过。

## 本次真实调用标识

- Job：`gj_811dc055`
- GeneratedDraft：`draft_f511ff49`
- TestCase：`tc_36b8015d`
- Source ApiVersion：`av_fa206a0a`
- Provider / model：`deepseek / deepseek-v4-flash`
- Source hash：`e6f0db1e7d89d7a5bef33bc5c4ac54ab0ff20f137f0c4c6bacd047d35cee930b`
- 开始：`2026-10-10T07:58:53.981Z`
- 完成：`2026-10-10T07:58:58.709Z`

## 附加发现

未发布版本的 `publishedAt` 已有默认时间戳，实际发布状态由 `publishedBy` 判断。本轮最初用 publishedAt 断言未发布而失败；核对 Web、服务实现及 publishedBy=null 后确认仍为草稿。新界面接入时不能仅凭 publishedAt 判断已发布。

## 证据与复查

- `preflight.json`：真实服务健康、能力、API 版本和缺失管理接口返回值；不包含凭据。
- `real-generation.json`：审核前生成任务与完整草稿。
- `accepted-case.json`：审核后任务、草稿、用例版本。
- `checks.json`：来源一致、审核未发布、模型匹配等断言结果。
- `official-contract-diagnostic.json`：输入投影长度诊断。
- `official-contract-rejected.jpg`、`real-generation.jpg`、`real-draft-review.jpg`、`real-case-persisted.jpg`：浏览器证据。
- `verify.mjs`：只读复查已创建任务及来源关联；通过现有 QA 会话接口获取临时凭据，仅驻留内存。
- `diagnose-input.mjs`：用已读取数据复现 CP 投影字符数。

复查命令：

```sh
node docs/verification/2026-10-10-agent/verify.mjs
node docs/verification/2026-10-10-agent/diagnose-input.mjs
```

完整验收的前置工作是实现 Agent/厂商连接持久化和版本化契约，任务显式绑定 Agent 配置版本，保存执行事件及原始产出，并把新界面接入这些真实 API。不能仅替换原型中的示例名称和数据后宣称功能可用。
