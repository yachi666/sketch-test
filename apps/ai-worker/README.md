# Pi generation Worker

独立 Node.js 进程，使用 `pi-agent-core` / `pi-ai` 1.1.0。Control Plane 持久任务经专用凭证与租约派发，Worker 为每次领取启动受监督的 Pi 子进程，提交待审草稿；Web 完成人工审阅和明确发布。

## 运行

需要 Node.js ≥22.19.0、PostgreSQL、已有工作区和已导入 API。先构建：

```bash
pnpm --filter @sketch-test/ai-worker... build
pnpm --filter @sketch-test/control-plane... build
```

在 CP 的环境配置中同时设置 `AI_WORKER_WORKSPACE_ID`（现有工作区 ID）和随机 `AI_WORKER_TOKEN`（至少 32 字符）。Worker 单独配置：

| 变量 | 含义 |
|---|---|
| CP_URL | CP 地址；远程部署用 HTTPS，本机和 Compose 内网允许 HTTP |
| AI_WORKER_TOKEN | 与 CP 相同的专用 Worker 凭证，不能使用浏览器 JWT 或 Runner token |
| AI_PROVIDER | `deepseek`、`openai` 或 `anthropic`，必须显式设置 |
| AI_MODEL | 对应 Pi provider 目录的准确模型 ID |
| AI_API_KEY | 模型密钥，仅存在 Worker 环境 |
| AI_WORKER_ID | 可选；默认每进程生成唯一 ID |

```bash
# 已通过进程环境或受保护的 env 文件提供配置
pnpm --filter @sketch-test/ai-worker serve
# 开发模式
pnpm --filter @sketch-test/ai-worker dev:worker
```

Compose 已提供 `ai` profile；使用项目原有生产配置和上表配置后运行 `docker compose --profile ai up -d --build`。AI Worker 不暴露入站端口。Docker 构建上下文排除本地运行配置。模型 key 不应提交到仓库或提供给 Web/CP。

本轮实测 `deepseek / deepseek-v4-flash`。官方在 2026-09-10 将该兼容标识路由至 V4.1 Flash，详见 [ADR](../../docs/adr/0002-pi-generation-harness.md)。

## 产品使用

1. 导入 API，进入「智能生成」，选择固定版本和最多 5 个接口，填写测试目标。
2. 在线 Worker 领取任务。页面展示真实等待、生成、失败、取消状态，可取消或重试。
3. 「审阅草稿」展示完整请求、断言、风险、来源 hash 和生成依据。接受只创建未发布版本。
4. 发布用例，选择已保存的环境版本运行。缺失变量、跨工作区环境和未发布版本会在执行前拒绝。
5. 报告中心查看独立 Runner 的断言结论和脱敏事件。模型文本不充当执行结论。

## 约束与恢复

- 两个工具：`read_endpoint` 和 `propose_test`；没有文件、shell、Secret、任意 HTTP、发布或执行工具。
- 输入只含经过裁剪的 API 结构和用户目标。目标/字段名称仍需使用者避免填写敏感数据，不提供通用 DLP。
- 模型、API 版本与输入 hash 固定到任务。路径参数转为显式环境变量，例如 `/users/{id}` 使用 `${env.id}`，运行前必须配置。
- 30 秒租约、8 秒续租；过期 Worker 不能提交。进程恢复后从冻结输入重做任务，最多自动领取 3 次。
- 工作区最多 10 个活动任务；默认每任务 6 轮、5 草稿、4096 输出 token/轮、120 秒，监督进程额外宽限 3 秒后强制结束。
- 完成提交幂等，数据库原子写入草稿与完成状态。取消会使续租失败；显式重试重新开放领取预算。
- 错误只持久化 `MODEL_FAILED` / `TIMEOUT` / `INVALID_RESULT` / `LEASE_EXHAUSTED`，不写入原始 provider 错误或推理正文。
- 这是 API 用例生成闭环。业务流程仍由现有编辑器编排；不包含全局美元配额或多工作区 Worker 凭证管理。

## 验证

```bash
pnpm --filter @sketch-test/ai-worker test
# 使用现有 PostgreSQL 连接，脚本创建并删除独立测试 schema，不修改产品表
AI_E2E_DATABASE_URL=postgresql://localhost:5432/sketchtest_preview \
  pnpm --filter @sketch-test/control-plane exec tsx scripts/ai-generation-e2e.ts
```

单元测试用真实 Pi 循环与确定性模型流，不消耗模型额度。真实模型与浏览器联合结果见 [验收记录](../../docs/design/2026-09-12-pi-integration.md)。单任务 CLI 仍可用 `node apps/ai-worker/dist/main.js < task.json`；示例 sourceHash 为合成数据，真实产品任务必须通过 CP 创建。
