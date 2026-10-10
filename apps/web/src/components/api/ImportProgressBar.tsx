interface ImportProgressBarProps {
  current: number;
  total: number;
  phase: string; // e.g. '解析端点', '提取 Schema', '转换断言'
  currentItem?: string; // e.g. 'POST /api/orders'
}

/**
 * A deterministic progress bar that shows import processing progress.
 * Uses the native <progress> element with percentage text and phase label.
 * Renders null when total is 0.
 */
export function ImportProgressBar({ current, total, phase, currentItem }: ImportProgressBarProps) {
  if (total === 0) return null;

  const percentage = Math.round((current / total) * 100);

  return (
    <div className="import-progress-bar">
      <div className="import-progress-header">
        <span className="import-progress-phase">{phase}</span>
        <span className="import-progress-percentage">{percentage}%</span>
      </div>
      <progress
        className="import-progress-track"
        value={current}
        max={total}
        aria-label={`${phase}: ${percentage}%`}
      />
      {currentItem && <span className="import-progress-item">{currentItem}</span>}
    </div>
  );
}
