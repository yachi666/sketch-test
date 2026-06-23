import { Check, SlidersHorizontal, X } from '@phosphor-icons/react';
import { useState, useRef, useEffect } from 'react';
import type { HttpMethod } from '@sketch-test/contracts-common';

interface FilterDropdownProps {
  /** All unique HTTP methods among endpoints. */
  methods: string[];
  /** All unique tags among endpoints. */
  tags: string[];
  /** Currently active method filter. */
  activeMethod: string | null;
  /** Currently active tag filter. */
  activeTag: string | null;
  /** Coverage range filter: [min, max]. */
  coverageRange: [number, number];
  onMethodChange: (method: string | null) => void;
  onTagChange: (tag: string | null) => void;
  onCoverageChange: (range: [number, number]) => void;
}

/**
 * Dropdown filter panel for the API catalog table.
 * Filters by HTTP method, tag, and coverage range.
 */
export function FilterDropdown({
  methods,
  tags,
  activeMethod,
  activeTag,
  coverageRange,
  onMethodChange,
  onTagChange,
  onCoverageChange,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const hasActiveFilters =
    activeMethod !== null || activeTag !== null || coverageRange[0] > 0 || coverageRange[1] < 100;

  return (
    <div className="filter-dropdown" ref={containerRef}>
      <button
        className={`button button--outline${hasActiveFilters ? ' button--active-filter' : ''}`}
        type="button"
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal size={17} />
        筛选
        {hasActiveFilters ? <span className="filter-dot" /> : null}
      </button>

      {open ? (
        <div className="filter-panel">
          {/* Method filter */}
          <div className="filter-section">
            <span className="filter-label">HTTP 方法</span>
            <div className="filter-chips">
              <button
                type="button"
                className={`filter-chip${activeMethod === null ? ' active' : ''}`}
                onClick={() => onMethodChange(null)}
              >
                全部
              </button>
              {methods.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`filter-chip${activeMethod === m ? ' active' : ''}`}
                  onClick={() => onMethodChange(activeMethod === m ? null : m)}
                >
                  <em className={`method method--${m.toLowerCase()} method--compact`}>{m}</em>
                </button>
              ))}
            </div>
          </div>

          {/* Tag filter */}
          <div className="filter-section">
            <span className="filter-label">标签</span>
            <div className="filter-chips">
              <button
                type="button"
                className={`filter-chip${activeTag === null ? ' active' : ''}`}
                onClick={() => onTagChange(null)}
              >
                全部
              </button>
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`filter-chip${activeTag === tag ? ' active' : ''}`}
                  onClick={() => onTagChange(activeTag === tag ? null : tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Coverage range filter */}
          <div className="filter-section">
            <span className="filter-label">
              覆盖率: {coverageRange[0]}% – {coverageRange[1]}%
            </span>
            <div className="filter-range">
              <input
                type="range"
                min={0}
                max={100}
                value={coverageRange[0]}
                onChange={(e) => onCoverageChange([Number(e.target.value), coverageRange[1]])}
                aria-label="最小覆盖率"
              />
              <input
                type="range"
                min={0}
                max={100}
                value={coverageRange[1]}
                onChange={(e) => onCoverageChange([coverageRange[0], Number(e.target.value)])}
                aria-label="最大覆盖率"
              />
            </div>
            <div className="filter-range-labels">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Reset */}
          {hasActiveFilters ? (
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => {
                onMethodChange(null);
                onTagChange(null);
                onCoverageChange([0, 100]);
              }}
            >
              <X size={14} />
              清除筛选
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
