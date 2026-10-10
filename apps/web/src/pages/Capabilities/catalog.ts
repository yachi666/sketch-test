export type Owner = '系统自动' | 'AI 辅助' | '人工操作';
export type Trigger = '手动发起' | '资产变化' | '执行过程中' | '定时规则';
export type SignalKey = 'apis' | 'ai' | 'plans' | 'schedules' | 'environments';

export interface Capability {
  id: string;
  title: string;
  description: string;
  owner: Owner;
  triggers: Trigger[];
  result: string;
  handoff: string;
  note: string;
  to: string;
  action: string;
  tone: string;
  signal?: SignalKey;
}

export const journey = [
  { title: '接入接口', caption: '从一份来源开始', to: '/import' },
  { title: '生成草稿', caption: '让想法初具轮廓', to: '/agent' },
  { title: '审核发布', caption: '把预期落到实处', to: '/cases' },
  { title: '编排计划', caption: '串起业务的脉络', to: '/plans' },
  { title: '执行回归', caption: '让预期接受检验', to: '/plans?view=published' },
  { title: '分析失败', caption: '循着证据找答案', to: '/reports' },
];

export const capabilityGroups: Array<{
  owner: Owner;
  title: string;
  subtitle: string;
  boundary: string;
  tone: string;
}> = [
  {
    owner: '系统自动',
    title: '系统自动完成',
    subtitle: '你定好起点，系统照料重复的步骤。',
    boundary: '按既定规则执行，不依赖 AI 判断。',
    tone: 'mint',
  },
  {
    owner: 'AI 辅助',
    title: 'AI 辅助生成',
    subtitle: '循着线索起笔，让想法初具轮廓。',
    boundary: '产出是草稿，不会直接发布或执行。',
    tone: 'violet',
  },
  {
    owner: '人工操作',
    title: '需要你操作',
    subtitle: '把方向与取舍，留在你手中。',
    boundary: '配置、审核、发布与发起执行需要你操作。',
    tone: 'amber',
  },
];

export const capabilities: Capability[] = [
  {
    id: 'import',
    title: '解析与整理接口',
    owner: '系统自动',
    tone: 'mint',
    description: '把散落在来源里的接口线索，整理成清楚的脉络。',
    triggers: ['手动发起'],
    result: '解析请求、响应与接口结构，保留来源诊断。',
    handoff: '提供接口文件或受支持的公开仓库，确认导入范围。',
    note: '仓库接口提取基于规则，当前支持部分 Spring 语义；不是 AI 自动理解全部业务。仓库入口在智能生成页面。',
    to: '/import',
    action: '导入接口',
    signal: 'apis',
  },
  {
    id: 'rules',
    title: '按规则生成基础草稿',
    owner: '系统自动',
    tone: 'mint',
    description: '以接口约定为底稿，写下基础请求与断言；这一程无需 AI。',
    triggers: ['手动发起'],
    result: '按生成策略构建基础测试草稿。',
    handoff: '选择接口与生成策略，之后审核并发布。',
    note: '规则生成与 AI 生成是两种不同能力；规则生成的结果同样需要审核，不会直接执行。',
    to: '/apis',
    action: '打开接口管理',
  },
  {
    id: 'execution',
    title: '执行测试与业务流程',
    owner: '系统自动',
    tone: 'mint',
    description: '你按下开始，Runner 便循着既定步骤，逐一检验预期。',
    triggers: ['执行过程中'],
    result: '发送请求、传递变量、验证断言，按配置执行清理。',
    handoff: '准备已发布版本、环境与变量，确认后发起运行。',
    note: '执行遵循固定版本。环境存在不等于执行就绪，仍需可用 Runner 和完整的执行条件。',
    to: '/plans?view=published',
    action: '前往已发布计划',
    signal: 'environments',
  },
  {
    id: 'reports',
    title: '留存证据与汇总报告',
    owner: '系统自动',
    tone: 'mint',
    description: '为每次请求留下脱敏的记录，让结果有迹可循。',
    triggers: ['执行过程中'],
    result: '保存请求、响应和断言结果，展示失败步骤与差异。',
    handoff: '根据证据判断失败原因，决定如何修正。',
    note: '报告提供排查依据；当前没有 AI 自动归因或自动修复能力。',
    to: '/reports',
    action: '查看运行报告',
  },
  {
    id: 'generation',
    title: 'AI 生成测试草稿',
    owner: 'AI 辅助',
    tone: 'violet',
    description: '从接口线索与测试目标出发，让想法先落成一份草稿。',
    triggers: ['手动发起'],
    result: '生成带来源信息的测试草稿。',
    handoff: '检查业务预期与副作用，修改、审核后明确发布。',
    note: '需要可用的 AI 草稿生成服务。AI 不会直接调用业务 API，也不会直接发布测试。',
    to: '/agent',
    action: '打开智能生成',
    signal: 'ai',
  },
  {
    id: 'plans',
    title: 'AI 测试计划建议',
    owner: 'AI 辅助',
    tone: 'violet',
    description: '围绕你的目标，勾勒回归的路径，也标出尚待补齐的空白。',
    triggers: ['手动发起', '资产变化'],
    result: '生成可编辑的计划草稿；开启自动建议后，测试资产变化会触发新建议。',
    handoff: '确认成员与门禁，审阅并发布；执行另行发起。',
    note: '自动建议默认关闭，需要支持计划生成的 AI 服务。变化指平台内测试资产，不是任意 GitHub 提交；分析范围有上限。',
    to: '/plans',
    action: '查看计划建议',
    signal: 'plans',
  },
  {
    id: 'setup',
    title: '准备来源与运行环境',
    owner: '人工操作',
    tone: 'amber',
    description: '选好要走的路，也安放好测试出发的环境。',
    triggers: ['手动发起'],
    result: '选择导入来源与范围，配置目标环境及所需变量。',
    handoff: '接入来源从导入中心开始；环境和变量在各自管理页配置。',
    note: '平台不会替你确定目标业务环境。存在环境配置不代表 Runner 在线或已满足全部执行条件。',
    to: '/environments',
    action: '配置执行环境',
  },
  {
    id: 'review',
    title: '审核与发布测试',
    owner: '人工操作',
    tone: 'amber',
    description: '让每份草稿经过你的推敲，再成为可执行的约定。',
    triggers: ['手动发起'],
    result: '接受、修改或拒绝草稿，检查断言与副作用，再明确发布。',
    handoff: '审核、发布、执行是独立操作；发布不会自动开始测试。',
    note: 'AI 和规则都只提供草稿。已发布版本不可修改，调整后需发布新版本。',
    to: '/cases',
    action: '前往审核用例',
  },
  {
    id: 'workflows',
    title: '编排流程与确认计划',
    owner: '人工操作',
    tone: 'amber',
    description: '把一个个接口串成业务的故事，为每一步写下预期。',
    triggers: ['手动发起'],
    result: '编排多接口步骤、变量和清理逻辑，确认计划成员及门禁。',
    handoff: '可手动组织，也可从 AI 建议开始；最终版本由你发布。',
    note: '流程编排和测试计划分别管理。运行只使用已发布版本，不能直接执行未审草稿。',
    to: '/workflows',
    action: '编排业务流程',
  },
  {
    id: 'schedules',
    title: '发起运行与管理定时规则',
    owner: '人工操作',
    tone: 'amber',
    description: '由你决定何时启程，也为下一次回归设好节奏。',
    triggers: ['定时规则', '手动发起'],
    result: '确认执行条件后发起运行；在已发布计划中保存、启停定时规则。',
    handoff: '运行开始后，系统接手执行；失败后由你查看证据并处理。',
    note: '控制面每 5 秒检查当前 UTC 分钟，同一规则每分钟最多派发一次；停机期间不补跑。请在运行报告确认实际结果。管理规则需要 maintainer 或 owner 权限。',
    to: '/plans?view=published',
    action: '管理计划与规则',
    signal: 'schedules',
  },
];
