import {
  ArrowClockwise,
  ArrowRight,
  CheckCircle,
  FileArrowUp,
  MagnifyingGlass,
  Robot,
  ShieldCheck,
  UserCircle,
  WarningCircle,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import {
  capabilities,
  capabilityGroups,
  journey,
  type Owner,
  type SignalKey,
  type Trigger,
} from './catalog';
import { useCapabilityStatus } from './useCapabilityStatus';
import './capabilities.css';

const groupIcons = { 系统自动: CheckCircle, 'AI 辅助': Robot, 人工操作: UserCircle };
const statusItems: Array<{ key: SignalKey; title: string; to: string }> = [
  { key: 'apis', title: '接口资产', to: '/apis' },
  { key: 'ai', title: 'AI 草稿生成', to: '/agent' },
  { key: 'plans', title: '计划自动建议', to: '/plans' },
  { key: 'environments', title: '执行环境', to: '/environments' },
];

export function CapabilitiesPage() {
  const workspaceId = useAuthStore((state) => state.user?.workspaceId);
  const status = useCapabilityStatus(workspaceId);
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState<Owner | ''>('');
  const [trigger, setTrigger] = useState<Trigger | ''>('');
  const visible = capabilities.filter(
    (item) =>
      (!owner || item.owner === owner) &&
      (!trigger || item.triggers.includes(trigger)) &&
      `${item.title} ${item.description} ${item.result} ${item.handoff} ${item.note}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );

  function resetFilters() {
    setQuery('');
    setOwner('');
    setTrigger('');
  }

  return (
    <main className="page-view capability-page">
      <section className="capability-intro" aria-labelledby="capability-title">
        <div>
          <span className="eyebrow">能力地图 · 每一步，皆有来处</span>
          <h1 id="capability-title">让每一次回归，都有迹可循。</h1>
          <p>系统照料重复的步骤，AI 为想法起草；方向与取舍，始终在你手中。</p>
        </div>
        <Link to="/import" className="button button--primary">
          <FileArrowUp size={18} /> 接入测试来源
        </Link>
      </section>

      <section aria-labelledby="capability-catalog-title">
        <div className="capability-section-heading">
          <h2 id="capability-catalog-title">各有所长，一路同行</h2>
          <span>系统执行、AI 建议、人工确认，各自承担清晰的一程。</span>
        </div>
        <div className="capability-filters">
          <label className="capability-search">
            <MagnifyingGlass size={18} />
            <input
              type="search"
              aria-label="搜索平台能力"
              placeholder="搜索功能、场景或关键词"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            由谁完成
            <select
              aria-label="由谁完成"
              value={owner}
              onChange={(event) => setOwner(event.target.value as Owner | '')}
            >
              <option value="">全部方式</option>
              {(['系统自动', 'AI 辅助', '人工操作'] as const).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            如何触发
            <select
              aria-label="如何触发"
              value={trigger}
              onChange={(event) => setTrigger(event.target.value as Trigger | '')}
            >
              <option value="">全部触发</option>
              {(['手动发起', '资产变化', '执行过程中', '定时规则'] as const).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="capability-result-count">
          <span role="status">
            显示 {visible.length} / {capabilities.length} 项能力
          </span>
          {(query || owner || trigger) && (
            <button className="text-button" type="button" onClick={resetFilters}>
              清除筛选
            </button>
          )}
        </div>
        <div className="capability-groups">
          {capabilityGroups.map((group) => {
            const items = visible.filter((item) => item.owner === group.owner);
            if (!items.length) return null;
            const Icon = groupIcons[group.owner];
            return (
              <section
                key={group.owner}
                className={`capability-group capability-group--${group.tone}`}
                aria-labelledby={`group-${group.tone}`}
              >
                <header className="capability-group-heading">
                  <span className="capability-group-icon">
                    <Icon size={26} weight="duotone" />
                  </span>
                  <div>
                    <h3 id={`group-${group.tone}`}>{group.title}</h3>
                    <p>{group.subtitle}</p>
                  </div>
                  <span className="capability-group-count">{items.length} 项</span>
                </header>
                <div className="capability-group-cards">
                  {items.map((item) => {
                    const signal = item.signal ? status.signal(item.signal) : undefined;
                    return (
                      <article
                        className={`capability-card capability-card--${item.tone}`}
                        key={item.id}
                        aria-labelledby={`capability-${item.id}`}
                      >
                        <div className="capability-card-heading">
                          <h4 id={`capability-${item.id}`}>{item.title}</h4>
                        </div>
                        <p className="capability-description">{item.description}</p>
                        <dl className="capability-responsibilities">
                          <div>
                            <dt>如何触发</dt>
                            <dd>{item.triggers.join(' / ')}</dd>
                          </div>
                          <div>
                            <dt>
                              {group.owner === 'AI 辅助'
                                ? 'AI 产出'
                                : group.owner === '人工操作'
                                  ? '操作内容'
                                  : '系统完成'}
                            </dt>
                            <dd>{item.result}</dd>
                          </div>
                          <div>
                            <dt>{group.owner === '人工操作' ? '操作衔接' : '需要你做'}</dt>
                            <dd>{item.handoff}</dd>
                          </div>
                        </dl>
                        <details>
                          <summary>使用条件与边界</summary>
                          <p>{item.note}</p>
                        </details>
                        <footer>
                          {signal ? (
                            <span className={`capability-signal capability-signal--${signal.tone}`}>
                              {signal.label}
                            </span>
                          ) : (
                            <span className="capability-signal">按当前角色权限操作</span>
                          )}
                          <Link to={item.to}>
                            {item.action}
                            <ArrowRight size={16} />
                          </Link>
                        </footer>
                        {item.id === 'schedules' && (
                          <p className="capability-schedule-note">
                            <WarningCircle size={16} /> 按 UTC
                            定时派发；实际运行结果以报告为准，停机期间不补跑。
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
                <p className="capability-group-boundary">
                  <ShieldCheck size={16} />
                  {group.boundary}
                </p>
              </section>
            );
          })}
        </div>
        {!visible.length && (
          <div className="capability-empty">
            <MagnifyingGlass size={30} />
            <h3>没有匹配的能力</h3>
            <p>试试“草稿”“证据”，或清除条件查看全部功能。</p>
            <button type="button" className="button button--secondary" onClick={resetFilters}>
              查看全部能力
            </button>
          </div>
        )}
      </section>
      <section className="capability-journey" aria-label="从一个接口，走向一份有据可依的结论">
        <div className="capability-section-heading">
          <h2>从一个接口，走向一份有据可依的结论</h2>
          <span>从你需要的那一步开始</span>
        </div>
        <ol>
          {journey.map((step, index) => (
            <li key={step.title}>
              <Link to={step.to}>
                <span className="capability-step-number">0{index + 1}</span>
                <strong>{step.title}</strong>
                <small>{step.caption}</small>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ol>
        <p className="capability-principle">
          <ShieldCheck size={18} /> AI 与规则先生成草稿；审核、发布、执行，由你分别确认。
        </p>
      </section>

      <section
        className="capability-workspace"
        aria-labelledby="capability-workspace-title"
        aria-busy={status.loading}
      >
        <div className="capability-section-heading">
          <h2 id="capability-workspace-title">当前工作区</h2>
          <div className="capability-refresh">
            <span>
              {status.updatedAt
                ? `更新于 ${status.updatedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
                : '状态来自当前工作区'}
            </span>
            <button
              type="button"
              className="text-button"
              disabled={status.loading || !workspaceId}
              onClick={status.refresh}
            >
              <ArrowClockwise size={15} /> 刷新状态
            </button>
          </div>
        </div>
        {status.hasError && (
          <p className="capability-status-warning" role="status">
            <WarningCircle size={17} />{' '}
            部分状态暂时无法读取，已显示为未知；你仍可浏览功能和操作入口。
          </p>
        )}
        <div className="capability-status-grid">
          {statusItems.map((item) => {
            const signal = status.signal(item.key);
            return (
              <Link to={item.to} className="capability-status-tile" key={item.key}>
                <span>
                  {item.title}
                  <ArrowRight size={15} />
                </span>
                <strong className={`capability-signal--${signal.tone}`}>{signal.label}</strong>
                <small>{signal.detail}</small>
              </Link>
            );
          })}
        </div>
      </section>

      <aside className="capability-closing">
        <ShieldCheck size={20} />
        <div>
          <strong>每一步有来处，每个结论有回声。</strong>
          <p>想法从草稿开始，经审阅定稿；运行留下脱敏证据，让每一次追问，都能回到具体的一步。</p>
        </div>
        <Link to="/reports">
          查看运行证据
          <ArrowRight size={16} />
        </Link>
      </aside>
    </main>
  );
}
