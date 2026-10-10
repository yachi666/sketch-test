> 历史记录：2026 年 6–7 月原型阶段的设计、计划或审视；不作为当前实现说明或待执行指令。当前入口见 [仓库 README](../../../README.md)。

# 架构评审：前后端分离与 2025-2026 行业最佳实践

> 评审日期：2026-06-22  
> 评审范围：SketchTest / `docs/TECHNICAL_ARCHITECTURE.md` / 实际代码结构  
> 对比基准：2025-2026 年行业共识与最佳实践

---

## 一、2025-2026 行业共识速览

### 前后端分离：已不是"要不要"，而是"怎么要"

| 时间线 | 状态 |
|--------|------|
| 2010-2015 | 前后端分离 = 前沿实践 |
| 2015-2020 | SPA + RESTful API = 主流默认 |
| 2020-2024 | Headless/API-First = 新标准 |
| **2025-2026** | 前后端分离已是**默认架构**，但行业正从**教条式分离**走向**理性架构选择** |

关键数据：

- 约 **80%** 的企业计划两年内采用无头架构（[WP Engine 2024 调查]）
- **73%** 的企业已在用 Headless 架构
- 同时，**微前端采用率从 75% 骤降到 23%**（[腾讯云 2026 报告]）——过度解耦正在退潮

### 核心转向：模块化单体（Modular Monolith）成为 2026 最热方案

2025-2026 年最大的趋势转变：

> **行业从"微服务狂热"回归理性——模块化单体成为默认首选架构。**

根据 [Thoughtworks 2025 技术雷达]，超过 **40% 的组织后悔至少部分微服务决策**。[DevX 2026 报道] 指出：

```
团队 < 30人 + 低复杂度 → 分层架构即可
团队 50+ + 成熟DevOps → 才考虑微服务
中间地带 → 模块化单体（默认首选）
```

Shopify 就是标杆——多年来维护着世界上最大的 Rails 单体，靠严格的模块边界而非运行时拆分。

### 新兴的"中间地带"

前后端分离也出现了折中方案：

| 方案 | 适用场景 |
|------|---------|
| **BFF（Backend for Frontend）** | 多端（Web/Mobile/IoT）时，为每种前端定制专属后端层 |
| **HTMX 复兴** | 80% 是表格+表单的内部系统，不需要 SPA 重框架 |
| **tRPC** | 全栈 TypeScript 团队，前后端共享类型系统 |
| **Micro-Backends** | 前端团队用 Hono 等轻量框架自维护薄后端层 |

**一句话总结**：用最简单的架构解决真实问题，让业务痛点驱动复杂度增长，而非反过来。

---

## 二、SketchTest 架构评审

### 当前架构形态

SketchTest 有四层独立进程：

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Web (React)  │────▶│ Control Plane    │◀────│   Runner     │
│  前端展示层    │     │ (NestJS+Fastify) │     │  执行引擎     │
│               │     │  模块化单体       │     │  独立部署     │
└──────────────┘     └─────────────────┘     └──────────────┘
                              │
                              ▼
                      ┌─────────────────┐
                      │   AI Worker     │
                      │   独立进程       │
                      └─────────────────┘
```

### ✅ 做得对的地方（共 5 项）

#### 1. 选择了"模块化单体"而非微服务

`TECHNICAL_ARCHITECTURE.md` 第 1 节明确写道：

> "V1 采用一个 TypeScript 模块化单体控制面……只有当模块需要独立扩缩容、独立安全域或独立发布节奏时，才从控制面中拆出进程。"

第 15 节"演进触发条件"进一步明确：

> "不以代码行数、团队人数或'微服务更先进'为拆分理由。"

**评估**：⭐⭐⭐⭐⭐ — 与 2026 年行业最佳实践完全一致。避免了"过早微服务"的陷阱——这是当前行业反思最多的架构错误。

#### 2. 关键边界用进程隔离，而非服务隔离

控制面（Control Plane）、Runner、AI Worker 是**独立进程**，边界正确：

| 组件 | 信任域 | 隔离理由 |
|------|--------|---------|
| Control Plane | 持有元数据，不访问被测内网 | 安全边界 |
| Runner | 部署在被测服务附近，持有短期 Secret | 网络可达性 + Secret 最小化 |
| AI Worker | 只读 Git 快照，不接触凭证 | 数据外发风险隔离 |

**评估**：⭐⭐⭐⭐⭐ — 拆分决策源于安全/网络/信任域需求，而非教条式服务拆分。每个拆分的理由在架构文档中有明确记录。

#### 3. 契约驱动（Contracts as Stable Seams）

五个 `packages/contracts/` 包是跨进程的版本化 Zod Schema：

```typescript
// 不是"后端返回 JSON、前端随意解析"
// 而是双方共享运行时校验的 Zod Schema
import { ExecutionPlanSchema } from '@sketch-test/runner-protocol';
const plan = ExecutionPlanSchema.parse(response); // 运行时校验 + 编译时类型
```

**评估**：⭐⭐⭐⭐⭐ — 这比传统 REST API 前后端分离进了一步：不止是"分离部署"，而是"类型化契约约束"。Pleo 等公司在 2025 年大规模采用 tRPC 正是这个原因——SketchTest 的 Zod 契约包实现了同样的端到端类型安全。

#### 4. 编译期与运行期隔离

`WorkflowCompiler` → `ExecutionPlan` → `Runner` 的链路贯穿了原则：

> "Runner 不直接执行可变的编辑器文档……所有变量引用在编译期完成作用域和类型检查；运行时值除外。"

**评估**：⭐⭐⭐⭐⭐ — 运行时不执行未编译的用户输入，避免了注入风险。这是安全关键的前后端分离实践，远超常规"前端调 API"的认知水平。

#### 5. Secret 生命周期管理

```text
Secret Provider
  → Runner 以短期授权读取
  → 仅存在于当前运行内存
  → 请求发送
  → Runner 侧脱敏
  → 脱敏事件上传控制面
  → 运行结束清理内存和临时文件
```

- 控制面页面**永不返回 Secret 明文**
- AI Worker **永不获得运行环境 Secret**
- Runner 日志库默认对 Header、JSONPath 和已解析 Secret 值做二次脱敏

**评估**：⭐⭐⭐⭐⭐ — Secret 安全在传统前后端分离中经常被忽略，但 SketchTest 把它作为一等公民。控制面零明文、Runner 内存级暂存、上传前脱敏——三位一体的安全设计。

---

### ⚠️ 可加强的地方（共 4 项）

#### 1. 缺乏 BFF（Backend for Frontend）层

**现状**：Web 直连 Control Plane REST API

```
Web ──REST JSON──▶ Control Plane
```

**风险**：当 Web 需要的数据形状与 Control Plane 领域模型不一致时（例如报告页面需要聚合多个领域数据），会出现两种坏模式：

- Web 发多次请求，前端做 join（慢且不可靠）
- Control Plane 为了前端加"万能接口"（后端领域模型腐化）

**建议**：在 `apps/web` 和 Control Plane 之间加一层轻量 BFF（用 NestJS GraphQL resolver 或简单的 API 聚合层）。建议在 M1 的 `sketch-test-109`（报告详情）阶段引入。

**优先级**：中 — 当前 M0 阶段可以不加，但实现编辑器前应决策。

#### 2. 缺少 API Gateway 统一入口

**现状**：所有模块共用 NestJS 路由，没有统一的：

- 限流
- 认证/授权集中执行点
- 请求/响应日志统一收集

架构文档提到了 Policy Engine 集中鉴权，但没有 Gateway 层来统一执行。

**建议**：在 Fastify/NestJS 前加一层 Gateway middleware（可用 Fastify plugin 实现轻量版），至少在 M2（CI 集成阶段）落实。

**优先级**：中 — 在 Runner 注册和 CI 集成之前实现价值最大。

#### 3. 前端状态管理策略未在架构文档中体现

**现状**：`apps/web` 是 React 19 应用，但架构文档没有讨论：

- 状态管理策略（React Query？Zustand？）
- 与后端契约包的集成方式
- 离线/错误/加载/空状态处理

**建议**：在实现编辑器（`sketch-test-202` 流程编排器）之前，补充前端架构设计文档，明确数据获取层、状态生命周期和契约集成模式。

**优先级**：低 — 当前 M0 阶段影响不大，但进入 M1 的 UI 开发前应补齐。

#### 4. PostgreSQL 任务队列的演进路径需要基准验证

**现状**：V1 用 `SELECT ... FOR UPDATE SKIP LOCKED` 做任务队列

**风险**：在低吞吐时完全可行，但在 Runner 数量增长后可能成为瓶颈。M0 的 `sketch-test-006`（性能 Spike）会验证这一点，但基准测试指标需要更具体。

**建议**：补充具体基准指标，例如："10 个 Runner 并发长轮询时，数据库 CPU < 50%，锁等待 < 100ms"。

**优先级**：低 — 已在 M0 Spike 计划中，只需要指标更具体。

---

## 三、各维度评分汇总

| 维度 | 评分 | 说明 |
|------|------|------|
| 前后端分离 | ⭐⭐⭐⭐⭐ | Web/Control Plane/Runner/AI Worker 四级进程隔离，正确 |
| 架构风格选择 | ⭐⭐⭐⭐⭐ | 模块化单体 = 2026 最佳实践，避免了过早微服务 |
| 契约驱动 | ⭐⭐⭐⭐⭐ | Zod Schema 跨进程共享，比 REST 口头约定强一个量级 |
| 安全隔离 | ⭐⭐⭐⭐⭐ | Secret 只在 Runner 内存，脱敏在写入前，控制面零明文 |
| 可演进性 | ⭐⭐⭐⭐☆ | 有明确的拆分触发条件（第 15 节），不教条 |
| BFF/Gateway | ⭐⭐⭐☆☆ | 缺少中间聚合层，建议后续补充 |
| 前端架构明确性 | ⭐⭐⭐☆☆ | React 选型正确但状态管理策略未文档化 |
| **加权综合** | **⭐⭐⭐⭐☆** | **架构方向完全正确，M0 阶段有少量待补齐项** |

---

## 四、结论

### 关于"前后端分离是否必要"

**必要的。** 2025-2026 年的行业共识是：前后端分离已经是默认架构，但这不等于微服务。正确的做法是：

1. **前后端进程分离**（SketchTest 已做到 ✅）
2. **契约驱动而非口头约定**（SketchTest 已做到 ✅）
3. **后端用模块化单体而不是微服务**（SketchTest 已做到 ✅）
4. **只在实际痛点出现时才拆分服务**（SketchTest 已预留演进路径 ✅）

### 关于 SketchTest 当前架构

**项目架构不仅符合最佳实践，而且精准绕过了 2025-2026 年行业反复踩过的坑：**

- ❌ 没掉进"过早微服务"陷阱
- ❌ 没掉进"前后端共享生命周期"的安全隐患
- ❌ 没掉进"Secret 明文进日志"的常见错误
- ❌ 没掉进"编辑器文档直接给执行器"的注入风险

架构文档中最值得肯定的设计决策：

> *"不以代码行数、团队人数或'微服务更先进'为拆分理由。"*

这恰恰是 2026 年行业花了大把学费才达成的共识。SketchTest 在 M0 阶段就写下了它——方向完全正确。

---

## 参考来源

- [Thoughtworks Technology Radar 2025](https://www.thoughtworks.com/radar) — 微服务反思与模块化单体推荐
- [DevX: The Microservices Backlash (2026)](https://www.devx.com/uncategorized/microservices-backlash-monoliths-comeback-2026/) — 微服务反噬趋势分析
- [Opinov8: Modernizing the Monolith](https://opinov8.com/insights/front-end-architectures-for-enterprise/) — 企业前端架构演进
- [腾讯云: 2026年前端技术的真实处境](https://cloud.tencent.com.cn/developer/article/2637788) — 微前端退潮数据
- [CSDN: 前后端分离十年演进与未来趋势](https://blog.csdn.net/jiang811113/article/details/152329376) — 中文社区趋势
- [Pleo: Scaling the Frontend Monorepo](https://eng.pleo.io/scaling-the-frontend-monorepo-platform-beyond-microservices-e5e26d90271f) — tRPC + 模块化单体实践
- SitePoint: The Rise of Micro-Backends — Hono 等轻量后端框架应用
- DevX: The Future of Frontend (2026) — React Server Components, HTMX, Svelte 5
