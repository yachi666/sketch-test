import { create } from 'zustand';

export const catalog = {
  OpenAI: ['gpt-5.6', 'gpt-5.6-mini'],
  '智谱 AI': ['glm-example', 'glm-flash-example'],
  DeepSeek: ['deepseek-example'],
};
export const initialAgents = [
  {
    id: 'ag_contract',
    avatar: 'contract',
    name: '契约用例 Agent',
    provider: 'OpenAI',
    model: 'gpt-5.6',
    connection: 'conn_openai',
    role: '基于接口契约生成正常、边界与异常用例，引用来源证据。',
    capability: '用例生成',
    version: 3,
    enabled: true,
    timeout: 60,
    retries: 2,
    default: true,
  },
  {
    id: 'ag_chinese',
    avatar: 'language',
    name: '中文场景 Agent',
    provider: '智谱 AI',
    model: 'glm-example',
    connection: 'conn_glm',
    role: '根据中文业务描述生成测试场景，明确前置条件与断言依据。',
    capability: '用例生成',
    version: 2,
    enabled: true,
    timeout: 60,
    retries: 2,
  },
  {
    id: 'ag_plan',
    avatar: 'plan',
    name: '测试计划 Agent',
    provider: 'OpenAI',
    model: 'gpt-5.6',
    connection: 'conn_openai',
    role: '基于已发布资产组织测试计划，并标记覆盖缺口。',
    capability: '测试计划',
    version: 1,
    enabled: true,
    timeout: 90,
    retries: 1,
  },
];
export const names = [
  '正常创建订单',
  '缺少必填字段',
  '订单状态非法',
  '库存不足',
  '重复提交订单',
  '商品不存在',
];
export const baseDefinition = { sku: 'SKU-1024', quantity: 1 };
const seedTrace = {
  id: 'gen_1042',
  agent: { ...initialAgents[0] },
  date: '2026-10-10 10:42',
  attempt: 1,
  duration: '18.4',
  inputTokens: 2180,
  outputTokens: 1240,
  source: 'ApiVersion v12',
  template: 'v2.1',
  status: 'completed',
  objective: '覆盖正常创建、必填字段缺失与非法订单状态。',
  count: 6,
};
export const useStore = create((set, get) => ({
  page: 'agents',
  selectedAgent: 'ag_contract',
  agents: initialAgents,
  versions: Object.fromEntries(initialAgents.map((a) => [a.id, [{ ...a }]])),
  connections: [
    { id: 'conn_openai', name: '团队 OpenAI', provider: 'OpenAI', status: '已验证' },
    { id: 'conn_glm', name: '智谱工作区', provider: '智谱 AI', status: '已验证' },
  ],
  traces: [seedTrace],
  drafts: [],
  selectedCase: 'tc_0086',
  cases: [
    {
      id: 'tc_0086',
      name: names[0],
      version: 2,
      status: 'published',
      traceId: seedTrace.id,
      edited: true,
      definition: JSON.stringify(baseDefinition, null, 2),
      expected: '201',
    },
  ],
  activeGeneration: null,
  toast: '',
  notify: (toast) => {
    set({ toast });
    setTimeout(() => {
      if (get().toast === toast) set({ toast: '' });
    }, 4000);
  },
  navigate: (page) => set({ page }),
  selectAgent: (selectedAgent) => set({ selectedAgent }),
  saveAgent: (config) => {
    const old = get().agents.find((a) => a.id === config.id);
    const next = { ...config, version: old ? old.version + 1 : 1 };
    set((s) => ({
      agents: old ? s.agents.map((a) => (a.id === next.id ? next : a)) : [...s.agents, next],
      versions: { ...s.versions, [next.id]: [...(s.versions[next.id] || []), next] },
      selectedAgent: next.id,
    }));
    get().notify(`${next.name} 已保存为 v${next.version}`);
  },
  addConnection: (connection) => set((s) => ({ connections: [...s.connections, connection] })),
  startGeneration: (agentId, objective) => {
    if (get().activeGeneration?.running) return;
    const agent = get().agents.find(
      (a) => a.id === agentId && a.enabled && a.capability === '用例生成',
    );
    if (!agent) return;
    const id = `gen_${1043 + get().traces.length - 1}`;
    const trace = {
      ...seedTrace,
      id,
      agent: { ...agent },
      objective,
      date: '2026-10-10 15:10',
      status: 'completed',
    };
    set({ activeGeneration: { id, agent: { ...agent }, objective, stage: 0, running: true } });
    [1, 2, 3].forEach((stage, i) => {
      setTimeout(
        () => {
          if (get().activeGeneration?.id !== id || !get().activeGeneration.running) return;
          if (stage < 3) set((s) => ({ activeGeneration: { ...s.activeGeneration, stage } }));
          else
            set((s) => ({
              traces: [trace, ...s.traces],
              drafts: [
                ...s.drafts,
                ...names.map((name, j) => ({
                  id: `${id}_draft_${j + 1}`,
                  name,
                  traceId: id,
                  definition: JSON.stringify(baseDefinition, null, 2),
                  expected: j === 0 ? '201' : '400',
                  status: 'pending',
                })),
              ],
              activeGeneration: { ...s.activeGeneration, stage: 3, running: false },
            }));
        },
        (i + 1) * 1200,
      );
    });
  },
  cancelGeneration: () => set({ activeGeneration: null }),
  reviewDraft: (id, accepted) => {
    const draft = get().drafts.find((d) => d.id === id);
    if (!draft) return;
    const caseId = `tc_${get().cases.length + 87}`;
    set((s) => ({
      drafts: s.drafts.map((d) =>
        d.id === id ? { ...d, status: accepted ? 'accepted' : 'rejected' } : d,
      ),
      cases: accepted
        ? [...s.cases, { ...draft, id: caseId, status: 'draft', version: 0, edited: false }]
        : s.cases,
      selectedCase: accepted ? caseId : s.selectedCase,
    }));
    get().notify(accepted ? '已接受为用例草稿，审核后可单独发布' : '已拒绝此生成草稿');
  },
  selectCase: (selectedCase) => set({ selectedCase }),
  saveCase: (id, definition, expected) =>
    set((s) => ({
      cases: s.cases.map((c) => (c.id === id ? { ...c, definition, expected, edited: true } : c)),
    })),
  editPublished: (id) => {
    const old = get().cases.find((c) => c.id === id);
    if (!old) return;
    const copy = { ...old, id: `${id}_draft`, parentId: old.id, status: 'draft' };
    set((s) => ({
      cases: [...s.cases.filter((c) => c.id !== copy.id), copy],
      selectedCase: copy.id,
    }));
  },
  publishCase: (id) => {
    set((s) => ({
      cases: s.cases.map((c) =>
        c.id === id ? { ...c, version: c.version + 1, status: 'published' } : c,
      ),
    }));
    get().notify('用例版本已发布，生成来源已保留');
  },
}));
