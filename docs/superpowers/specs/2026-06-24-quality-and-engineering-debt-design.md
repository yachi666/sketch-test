# Quality & Engineering Debt — 阶段 1：核心模块测试

> 日期：2026-06-24 · 状态：Draft · 迭代：第 1 轮（共 3 阶段）

## 目标

为关键路径（导入 → 编译 → 执行 → 报告）的核心模块建立自动化测试，形成可重复的回归保护网。

## 非目标

- 不覆盖全部 16 个 CP 模块（只测 6 个核心模块）
- 不做 E2E 测试
- 不做 Web 页面组件级渲染测试
- 不修复已发现的 Runner 功能缺陷（留给阶段 2）

## 范围

### 1. Control Plane 核心模块测试

| 模块 | 测试方式 | 预估用例 |
|------|---------|---------|
| Run Orchestrator (`run.service.ts`) | 状态机模型 + DB 隔离 | ~15 |
| Workflow Compiler (`workflow-compiler.ts`) | 纯内存测试（无 DB 依赖） | ~20 |
| Evidence Ledger (`event.service.ts`) | DB 隔离 | ~10 |
| IAM (`iam.service.ts`) | DB 隔离 | ~12 |
| Import (`import.service.ts`, `diff.service.ts`) | Golden File + 纯逻辑 | ~10 |
| Generation (`generation.service.ts`) | 纯逻辑（无 DB 依赖） | ~10 |

### 2. Runner 集成测试

| 测试对象 | 测试方式 | 预估用例 |
|---------|---------|---------|
| `executeStep()` | 启动 Hermetic Fixture Server | ~8 |
| `executePlan()` | 构造多步骤 ExecutionPlan | ~6 |
| `daemon.ts` 核心逻辑 | 提取并测试纯函数 | ~6 |

### 3. Web Store 单元测试

| Store | 测试方式 | 预估用例 |
|-------|---------|---------|
| authStore | 纯 Zustand store 测试 | ~5 |
| workflowStore | 纯 Zustand store 测试 | ~8 |
| environmentStore | 纯 Zustand store 测试 | ~6 |
| variableStore | 纯 Zustand store 测试 | ~6 |

## 测试基础设施决策

- **测试框架**: vitest（已配置 workspace）
- **DB 层**: 不引入 pg-mem 等内存 mock——CP 的 service 函数直接操作 pg，测试策略采用 **纯函数优先**：将可独立测试的纯逻辑提取为独立函数，直接测试；对于需要 DB 的操作，暂用集成测试方式（启动真实 PG 或跳过，标记为集成测试）
- **HTTP 层**: CP 使用 `fastify.inject()` 做路由级测试；Runner 使用 Hermetic Fixture Server
- **Store 层**: Zustand 提供 `createStore` API，可直接在测试中创建实例并操作

## 文件约定

- CP 测试: `apps/control-plane/src/**/__tests__/*.test.ts`
- Runner 测试: `apps/runner/src/__tests__/*.test.ts`（追加）
- Web 测试: `apps/web/src/stores/__tests__/*.test.ts`

## 成功标准

1. 每个模块覆盖核心不变量和至少 2 个错误路径
2. `pnpm test` 全部通过（仅本次新增的测试）
3. 测试不依赖外部服务（除 Hermetic Fixture Server 外）
4. 纯逻辑测试（Compiler、Generation）在 500ms 内完成
