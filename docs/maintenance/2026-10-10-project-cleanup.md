# 项目资源清理 — 2026-10-10

以本轮开始时的工作树为基准，核对源码入口、静态/动态导入、文档引用、
文件内容哈希、PID 是否仍存在及日志占用情况后清理。未按文件年龄或 Git
未跟踪状态直接删除源文件。

## 空间变化

仓库占用从 **869.41 MiB** 降至 **651.90 MiB**，
净减少约 **217.52 MiB**（`du -sk`，包含 `.git` 和当前依赖）。
统计在回归验证完成、再次清除测试缓存后取得；保留新生成的可运行 `dist`。
这不代表全磁盘净释放量：pnpm 共享存储和仓库外恢复备份均保留。

## 已清理与整理

| 类别 | 处理 |
| --- | --- |
| 旧依赖副本 | 清除并按冻结锁文件离线重建 20 个依赖目录。移除 Web 下约 91 MiB 的 `.ignored` 旧包，以及旧 npm 布局、`.package-lock.json` 和 Vite 缓存；Web 依赖目录从约 144 MiB 降至约 40 KiB 的工作区链接。 |
| 构建残留 | 清除旧 `dist`、约 57 MiB 根 Turbo 缓存、各包缓存、增量状态，以及 `index 2.js`、`index.d 2.ts`、`tsconfig 2.tsbuildinfo` 等重复编译文件。全部从源码重建后再清除可再生缓存。 |
| 本地旧日志 | `.services/` 和 `.services/fix-baseline/` 中 40 份无当前文档引用且无进程占用的日志先压缩归档到仓库外，再移出项目。 |
| 失效状态 | 移除 6 个不存在对应进程的 PID 文件；保留本地凭证、端口配置、备份和运行证据。 |
| 空目录 | 移除已废弃页面留下的 `Login`、`Runs`、`WorkflowExecution`、`ApiCatalog`、`src/api`、`components/reports` 六个空目录。 |
| 项目配置 | 删除包含开发机绝对 npm cache 路径的 `apps/web/.npmrc`；本项目继续使用 pnpm，依赖版本和锁文件没有变化。 |
| 设计资料 | 根目录 QA 报告移至 [AI 计划设计 QA](../design/2026-09-28-ai-plan-design-qa.md)。6 张已被报告引用的截图移至 `docs/design/evidence/2026-09-23/reports/`，更新引用，避免有价值证据留在被忽略的临时截图目录。 |
| 后续清理 | 新增 `pnpm clean:cache`，仅处理可再生缓存与增量状态；支持 `--dry-run`。`pnpm clean` 同时清除构建输出和缓存。Docker 构建上下文新增排除 `*.tsbuildinfo`。 |

## 保留依据

- Web 源码引用检查没有发现可确认废弃的独立模块，未为了减少文件数删除功能代码。
- `styles-legacy.css`、`styles-overrides.css`、`graph-paper.png` 和导入 Worker
  仍有运行时引用，保留。
- 历史设计归档、已确认的视觉参考、契约黄金测试、验证报告和被引用的原始
  `logs/verification/` 日志仍有追溯价值，保留。
- 内容相同的 CLI/API 报告、不同日期的空控制台记录和各包 tsconfig 分别有
  独立用途；重复哈希并不等于可删除。
- 数据库、对象存储、恢复 dump、`.services/fix-baseline/pre-fix.patch`、环境
  凭证、现有 Docker 容器/卷、Git 历史和用户未提交的功能改动均保留。

## 验证

- `pnpm install --frozen-lockfile --offline` 通过；对比清理前备份，锁文件逐字节相同。
- `pnpm turbo run lint check test build --force`：**76/76 任务成功，1041 项测试通过**。
- 新增缓存清理脚本的预览和实际清理均执行成功。
- 当前非归档文档中的本地 Markdown 链接检查通过；被移动的资源引用已更新。
- `git diff --check` 和清理脚本的 Biome 检查通过。既有非阻塞 lint/React 测试警告仍存在。
- 本轮没有重跑容器 E2E；同日上一轮结果见 [容器验证](../verification/2026-10-10/dependency-container-e2e.md)。

## 恢复与使用

仓库外备份目录：

`/Users/zhinan/Documents/test-automation-cleanup-backups/20261010-135701`

包含 `workspace-before.tar.gz`（清理前 Git 可见源码和未提交文件）、
`tracked-before.patch`、`superseded-local-logs.tar.gz`、删除清单及验证日志。
原有本地凭证和业务数据留在原位置，没有进入源码归档。

```bash
pnpm clean:cache --dry-run  # 预览可再生缓存
pnpm clean:cache            # 清除缓存，保留 dist 和依赖
pnpm clean                 # 清除构建输出、缓存与增量状态
```

需要恢复时按清单提取单个文件，避免覆盖后续改动。未提交或推送任何变更。

## 提交前检查

- `docs/verification/` 保留历史验收证据的原始字节及校验和；Biome 不重写或检查该目录内的历史产物。生产源码、当前验证脚本和配置继续执行格式、lint 与类型检查。
- 同步贡献指南的 Node/pnpm 要求、6 个合同包数量及 Changesets 的 `master` 基线，移除环境示例中过期的模型 ID。
