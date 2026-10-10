# SketchTest

**从 API 描述到待审测试、可复现执行与可追溯证据。**

[![CI](https://github.com/yachi666/sketch-test/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/yachi666/sketch-test/actions/workflows/ci.yml)
[![CodeQL](https://github.com/yachi666/sketch-test/actions/workflows/codeql.yml/badge.svg?branch=master)](https://github.com/yachi666/sketch-test/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) · 简体中文

SketchTest 是面向开发与测试团队的自托管 REST API 自动化测试平台。
导入 API 描述，审阅生成的草稿，发布不可变的测试或流程版本，再由部署在目标服务附近的
独立 Runner 执行。每次运行保留固定版本的输入，以及有序、脱敏的执行证据。

> **当前状态：单机发布候选。** 核心产品路径已有验收记录，但不代表所有生产场景均已就绪。
> 已验证能力与剩余工作见[项目状态](docs/STATUS.md)。

[快速开始](#快速开始) · [本地开发](#本地开发) · [文档导航](#文档导航) · [参与贡献](CONTRIBUTING.md)

## 可以做什么

| 能力 | 工作方式 |
| --- | --- |
| 导入 API 资产 | OpenAPI 3.0/3.1/3.2、Postman、HAR、RAML Adapter 统一输出 `CanonicalApiModel`。 |
| 编排业务流程 | 导入、导出受支持的 Arazzo 1.1 子集，组合请求、断言、提取、轮询与清理步骤。 |
| 生成待审草稿 | 规则生成与可选的 Pi AI Worker 产出草稿，由用户明确审阅、发布。 |
| 从代码发现 API | 固定公开 GitHub 仓库的 Commit，分析受支持的 Spring 路由和简单 DTO，保留源码行号。 |
| 可复现执行 | 独立 Runner 使用固定输入执行已发布版本，支持租约、重试与 Secret 脱敏。 |
| 查看执行证据 | Web 报告与 CLI 提供运行结果、有序事件、Trace 和质量门禁结论。 |

格式支持有明确边界，参见 [OpenAPI/Arazzo 兼容性](docs/OPENAPI_COMPATIBILITY.md)
与 [GitHub 代码发现范围](docs/design/2026-09-23-github-generation.md)。

## 快速开始

### 1. 获取源码

建议使用 **Node.js 24.15.0 及以上的 24.x 版本**和 **pnpm 12.10.1**。
完整 Node 支持范围见 [package.json](package.json)。容器部署与端到端验证需要
Docker Engine 和 Compose v2。

```bash
git clone https://github.com/yachi666/sketch-test.git
cd sketch-test
pnpm install --frozen-lockfile
pnpm turbo run lint check test build --force
```

### 2. 启动本地容器服务

```bash
cp .env.example .env
```

先编辑 `.env`：替换 PostgreSQL 与 S3 凭据，使用 `openssl rand -hex 32`
为 `JWT_SECRET`、`SECRET_KEY`、`RUNNER_REGISTRATION_TOKEN` **分别生成独立值**。
容器版 Web 使用 `WEB_ORIGINS=http://localhost:8080`，`IMPORT_ALLOWED_HOSTS`
仅填写需要导入 API 描述的主机。完整说明见[配置与部署手册](docs/OPERATIONS.md)。

```bash
docker compose config -q
docker compose up -d --build postgres minio minio-init control-plane web
curl --fail http://localhost:3802/ready
```

首次构建会编译固定版本的 MinIO 源码，可能需要数分钟。Web 地址为 **http://localhost:8080**。
执行测试前，按手册完成[工作区初始化与 Runner 配置](docs/OPERATIONS.md#deploy)；
仅启动 Web 容器不会自动创建账号或 Runner。

### 3. 完成第一条测试流程

1. 创建首个工作区与所有者账号，然后登录。
2. 为工作区注册并启动 Runner。
3. 导入 API 描述，为目标服务配置运行环境。
4. 编写或生成草稿，完成审阅，发布 `TestCaseVersion` 或 `WorkflowVersion`。
5. 执行已发布版本，在报告中查看结果与脱敏证据。

AI 生成是可选功能，需要单独配置 [AI Worker](apps/ai-worker/README.md)。
普通编写与执行不需要模型密钥。

## 本地开发

配置开发环境后，先运行 `pnpm build` 构建工作区依赖，再用独立终端启动各个进程。
通过 Shell 或进程管理器显式传入环境变量；裸 `pnpm` 命令不会为所有服务自动读取 `.env`。

| 命令 | 用途 |
| --- | --- |
| `pnpm dev:web` | Web 开发服务器，默认端口 5173 |
| `pnpm dev:cp` | Control Plane，需要可访问的 PostgreSQL |
| `pnpm --filter @sketch-test/runner dev:daemon` | Runner 守护进程，需要工作区与 Runner 配置 |
| `pnpm dev:fixture` | 仅用于测试的确定性目标服务 |
| `node apps/cli/dist/index.js --help` | CLI 使用说明 |
| `pnpm lint` / `pnpm check` / `pnpm test` / `pnpm build` | 代码规范、类型检查、测试与构建 |

用隔离的一次性资源验证生产模式下的完整流程：

```bash
pnpm --filter web exec playwright install chromium
E2E_MANAGED_POSTGRES=1 pnpm e2e:product
pnpm e2e:compose
```

Linux 如缺少浏览器系统依赖，使用 `playwright install --with-deps chromium`。
验证脚本创建隔离数据库、对象存储和容器，结束后清理。产品 E2E 覆盖
导入 → 发布 → 执行 → 浏览器／CLI 报告，以及数据库和对象证据恢复。

## 架构

```text
Web / CLI ── HTTP ── Control Plane ── PostgreSQL + S3 兼容对象存储
                         │
                         ├── Generation Protocol ── 独立 AI Worker
                         └── Runner Protocol ── 独立 Runner ── 目标 API
```

- **发布后不可变：** 已发布的 API、测试、流程、环境与数据集版本不再修改。
- **契约边界：** `packages/contracts/` 下的六个版本化契约包是稳定边界。
- **独立进程：** Control Plane、Runner 和 AI Worker 各自管理生命周期。
- **AI 先产草稿：** 生成内容必须经过审阅与明确发布，才能执行。

```text
apps/       web · control-plane · runner · ai-worker · cli
packages/   contracts · adapters · test-fixtures
docs/       运维 · 兼容性 · 设计决策 · 验证记录
ops/        对象存储 · 监控 · 告警
.github/    CI · 安全扫描 · 依赖更新 · Pages
```

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [运维手册](docs/OPERATIONS.md) | 配置、部署、初始化、备份、恢复与回滚 |
| [项目状态](docs/STATUS.md) | 带日期的验证证据与生产缺口 |
| [兼容性说明](docs/OPENAPI_COMPATIBILITY.md) | OpenAPI/Arazzo 可执行支持边界 |
| [AI Worker](apps/ai-worker/README.md) | 模型配置、草稿审阅与 Worker 限制 |
| [领域词汇](CONTEXT.md) | 统一实体定义与产品流程 |
| [仓库指南](CLAUDE.md) | 包结构、硬约束、工具与测试约定 |
| [GitHub 自动化](docs/GITHUB_AUTOMATION.md) | 检查、依赖更新、安全、版本 PR 与 Pages |

## 贡献与安全

通过 [GitHub Issues](https://github.com/yachi666/sketch-test/issues/new/choose) 报告缺陷或提出建议。
向 `master` 提交 PR 前，请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。CI 必须通过，
契约变更必须同步更新消费者与测试。

漏洞请走[私密安全报告](https://github.com/yachi666/sketch-test/security/advisories/new)，
不要在公开 Issue 披露。详见 [SECURITY.md](SECURITY.md)。禁止提交凭据与 `.env` 文件。

## 许可证

SketchTest 源码使用 [MIT](LICENSE)。第三方组件遵循各自许可证；
随容器构建的 MinIO 服务端与客户端采用 AGPL-3.0。
