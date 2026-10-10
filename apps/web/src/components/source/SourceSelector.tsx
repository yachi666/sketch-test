import { Database, Gear } from '@phosphor-icons/react';
import type { ApiSource } from '../../types';

interface SourceSelectorProps {
  sources: ApiSource[];
  selectedSourceId: string | null;
  onSelect: (sourceId: string | null) => void;
  onManage: () => void;
}

export function SourceSelector({
  sources,
  selectedSourceId,
  onSelect,
  onManage,
}: SourceSelectorProps) {
  return (
    <div className="source-selector">
      <Database size={16} weight="fill" />
      <select
        className="source-select"
        value={selectedSourceId ?? ''}
        onChange={(e) => onSelect(e.target.value || null)}
        aria-label="选择 API 系统"
      >
        <option value="">全部系统 ({sources.length} 个)</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.sourceLabel})
          </option>
        ))}
      </select>
      <button
        className="source-manage-btn"
        type="button"
        onClick={onManage}
        title="管理系统"
        aria-label="管理系统"
      >
        <Gear size={15} />
      </button>
    </div>
  );
}
