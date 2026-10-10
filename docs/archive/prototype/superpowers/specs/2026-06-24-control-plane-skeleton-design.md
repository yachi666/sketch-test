> 历史记录：2026 年 6–7 月原型阶段的设计、计划或审视；不作为当前实现说明或待执行指令。当前入口见 [仓库 README](../../../../../README.md)。

# Control Plane Skeleton — M0 Vertical Slice

> 状态：Approved  
> 日期：2026-06-24  
> 输入：PRD M0 退出标准, IMPLEMENTATION_PLAN sketch-test-005

## 目标

让这条链路跑通：

```
导入 Fixture OpenAPI → 硬编码 5 步 ExecutionPlan → Runner 领取执行 → CP 收集证据 → Web 展示报告
```

## 范围

**做：**
- Fastify 最小 CP：health, import, run, lease, events, report
- PostgreSQL 3 张表：api_versions, runs, step_events
- Runner 接入 CP API（lease pull + event push）

**不做：**
- 用户认证/权限/多租户
- 工作流编译器
- 环境/Secret 管理
- CLI/CI 触发
- Web 新页面（只加最小 RunDetail 组件）

## 模块

```
apps/control-plane/src/
  main.ts                    # Fastify 启动
  modules/
    health/health.module.ts  # GET /health
    import/                  # POST /api/import → OpenAPI Adapter → CanonicalApiModel
    run/                     # ExecutionPlan + lease + events
    report/                  # GET /api/runs/:id/report
  db/
    db.ts                    # pg Pool
    migrations/001_initial.sql
  shared/
    errors.ts, id.ts
```

## API 契约

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | /health | 健康检查 |
| POST | /api/import | 导入 OpenAPI spec |
| GET | /api/api-versions/:id/execution-plan | 硬编码生成 ExecutionPlan + 创建 Run |
| GET | /api/runs/next | Runner 长轮询领任务 |
| PUT | /api/runs/:id/claim | Runner 原子认领 |
| POST | /api/runs/:id/events | Runner 上报事件（幂等） |
| PATCH | /api/runs/:id | Runner 更新 Run 状态 |
| GET | /api/runs | 运行列表 |
| GET | /api/runs/:id | 运行详情 + 步骤证据 |

## 数据库

3 张表：api_versions (JSONB), runs (JSONB plan + status), step_events (JSONB payload + step_index)

Runner lease 使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 实现原子认领。

## 执行链路

1. CP 导入 OpenAPI → CanonicalApiModel → 写入 api_versions
2. CP 硬编码生成 5 步 ExecutionPlan → INSERT runs (status=pending)
3. Runner `GET /api/runs/next` → 获取 plan
4. Runner 执行 HTTP 请求 → 每步 POST events（幂等）
5. Runner `PATCH /api/runs/:id` → status=passed/failed
6. Web `GET /api/runs/:id` → 展示时间线 + 证据

## 实现顺序

| # | 任务 | 估时 |
|---|------|------|
| 1 | CP 骨架：Fastify + DB 连接 + health | 1d |
| 2 | 数据库迁移：3 张表 | 0.5d |
| 3 | Import 模块 | 1.5d |
| 4 | Run 模块：ExecutionPlan + 创建 | 1d |
| 5 | Lease + Event 模块 | 2d |
| 6 | Runner 接入 CP | 2d |
| 7 | Web api-client + RunDetail | 1.5d |
| 8 | 端到端验证 M0 退出标准 | 1d |
