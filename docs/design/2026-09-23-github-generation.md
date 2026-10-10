# GitHub 仓库来源与 AI 测试草稿

日期：2026-09-23。用户验收仓库：[yachi666/support-roster-server](https://github.com/yachi666/support-roster-server)。

## 缺失原因与恢复路径

本轮检查时，智能生成页只有已导入 API 版本的选择入口，仓库 URL 输入与后端代码分析入口均不存在。产品领域文档 PF-03 仍要求“连接仓库 → 扫描 → 审核草稿 → 发布”。此前契约生成的验收不能证明 Git 仓库场景已交付。

现在进入 **智能生成 → GitHub 仓库**，填写公开仓库 URL，可指定分支/Commit 和模块目录。后端固定提交、读取源文件并返回真实接口。选择最多 5 个接口、填写目标后，由当前工作区的独立 AI Worker 生成待审草稿。已分析的版本可复用；修改 URL/分支/目录会使旧选择失效，避免对错误来源发起生成。

## 实现与边界

- 新增 `@sketch-test/adapter-code-discovery`，通过既有 `CanonicalApiModel` 接入系统，不修改共享契约或已发布版本。
- 支持 Java/Spring `@RestController` 的字面量类/方法映射、路径/查询/Header 参数、简单 DTO 字段及必填/Email/Min/Max 注解、Controller 显式响应状态。动态路由、条件映射、嵌套泛型、record、全局鉴权、异常映射与服务层逻辑有明确分析提示。未找到显式响应状态的接口显示但不可在该页直接选择生成。
- `POST /api/import/repository` 继承身份/角色校验，工作区来自当前身份。只访问固定 GitHub API/raw 主机，禁用重定向，不运行仓库代码，不读取配置文件、测试目录或符号链接。不支持私有仓库或 GitHub Enterprise。
- 依据 [GitHub Git Trees API](https://docs.github.com/en/rest/git/trees) 的目录快照固定 commit/tree SHA；拒绝截断树，每个下载文件校验 Git blob SHA-1。单文件 256 KiB、总计 4 MiB、160 个文件、4 路读取、90 秒截止。GitHub 限流、仓库/分支不存在、无支持路由和超限均返回明确失败。
- PostgreSQL 保存不可变 API 投影与工作区归属；对象存储保存可复核的文件哈希清单。清单内容地址不包含每次变化的分析时间，重复导入同一提交不会覆写不可变证据。模型只接收结构投影和测试目标，不接收仓库原文、默认值或凭据。
- AI 仍通过独立 Pi Worker、有界任务和 fenced lease 运行。完成结果的代码来源由 CP 从已固定的 API 版本回填，不能由模型自行声明。审核页显示 Commit、文件/行号链接、请求、断言和假设，默认待审；接受、发布、执行仍独立。
- 模型在预算内可能只产出部分草稿。任务列表显示真实草稿数及覆盖的所选接口数；不会把 `completed` 解释为完整接口覆盖。生成失败保留状态并支持重试。

## 真实验证结果

固定提交 `f316473c15d8564fb61eb5fdb4eb8a5c06be4939`，扫描 86 个文件，发现 59 个接口，其中 57 个具备显式状态。72 条静态分析提示保留在版本中，主要是未展开的复杂 DTO 类型等边界。该数字不代表发现了全部业务行为。

使用当前已配置的 `deepseek / deepseek-v4-flash`，通过独立 Worker 真实生成：

| 任务 | 实际结果 |
| --- | --- |
| `gj_18f9a532` | 最初选择 3 个接口，实际产出 1 条员工列表 GET 草稿；界面明确显示 1/3 覆盖 |
| `gj_b7d0237b` | 新增员工 POST 首次 `MODEL_FAILED`，经现有重试流程第二次成功；请求 JSON 包含 DTO 要求的 `staffId`、`teamId` |
| `gj_2bdfaea5` | 删除员工 DELETE 草稿成功；路径 id 使用环境变量，状态断言 204 |

三条结果均为 `pending`，来源链接分别指向 `WorkspaceStaffController.java` 的 L32/L42/L57。没有发布这些草稿，也没有向排班业务服务执行请求。缺少目标环境 URL、测试身份与可清理数据，不能据此声称业务回归已通过。

验收记录：[真实仓库与 AI 结果](evidence/2026-09-23/github-generation-e2e.json)。验证包含来源 hash、提交、方法/路径、状态断言、DTO 必填字段、匿名导入 401、非 GitHub URL 400。复核脚本读取已有任务，不再调用模型或执行目标接口：

```bash
REPOSITORY_API_VERSION_ID=av_48848ec3 \
REPOSITORY_JOB_IDS=gj_18f9a532,gj_b7d0237b,gj_2bdfaea5 \
node apps/control-plane/scripts/repository-e2e.mjs
```

脚本默认访问本机 3802，可设置 `REPOSITORY_CP_URL` / `REPOSITORY_TOKEN`；无 token 时仅尝试显式启用的开发 guest 身份。

本轮自动检查：76 个 lint/check/test/build 任务、1,002 个测试通过。新增解析器、网络边界与交互回归覆盖注释/字符串中的伪路由、动态映射拒绝、DTO、来源稳定性、快照校验、限流、失败状态、旧来源失效、部分产出显示。真实 PostgreSQL AI 协议集成的 7 组验收也通过。

原有产品 E2E 与恢复演练通过：Run `run_772a9648`，6 外置事件、恢复库状态 passed、2 条迁移、9 个对象 hash 一致；[记录](evidence/2026-09-23/github-product-regression.json)。新依赖已进入冻结 lockfile，Compose 清洁安装完成 CP/Web/Runner 构建、就绪检查、初始化与 Runner 心跳验证；[Compose 验收记录](evidence/2026-09-23/github-compose.json)。日志位于本机忽略目录 `logs/verification/github-*`。

浏览器现场验证：提交 URL、等待真实分析、选择接口、创建真实任务、跳转审核、查看源码链接与可编辑定义、刷新后复用仓库快照。开发预览继续使用原数据库和工作区，AI Worker 已接入该工作区；本地凭据只保存在忽略目录，不写入源代码或验收记录。
