# Project Status

> **这是状态快照，不是 Agent 指令。** 最后更新：2026-06-24。
> 此处记录的数字（模块数、行数、页面数）会随开发快速过期，Agent 应通过代码探索自行确认当前状态，而非依赖此文档。
> 建议：每次 milestone 结束时手动更新一次，或运行 `git diff --stat $(git log -1 --format=%H -- docs/STATUS.md)..HEAD` 检查漂移。

## 里程碑进度

M0 (feasibility) 已完成。M1 和 M2 功能模块正在活跃开发中。

### 已构建的核心模块

- ✅ Monorepo — pnpm workspace、TypeScript strict、Biome、Vitest、Turbo
- ✅ 5 个共享合约包，含 Zod schema 和 golden test
- ✅ 5 个适配器：OpenAPI、Postman、HAR、RAML、format-detector
- ✅ Runner — HTTP 执行、断言评估、变量提取、敏感数据脱敏
- ✅ Hermetic Fixture Server — 8 个业务流程场景（BP-01 至 BP-08）
- ✅ CI pipeline（见 `.github/workflows/`）
- ✅ Control Plane — IAM、import、run、workflow、scheduling 等模块
- ✅ Workflow Compiler — 将 WorkflowDefinition 编译为 ExecutionPlan
- ✅ Web app — 工作流编辑器、运行时间线，已对接 Control Plane
- ✅ CLI — GitHub Actions 和 GitLab CI 集成示例

### 尚未完成

- 🔲 Control Plane 和 Web app 的自动化测试
- 🔲 AI Worker（M3）
- 🔲 S3 对象存储集成
