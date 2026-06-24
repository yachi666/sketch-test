import {
  ArrowDown,
  ArrowUp,
  CaretUpDown,
  CheckSquare,
  MagnifyingGlass,
  PencilSimple,
  Square,
  Trash,
  Warning,
  X,
} from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import type { ApiEndpoint, ApiVersionInfo } from '../../types';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { MethodBadge } from '../shared/MethodBadge';
import { SearchField } from '../shared/SearchField';

// ─── Types ───────────────────────────────────────────────────────

type SortKey = 'method' | 'path' | 'coverage' | 'cases' | 'updatedAt';
type SortDir = 'asc' | 'desc';

interface ApiTableProps {
  endpoints: ApiEndpoint[];
  activeVersion: ApiVersionInfo | null;
  onViewDetail: (endpointId: string) => void;
  onEdit: (endpointId: string) => void;
  onDelete?: (endpointId: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────

const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function methodSortIndex(m: string): number {
  const i = METHOD_ORDER.indexOf(m.toUpperCase());
  return i === -1 ? METHOD_ORDER.length : i;
}

function coverageLevel(pct: number): 'high' | 'medium' | 'low' {
  if (pct >= 90) return 'high';
  if (pct >= 60) return 'medium';
  return 'low';
}

/** Format ISO timestamp as relative time (中文), e.g. "3 天前", "刚刚". */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  return `${months} 个月前`;
}

// ─── Component ───────────────────────────────────────────────────

/**
 * API catalog table — redesigned with inline filters, column sorting,
 * interactive stats bar, and improved visual hierarchy.
 *
 * Design principles:
 * - Method + Path is the primary visual anchor
 * - Filters are visible inline (not hidden in dropdown)
 * - Stats double as quick-filter chips
 * - Row actions are revealed on hover to reduce visual noise
 * - Coverage is shown as a colored progress bar with percentage
 */
export function ApiTable({
  endpoints,
  activeVersion,
  onViewDetail,
  onEdit,
  onDelete,
}: ApiTableProps) {
  // ── Filter state ──
  const [query, setQuery] = useState('');
  const [activeMethod, setActiveMethod] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [coverageRange, setCoverageRange] = useState<[number, number]>([0, 100]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // ── Sort state ──
  const [sortKey, setSortKey] = useState<SortKey>('path');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // ── Selection state ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Delete state ──
  const [deleteTarget, setDeleteTarget] = useState<ApiEndpoint | null>(null);

  // ── Derived data ──
  const methods = useMemo(() => [...new Set(endpoints.map((ep) => ep.method))].sort(), [endpoints]);
  const tags = useMemo(() => [...new Set(endpoints.flatMap((ep) => ep.tags))].sort(), [endpoints]);

  // Method distribution for stats chips
  const methodCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ep of endpoints) {
      counts[ep.method] = (counts[ep.method] || 0) + 1;
    }
    return counts;
  }, [endpoints]);

  // Coverage distribution
  const coverageBuckets = useMemo(() => {
    let high = 0;
    let medium = 0;
    let low = 0;
    for (const ep of endpoints) {
      const level = coverageLevel(ep.coverage);
      if (level === 'high') high++;
      else if (level === 'medium') medium++;
      else low++;
    }
    return { high, medium, low };
  }, [endpoints]);

  // ── Filter + Sort ──
  const filtered = useMemo(() => {
    let result = endpoints.filter((ep) => {
      if (activeMethod && ep.method !== activeMethod) return false;
      if (activeTag && !ep.tags.includes(activeTag)) return false;
      if (ep.coverage < coverageRange[0] || ep.coverage > coverageRange[1]) return false;
      const q = query.toLowerCase();
      if (
        q &&
        !`${ep.method} ${ep.path} ${ep.summary} ${ep.tags.join(' ')}`.toLowerCase().includes(q)
      )
        return false;
      return true;
    });

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'method':
          cmp = methodSortIndex(a.method) - methodSortIndex(b.method);
          break;
        case 'path':
          cmp = a.path.localeCompare(b.path);
          break;
        case 'coverage':
          cmp = a.coverage - b.coverage;
          break;
        case 'cases':
          cmp = a.cases - b.cases;
          break;
        case 'updatedAt':
          cmp = (a.updatedAt || '').localeCompare(b.updatedAt || '');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [endpoints, query, activeMethod, activeTag, coverageRange, sortKey, sortDir]);

  // ── Stats ──
  const totalEndpoints = endpoints.length;
  const avgCoverage =
    totalEndpoints > 0
      ? Math.round(endpoints.reduce((sum, ep) => sum + ep.coverage, 0) / totalEndpoints)
      : 0;

  const hasActiveFilters =
    activeMethod !== null || activeTag !== null || coverageRange[0] > 0 || coverageRange[1] < 100;

  // ── Handlers ──

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((ep) => ep.id)));
    }
  };

  const handleSelectOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleClearFilters = () => {
    setActiveMethod(null);
    setActiveTag(null);
    setCoverageRange([0, 100]);
    setQuery('');
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <CaretUpDown size={12} weight="light" />;
    return sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  // ── Render ──

  return (
    <section className="api-catalog-v2">
      {/* ── Stats bar: interactive quick-filter chips ── */}
      <div className="ac2-stats-bar">
        <button
          type="button"
          className={`ac2-stat-chip${!hasActiveFilters ? ' active' : ''}`}
          onClick={handleClearFilters}
          title="显示全部接口"
        >
          <strong>{totalEndpoints}</strong>
          <span>接口总数</span>
        </button>

        <button
          type="button"
          className="ac2-stat-chip"
          onClick={() => {
            setActiveMethod(null);
            setActiveTag(null);
            setCoverageRange([90, 100]);
          }}
          title="筛选高覆盖率接口 (≥90%)"
        >
          <strong>{avgCoverage}%</strong>
          <span>平均覆盖率</span>
        </button>

        {METHOD_ORDER.filter((m) => methodCounts[m]).map((method) => (
          <button
            key={method}
            type="button"
            className={`ac2-stat-chip ac2-stat-chip--method${activeMethod === method ? ' active' : ''}`}
            onClick={() => setActiveMethod(activeMethod === method ? null : method)}
          >
            <strong className={`method method--${method.toLowerCase()} method--compact`}>
              {method}
            </strong>
            <span>{methodCounts[method]} 个</span>
          </button>
        ))}

        {coverageBuckets.low > 0 && (
          <button
            type="button"
            className={`ac2-stat-chip ac2-stat-chip--coverage-low${coverageRange[1] < 60 ? ' active' : ''}`}
            onClick={() => setCoverageRange([0, 59])}
            title="筛选低覆盖率接口 (<60%)"
          >
            <span className="ac2-coverage-dot low" />
            <strong>{coverageBuckets.low}</strong>
            <span>待完善</span>
          </button>
        )}

        {activeVersion ? (
          <div className="ac2-stat-chip ac2-stat-chip--version" title="当前活跃版本">
            <strong>
              <span className="ac2-version-file">{activeVersion.fileName}</span>
              <span className="ac2-version-sep">·</span>
              <span className="ac2-version-num">v{activeVersion.version}</span>
            </strong>
            <span>当前版本</span>
          </div>
        ) : null}
      </div>

      {/* ── Toolbar: search + inline filters + sort + count ── */}
      <div className="ac2-toolbar">
        <div className="ac2-toolbar-left">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="搜索方法、路径、摘要或标签…"
          />

          {/* Inline method filter chips */}
          <div className="ac2-filter-chips">
            <button
              type="button"
              className={`ac2-chip${activeMethod === null ? ' active' : ''}`}
              onClick={() => setActiveMethod(null)}
            >
              全部方法
            </button>
            {methods.map((m) => (
              <button
                key={m}
                type="button"
                className={`ac2-chip${activeMethod === m ? ' active' : ''}`}
                onClick={() => setActiveMethod(activeMethod === m ? null : m)}
              >
                <em className={`method method--${m.toLowerCase()} method--compact`}>{m}</em>
              </button>
            ))}
          </div>

          {/* Inline tag filter chips (collapsible when many) */}
          {tags.length > 0 && (
            <div className="ac2-filter-chips">
              <button
                type="button"
                className={`ac2-chip${activeTag === null ? ' active' : ''}`}
                onClick={() => setActiveTag(null)}
              >
                全部标签
              </button>
              {tags.slice(0, 8).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`ac2-chip${activeTag === tag ? ' active' : ''}`}
                  onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                >
                  {tag}
                </button>
              ))}
              {tags.length > 8 && (
                <button
                  type="button"
                  className="ac2-chip ac2-chip--more"
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                >
                  +{tags.length - 8} 更多
                </button>
              )}
            </div>
          )}

          {/* Expanded tag list */}
          {showAdvancedFilters && tags.length > 8 && (
            <div className="ac2-filter-chips ac2-filter-chips--expanded">
              {tags.slice(8).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`ac2-chip${activeTag === tag ? ' active' : ''}`}
                  onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {/* Advanced: coverage range */}
          {showAdvancedFilters && (
            <div className="ac2-advanced-filters">
              <span className="ac2-filter-label">覆盖率范围</span>
              <div className="ac2-range-row">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={coverageRange[0]}
                  onChange={(e) => setCoverageRange([Number(e.target.value), coverageRange[1]])}
                  aria-label="最小覆盖率"
                />
                <span className="ac2-range-value">
                  {coverageRange[0]}% – {coverageRange[1]}%
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={coverageRange[1]}
                  onChange={(e) => setCoverageRange([coverageRange[0], Number(e.target.value)])}
                  aria-label="最大覆盖率"
                />
              </div>
            </div>
          )}
        </div>

        <div className="ac2-toolbar-right">
          {/* Clear filters */}
          {hasActiveFilters && (
            <button type="button" className="ac2-chip ac2-chip--clear" onClick={handleClearFilters}>
              <X size={12} />
              清除筛选
            </button>
          )}

          {/* Result count */}
          <span className="ac2-result-count">
            {filtered.length === endpoints.length
              ? `${endpoints.length} 个接口`
              : `${filtered.length} / ${endpoints.length} 个接口`}
          </span>

          {/* Advanced toggle */}
          <button
            type="button"
            className={`ac2-chip ac2-chip--toggle${showAdvancedFilters ? ' active' : ''}`}
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            title="高级筛选"
          >
            {showAdvancedFilters ? '收起筛选' : '高级筛选'}
          </button>
        </div>
      </div>

      {/* ── Bulk action bar (visible when rows selected) ── */}
      {selectedIds.size > 0 && (
        <div className="ac2-bulk-bar">
          <span className="ac2-bulk-label">已选择 {selectedIds.size} 个接口</span>
          <span className="ac2-bulk-spacer" />
          <button
            type="button"
            className="ac2-chip ac2-chip--clear"
            onClick={() => setSelectedIds(new Set())}
          >
            <X size={12} />
            取消选择
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="ac2-table-wrapper">
        <div className="ac2-table">
          {/* Header */}
          <div className="ac2-row ac2-row--head">
            <span className="ac2-col-check">
              <button
                type="button"
                className="ac2-checkbox-btn"
                aria-label={selectedIds.size === filtered.length ? '取消全选' : '全选'}
                onClick={handleSelectAll}
              >
                {selectedIds.size === filtered.length && filtered.length > 0 ? (
                  <CheckSquare size={16} weight="fill" />
                ) : (
                  <Square size={16} />
                )}
              </button>
            </span>
            <span className="ac2-col-method">
              <button type="button" className="ac2-sort-btn" onClick={() => handleSort('method')}>
                方法 <SortIcon column="method" />
              </button>
            </span>
            <span className="ac2-col-path">
              <button type="button" className="ac2-sort-btn" onClick={() => handleSort('path')}>
                路径与摘要 <SortIcon column="path" />
              </button>
            </span>
            <span className="ac2-col-tags">标签</span>
            <span className="ac2-col-coverage">
              <button type="button" className="ac2-sort-btn" onClick={() => handleSort('coverage')}>
                覆盖率 <SortIcon column="coverage" />
              </button>
            </span>
            <span className="ac2-col-cases">
              <button type="button" className="ac2-sort-btn" onClick={() => handleSort('cases')}>
                用例 <SortIcon column="cases" />
              </button>
            </span>
            <span className="ac2-col-updated">
              <button
                type="button"
                className="ac2-sort-btn"
                onClick={() => handleSort('updatedAt')}
              >
                更新时间 <SortIcon column="updatedAt" />
              </button>
            </span>
            <span className="ac2-col-actions">操作</span>
          </div>

          {/* Empty state */}
          {filtered.length === 0 ? (
            <div className="ac2-empty">
              <MagnifyingGlass size={32} weight="light" />
              <p>未找到匹配的接口</p>
              <span>尝试调整搜索条件或筛选器</span>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="ac2-chip ac2-chip--clear"
                  onClick={handleClearFilters}
                  style={{ marginTop: 12 }}
                >
                  <X size={14} />
                  清除所有筛选
                </button>
              )}
            </div>
          ) : (
            /* Rows */
            filtered.map((api) => {
              const level = coverageLevel(api.coverage);
              const isSelected = selectedIds.has(api.id);

              return (
                <div
                  className={`ac2-row${isSelected ? ' selected' : ''}${api.deprecated ? ' deprecated' : ''}`}
                  key={api.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看 ${api.method} ${api.path} 详情${api.deprecated ? '（已弃用）' : ''}`}
                  onClick={() => onViewDetail(api.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onViewDetail(api.id);
                    }
                  }}
                >
                  {/* Checkbox */}
                  <span className="ac2-col-check">
                    <button
                      type="button"
                      className="ac2-checkbox-btn"
                      aria-label={`${isSelected ? '取消选择' : '选择'} ${api.path}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectOne(api.id);
                      }}
                    >
                      {isSelected ? <CheckSquare size={16} weight="fill" /> : <Square size={16} />}
                    </button>
                  </span>

                  {/* Method + deprecated badge */}
                  <span className="ac2-col-method">
                    <MethodBadge method={api.method} />
                    {api.deprecated && (
                      <span className="ac2-deprecated-badge" title="此接口已弃用">
                        <Warning size={10} weight="fill" />
                      </span>
                    )}
                  </span>

                  {/* Path + Summary */}
                  <span className="ac2-col-path">
                    <code className="ac2-path">{api.path}</code>
                    {api.summary && <span className="ac2-summary">{api.summary}</span>}
                  </span>

                  {/* Tags */}
                  <span className="ac2-col-tags">
                    <span className="ac2-tag-list">
                      {api.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className={`ac2-tag${activeTag === tag ? ' active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveTag(activeTag === tag ? null : tag);
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter' || ev.key === ' ') {
                              ev.preventDefault();
                              ev.stopPropagation();
                              setActiveTag(activeTag === tag ? null : tag);
                            }
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                      {api.tags.length > 3 && (
                        <span className="ac2-tag ac2-tag--more">+{api.tags.length - 3}</span>
                      )}
                    </span>
                  </span>

                  {/* Coverage bar */}
                  <span className="ac2-col-coverage">
                    <span className={`ac2-coverage-bar ac2-coverage--${level}`}>
                      <span className="ac2-coverage-fill" style={{ width: `${api.coverage}%` }} />
                    </span>
                    <span className={`ac2-coverage-pct${level === 'low' ? ' low' : ''}`}>
                      {api.coverage}%
                    </span>
                    {api.cases > 0 && <span className="ac2-coverage-cases">{api.cases} 用例</span>}
                  </span>

                  {/* Test cases count */}
                  <span className="ac2-col-cases">
                    {api.cases > 0 ? (
                      <strong>{api.cases}</strong>
                    ) : (
                      <span className="ac2-muted">—</span>
                    )}
                  </span>

                  {/* Last updated */}
                  <span className="ac2-col-updated">
                    {api.updatedAt ? (
                      <time dateTime={api.updatedAt} title={api.updatedAt}>
                        {relativeTime(api.updatedAt)}
                      </time>
                    ) : (
                      <span className="ac2-muted">—</span>
                    )}
                  </span>

                  {/* Actions — visible on row hover */}
                  <span className="ac2-col-actions">
                    <button
                      className="ac2-action-btn"
                      type="button"
                      aria-label={`编辑 ${api.path}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(api.id);
                      }}
                    >
                      <PencilSimple size={15} />
                    </button>
                    {onDelete && (
                      <button
                        className="ac2-action-btn ac2-action-btn--danger"
                        type="button"
                        aria-label={`删除 ${api.path}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(api);
                        }}
                      >
                        <Trash size={15} />
                      </button>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Confirm dialog for delete ── */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除接口"
        message={
          deleteTarget
            ? `确定要删除接口 ${deleteTarget.method} ${deleteTarget.path} 吗？此操作不可撤销。`
            : ''
        }
        variant="danger"
        confirmLabel="删除"
        onConfirm={() => {
          if (deleteTarget) onDelete?.(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
