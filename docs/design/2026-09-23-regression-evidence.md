# 回归结果与失败证据迭代

日期：2026-09-23。对象：当前工作树。范围：工作台、报告中心、Control Plane 查询与报告聚合、Runner 事件上传。本轮在已有实现上继续开发，未重写其他业务模块。

## 需求场景与设计

测试工程师执行一条关键业务回归后，需要知道：哪些运行需要关注、哪个步骤首先失败、期望和实际差异在哪里，以及后续与清理步骤是否执行。大量历史运行、异步执行和窄屏查看都不能改变结论。

保留项目既有的中文蓝图背景和配色，报告阅读区域使用白底；将信息顺序改为“范围和结论 → 搜索与筛选 → 业务运行 → 失败步骤 → 断言证据”。

| 步骤 | 原有问题与证据 | 本次实现与验收状态 |
| --- | --- | --- |
| 1. 查找回归 | 初始空页只有汇总和输入框；代码确认仅取最近 50 条，筛选在浏览器执行 | 数据库全量搜索、时间范围、分页、明确统计口径、空态跳转。通过 |
| 2. 判断状态 | 前后端 pending/claimed 与 queued/leased 不一致；取消混入进行中 | 同时识别实际与历史状态；通过、失败、无法判断/失联、进行中、取消分别统计。通过 |
| 3. 打开失败 | 原详情以 ID 和原始 JSON 为主，缺少业务步骤名 | 读取不可变版本名称，默认选中失败步骤并展示断言，提供失败快捷入口。通过 |
| 4. 核对证据 | 失败后的未执行步骤不展示；清理事件可能落到第一步 | 从冻结计划补全步骤；未执行/跳过/异常分离；清理独立索引，兼容旧事件的 stepId。通过 |
| 5. 移动与键盘 | 需要验证窄屏是否能够完成任务 | 390 × 844 无页面横向溢出，运行列表转为卡片；方向键切换证据标签、搜索、清除筛选、分页与返回保留条件。通过 |

截图取自本轮内置浏览器现场，保存在本地忽略目录，不作为可部署资产：

- [初始报告页](evidence/2026-09-23/reports/01-reports-before.png)
- [桌面列表](evidence/2026-09-23/reports/02-reports-desktop.png)（批量执行中）
- [失败筛选](evidence/2026-09-23/reports/03-attention-filter.png)（批量执行中）
- [最终失败证据](evidence/2026-09-23/reports/04-failure-evidence-desktop.png)
- [移动端断言](evidence/2026-09-23/reports/05-failure-evidence-mobile.png)
- [移动端列表](evidence/2026-09-23/reports/06-reports-mobile.png)

截图及键盘实测覆盖本次主要路径，不表示完整 WCAG 或跨浏览器认证。

## 前后端实现

- `GET /api/runs` 增加 `q`、`status`、`days=0|1|7|30`、`page`、`pageSize`，参数经 Zod 验证。保留 `runs` 字段，新增 `total/page/pageSize/summary`。
- 搜索支持业务版本名称、Run ID、版本 ID 和 Runner ID；百分号按字面搜索。参数化 SQL，工作区来自登录身份。
- 总数、摘要和当前页在一个 PostgreSQL statement 中读取，排序为创建时间与 ID 倒序。摘要遵循搜索和时间范围，不受状态筛选与分页影响。
- 工作台近 7 天指标使用全量摘要；关注项独立查询，避免被最近 50 条成功运行遮住。
- 详情依据 Runner sequence 排序证据，展示每次断言的预期、实际、严重级别与尝试次数。原始请求/响应/事件仍可查看。
- 展示 URL 仅使用 Runner 脱敏事件，不从冻结计划泄露原始请求；不可变版本与共享契约未修改。
- 新 Runner 分开上传主流程和清理步骤；报告按 stepId 重新分组以兼容历史清理事件索引。
- 列表与详情请求支持取消，旧请求不会覆盖新筛选结果。运行中每 5 秒刷新，可关闭，隐藏标签页暂停轮询。

## 本轮实际验证

`pnpm turbo run lint check test build --force`：72/72 任务成功，979 个测试通过。原有 lint 警告与部分 React 测试 act 警告仍存在，无失败检查。

真实进程：独立 Control Plane、Runner、Web、Fixture Server；独立 PostgreSQL 数据库 `sketchtest_iteration_20260923`。证据对象使用本地开发对象存储。

| 验收 | 实际结果 |
| --- | --- |
| GitHub 公开真实数据 | Runner GET `https://api.github.com/repos/nodejs/node`，HTTP 200 且 `$.full_name = nodejs/node`，Run `run_732f50fc` 通过 |
| 失败定位 | 对同一真实接口故意设置错误预期，Run `run_e72b5925` 失败，报告保留实际 `nodejs/node` 与错误预期 |
| 停止与清理 | 失败后主流程下一步未执行；清理阶段只读连通性步骤独立通过，未覆盖第一步状态 |
| 历史记录 | 55 次独立 Runner HTTP 运行全部通过；20 条每页，第三页 15 条，无重叠；第 99 页为空但总数仍为 55 |
| 查询边界 | 字面 `%` 搜索正确；非法页码、页大小、时间范围、状态返回 400 |
| 租户边界 | 第二工作区返回空列表及零摘要；读取外部工作区报告为 404；匿名列表为 401 |
| 浏览器 | 1440 × 1000 桌面与 390 × 844 移动；搜索、空态、分页、筛选恢复、键盘标签切换及真实断言显示通过 |

机器可读验收记录：[report-e2e.json](evidence/2026-09-23/report-e2e.json)。其中失败是故意构造的验收预期，不表示公开 API 故障。

可重复运行的脚本（需已有独立 CP、Runner、Fixture 与工作区身份）：

```bash
node apps/control-plane/scripts/report-e2e.mjs
node apps/control-plane/scripts/report-isolation-e2e.mjs
```

脚本支持 `REPORT_CP_URL`、`REPORT_TOKEN`、`REPORT_EVIDENCE_PATH`；首个脚本支持 `REPORT_FIXTURE_URL`。隔离脚本需要 owner 身份并创建一个独立验收工作区。未提供 token 时使用显式配置的本地 QA guest 身份。57 次真实运行没有伪造事件或数据库结果；55 次批量请求使用本地测试服务，不能称为生产业务数据。

## Docker 修复与同日补验

本机 Docker CLI 与 Docker Desktop 已安装，`desktop-linux` context 和 socket 路径正确；最初连接失败时 Desktop 主程序与后端引擎没有运行，只有网络辅助进程。执行 `docker desktop start --timeout 120` 后连接恢复，CLI 29.8.1、Engine 29.5.3、Compose v5.1.4。未重装 Docker，也未修改用户开机启动设置。

全新构建暴露并修复了缓存环境未暴露的问题：

- pnpm 11 的安装脚本策略缺少 `@google/genai` 与 `protobufjs` 的显式决策；检查包内脚本后，将其无须执行的提示脚本明确设为 `false`，保留其他脚本的审核策略。
- 四个 Dockerfile 在依赖安装时使用 `CI=true`，避免无 Git 仓库的镜像构建尝试安装 Lefthook hooks。
- Playwright 改用当前“智能生成”导航，并通过真实 API 保存两版流程、发布最新版本，验证接口取值来源与 `$.status` 引用，确认旧版提取项不再显示。
- 实测发现流程列表没有返回变量页需要的 `latestVersion`。Control Plane 使用单次、按工作区过滤的 lateral 查询补齐最新版本；未改动已发布版本或执行契约。

| 补验 | 实际结果 |
| --- | --- |
| 全量 lint/check/test/build | 72/72 任务、979 测试再次通过 |
| 产品 E2E | Docker 临时 PostgreSQL 18、MinIO，加独立生产模式 CP/Runner/Web/CLI/Chromium；9 接口、6 外置事件，Run `run_2fa9527d` 通过 |
| 浏览器 | 导航、导入入口、会话重载、真实变量来源、流程接口选择器、报告搜索与证据详情全部通过；控制台错误 0 |
| 恢复演练 | PostgreSQL dump 恢复到空库，Run 状态 `passed`、迁移记录 2；S3 完整镜像 9 对象逐一 SHA-256 一致 |
| Compose 首次部署 | 独立项目与新卷，构建并启动 CP/Web/Runner/PostgreSQL/MinIO；就绪、健康、工作区初始化、登录与 Runner 心跳通过；包含最新查询修复的第二次部署也通过 |
| AI Worker 镜像 | 生产镜像构建通过；无网络、非 root（UID 1000）容器成功加载 harness/model/worker 运行时模块；本次未调用付费模型 |
| 清理与本地预览 | 临时容器、卷及验收镜像已清理；保留原有容器；3802 健康检查与 5173 当前报告页面均 HTTP 200 |

机器可读记录：[产品与恢复](evidence/2026-09-23/product-docker-e2e.json)、[Compose](evidence/2026-09-23/compose-docker-e2e.json)、[AI 镜像](evidence/2026-09-23/ai-image-check.json)。原始命令日志保存在本机忽略目录 `logs/verification/2026-09-23-*`。产品 E2E 数据由真实 HTTP 调用和数据库写入产生，业务目标为本地确定性测试服务；公开外部数据验收见上文 GitHub 场景。

## 边界

Docker 启动问题已解决，完整产品 E2E、Playwright、数据库及对象备份恢复、Compose 冒烟均已补验通过。没有连接用户生产业务库，没有验证 TLS、托管 S3 故障切换、多节点租约或企业身份；本次交付不等于整个平台所有长期需求完成。
