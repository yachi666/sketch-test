# SketchTest

SketchTest 是一个基于 TypeScript monorepo 的 REST API 自动化测试平台。
它将 API 描述导入为 `CanonicalApiModel`，创建不可变的测试与流程版本，
编译成 `ExecutionPlan`，交给独立 Runner 执行，并保存有序、脱敏的
`RunEvent` 证据。

[English](./README.md)

## 当前已实现能力

- OpenAPI、Postman、HAR、RAML Adapter 和格式检测。
- Canonical API、测试 DSL、流程 DSL、Runner Protocol 与公共类型的
  版本化 Zod 契约。
- Fastify Control Plane：身份、导入、环境和 Secret、测试编写、流程、
  生成草稿、套件、策略、调度、Runner 租约、事件和报告。
- 独立 Node.js Runner：重试、轮询、变量提取、断言、脱敏和有序事件。
- React Web 提供经过认证、由 Control Plane 驱动的 API 导入、流程发布执行和
  运行报告主路径。
- CLI：触发已发布流程版本、等待运行、读取报告、输出 CI 格式并返回状态退出码。
- 用于集成测试及故障注入的确定性测试基础设施。

以上只表示仓库中存在相应代码，不代表已经达到生产发布标准。实际验证状态和
缺口见 [`docs/STATUS.md`](docs/STATUS.md)。

## 架构

```text
Web / CLI
    │ 版本化 HTTP API
    ▼
Control Plane ─── PostgreSQL
    │ Runner Protocol
    ▼
独立 Runner ─── 被测系统
```

`packages/contracts` 下的五个契约包是唯一稳定边界。Control Plane、Runner
以及未来 Worker 必须保持独立进程。已经发布的 `ApiVersion`、
`TestCaseVersion`、`WorkflowVersion`、`EnvironmentVersion` 和
`DatasetVersion` 不可修改。

每个 `ExecutionPlan` 只能记录一种来源：

- 已发布的 `WorkflowVersion`；
- 已发布的 `TestCaseVersion`；
- 或拥有不可变临时计划的 Run。

计划对实际执行步骤和 Teardown 计算确定性的 SHA-256。Secret 在 Runner
执行时解析，并在上传事件前脱敏。

## 环境要求

- Node.js 22 或 24
- pnpm 11.8+
- Control Plane 运行和集成测试所需的 PostgreSQL

## 安装与验证

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm lint
pnpm build
```

四个根级质量命令当前均已通过。Control Plane 和 Runner 构建会在 `dist/`
生成生产 JavaScript，其 `start` 命令执行构建产物，而不是 TypeScript 源码。

本机具备 Docker 和 PostgreSQL 时，可以运行 production-mode 跨进程验收：

```bash
pnpm e2e:product
```

该命令创建隔离的 PostgreSQL 与 MinIO，启动构建后的 Control Plane、Runner、
Web 和仅用于测试的服务器，验证登录、导入、发布、租约、执行、CLI、报告和
浏览器全链路；随后把数据库和全部对象证据恢复到一次性目标，并在 `finally`
中删除临时资源。

## 本地开发

```bash
pnpm dev:web       # React，127.0.0.1:5173
pnpm dev:cp        # Control Plane，0.0.0.0:3802，需要 PostgreSQL
pnpm dev:runner    # Runner 开发进程
pnpm dev:fixture   # 测试服务器，127.0.0.1:3800
```

开发环境配置示例：

```bash
export DATABASE_URL='postgresql://localhost:5432/sketchtest'
export JWT_SECRET='replace-with-a-long-random-development-secret'
export SECRET_KEY='replace-with-a-32-byte-secret'
```

Fixture Server 只能作为测试基础设施，生产路由和 Web 操作不得依赖它。

## 仓库结构

```text
apps/
  web/              React 产品界面
  control-plane/    Fastify API 与 PostgreSQL 持久化
  runner/           独立 HTTP 执行进程
  cli/              CI 与命令行客户端
packages/
  contracts/        版本化稳定契约
  adapters/         导入格式 → CanonicalApiModel
  test-fixtures/     仅用于测试的确定性基础设施
docs/                领域、架构、状态与执行目标
```

仓库硬约束见 [`CLAUDE.md`](CLAUDE.md)，统一领域语言见
[`CONTEXT.md`](CONTEXT.md)，持续产品化目标和证据矩阵见
[`docs/CODEX_PRODUCT_GOAL.md`](docs/CODEX_PRODUCT_GOAL.md)。

部署、验证、备份、恢复、升级和回滚命令见
[`docs/OPERATIONS.md`](docs/OPERATIONS.md)。

## 当前生产缺口

- 当前验证目标是单机本地发布候选；多节点高可用、托管服务故障切换、TLS
  入口和负载测试仍需由部署方完成。
- 浏览器测试已覆盖产品主路径，但可访问性、兼容性和更广的异常路径仍不完整。
- 恢复测试在本地镜像数据库与对象证据；部署方仍需使用选定供应商验证加密的
  异地备份。

证据矩阵没有全部标记为已证明之前，不应部署到生产环境。

## 安全

禁止提交凭据或 `.env` 文件。漏洞报告流程见 [`SECURITY.md`](SECURITY.md)。

## 贡献

参阅 [`CONTRIBUTING.md`](CONTRIBUTING.md)。契约 Schema 发生变化时，必须在
同一个变更中更新所有消费者和契约测试。

## 许可证

[Apache-2.0](LICENSE)
