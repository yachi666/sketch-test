> 历史记录：2026 年 6–7 月原型阶段的设计、计划或审视；不作为当前实现说明或待执行指令。当前入口见 [仓库 README](../../../../../README.md)。

# ApiSource: Multi-System API Management

> 2026-06-23 · Status: approved · Target: M0

## Problem

在同一个测试环境中可能存在多个后端系统的 API（用户服务、支付服务、通知服务等），每个系统有独立的 OpenAPI 文档。当前接口管理将所有导入的端点混在一个扁平列表中，无法按来源系统分组管理。变量也无法按系统隔离——当两个系统都有 `baseUrl` 时，只能靠命名约定区分。

## Domain Model Alignment

`CONTEXT.md` 已经定义了核心实体关系：

> **ApiSource** — A reference to an API description (OpenAPI file, RAML file, URL, or Git path). The raw input before parsing.
>
> **ApiVersion** — An immutable, published snapshot of a CanonicalApiModel after successful parsing and validation. Created from an ApiSource.

当前 UI 跳过了 `ApiSource`，直接从导入 → `ApiVersionInfo`。本次变更补齐这一层。

## Design

### Data Model Changes

```
新增:  ApiSource
      ├── id: EntityId                    e.g. "src-user-service"
      ├── name: string                    e.g. "用户服务"
      ├── description?: string
      ├── sourceLabel: string             e.g. "user-service.yaml"
      ├── sourceType: 'openapi' | 'raml' | 'manual'
      ├── defaultBaseUrl?: string         系统默认服务器地址
      ├── createdAt: string (ISO-8601)
      └── updatedAt: string (ISO-8601)

修改:  ApiVersionInfo
      └── + sourceId: EntityId            ← 新增，关联所属 ApiSource

修改:  Variable
      └── + sourceId?: EntityId            ← 新增可选字段，scope='source' 时必填

不变:  ApiEndpoint, Environment, EndpointDetail
```

### Entity Relationships

```
ApiSource ──1:N──► ApiVersionInfo ──1:N──► ApiEndpoint
    │
    └──1:N──► Variable (scope='source', sourceId=src.id)

Environment ──独立──► Variable.overrides[envId]（覆盖值，机制不变）
```

### Variable Resolution Chain

```
resolve(variable, envId, activeSourceId):
  1. overrides[envId]         → 环境覆盖（最高优先级）
  2. sourceId 对应的 ApiSource.defaultBaseUrl 等默认值
  3. defaultValue              → 全局默认（兜底）
```

### Storage

| Key | Type | Purpose |
|-----|------|---------|
| `sketchtest.api-sources:v1` | `StoredApiSource[]` | 新增 |
| `sketchtest.api-versions:v1` | `StoredApiVersion[]` (+sourceId) | 已有，加字段 |
| `sketchtest.api-endpoints:v1` | `StoredApiEndpoint[]` | 不变 |
| `sketchtest.variables:v1` | `Variable[]` (+sourceId) | 已有，加可选字段 |

### UI Scope

1. **API 管理页** — 顶部增加 `SourceSelector` 下拉，按 `sourceId` 过滤端点列表
2. **导入流程** — `ImportDialog` 增加 "新建系统 / 更新已有系统" 选择
3. **ApiSource 管理** — 新建对话（名称+描述+baseUrl），编辑，删除（级联警告）
4. **变量管理** — `VariableDialog` 增加 "所属系统" 下拉（scope=source 时显示）
5. **变量列表** — 增加 source 筛选

### Implementation Steps

1. **类型层** — `types.ts` 加 `ApiSource`，`Variable` 加 `sourceId`，`ApiVersionInfo` 加 `sourceId`
2. **存储层** — `storage.ts` 加 `StoredApiSource` 和 CRUD helpers
3. **ApiSource CRUD** — 新建/编辑/删除 source 的浮框对话
4. **SourceSelector** — API 管理页顶部 source 下拉 + "管理" 入口
5. **导入适配** — ImportDialog 加 source 选择字段，saveApiImport 关联 sourceId
6. **变量适配** — VariableDialog 加 source 选择（scope=source 时），列表加筛选
7. **向后兼容** — 无 sourceId 的旧数据和旧变量视为 "未分类"，保持现有行为

### Non-Goals (out of scope for this change)

- ApiSource 的 Git 仓库关联
- ApiSource 级别的权限控制
- 多 source 之间的 endpoint 对比/diff

## Self-Review

- [x] No TBD/TODO placeholders
- [x] Types are consistent with existing contracts
- [x] Backward compatible — optional fields, existing data unaffected
- [x] Scope is focused — no unrelated refactoring
- [x] Aligns with CONTEXT.md domain model
