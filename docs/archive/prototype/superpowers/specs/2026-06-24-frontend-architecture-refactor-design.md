> 历史记录：2026 年 6–7 月原型阶段的设计、计划或审视；不作为当前实现说明或待执行指令。当前入口见 [仓库 README](../../../../../README.md)。

# Frontend Architecture Refactoring

> 状态：Approved  
> 日期：2026-06-24  
> 目标：将 App.tsx 从 3980 行单体拆分为路由驱动的页面架构 + Zustand 状态管理

## 动机

- `App.tsx` ~3980 行，包含 15+ 视图的条件渲染、内联对话框、全部状态管理
- 无 URL 路由 — 浏览器前进/后退无效，无法深链接
- `useState` 散落各处，状态变更造成不必要的全局重渲染
- 为 M1 功能（身份认证、Runner 集成、报告）铺路

## 技术决策

| 决策 | 选择 | 依据 |
|------|------|------|
| 路由 | React Router v7 | 行业标准，懒加载支持，URL 参数 |
| 客户端状态 | Zustand (~1KB) | 2025 业界首选，选择器精准订阅，无 Provider 包裹 |
| 项目结构 | Bulletproof-React 轻量版 | FSD 过度，简单 Feature 结构更适合中型项目 |
| 持久化 | localStorage（保留现有） | M0 阶段，后续迁移到后端 API + TanStack Query |

## 路由设计

```
/                          → DashboardPage
/apis                      → ApiManagementPage
/apis/:endpointId          → EndpointDetailPage
/import                    → ImportPage
/variables                 → VariablesPage
/environments              → EnvironmentsPage
/workflows                 → WorkflowsPage
/workflows/:id             → WorkflowEditorPage
/runs                      → RunsPage
/cases                     → CasesPage
/agent                     → AgentPage
```

## Zustand Store 设计

```
apiStore:
  - apiEndpoints, apiDetails, apiSchemas, apiSources, imported
  - actions: handleCreateEndpoint, handleUpdateEndpoint, handleDeleteEndpoint,
             handleCreateSchema, upsertSource, deleteSource, saveImport

variableStore:
  - variables (localStorage 持久化)
  - actions: saveVariable, deleteVariable

environmentStore:
  - environments, activeEnvironmentId (localStorage 持久化)

workflowStore:
  - activeWorkflowId, steps
  - actions: openWorkflow, backToList, saveDraft

runStore:
  - logs, runState, runs, activeRunId
  - actions: runWorkflow

uiStore:
  - sidebarOpen, toast, global dialogs state
```

## 目录结构

```
apps/web/src/
├── app/
│   ├── App.tsx             (~30 行 shell)
│   ├── routes.tsx
│   └── providers.tsx
├── stores/
│   ├── apiStore.ts
│   ├── variableStore.ts
│   ├── environmentStore.ts
│   ├── workflowStore.ts
│   ├── runStore.ts
│   └── uiStore.ts
├── pages/
│   ├── Dashboard/
│   ├── ApiManagement/
│   ├── Variables/
│   ├── Environments/
│   ├── Workflows/
│   ├── Reports/
│   ├── Cases/
│   ├── Agent/
│   └── Import/
├── components/
│   ├── layout/            # Sidebar, AppLayout
│   ├── shared/            # 现有共享组件
│   ├── api/               # 现有 API 组件
│   └── source/            # 现有 Source 组件
├── lib/storage.ts         # 保留
├── data.ts                # 保留
└── types.ts               # 保留
```

## 不变项

- `storage.ts` — 所有 localStorage 键和迁移逻辑不改变
- `data.ts` — 初始种子数据保持兼容
- `types.ts` — 类型定义不变
- 所有现有 API 管理组件（ApiTable, SchemaViewer 等）迁移路径，不改变行为

## 验收标准

- `pnpm check` 通过（TypeScript 无错误）
- `pnpm dev:web` 正常启动
- 所有现有视图可通过 URL 访问
- 浏览器前进/后退正常工作
- 侧边栏导航高亮与当前路由同步
- 数据在页面切换间保持（localStorage 持久化不丢失）
