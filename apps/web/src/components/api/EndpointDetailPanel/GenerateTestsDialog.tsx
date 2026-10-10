import { CheckCircle, SpinnerGap, X } from '@phosphor-icons/react';
import { useState } from 'react';

export type GenerationStrategy = 'example' | 'schema' | 'status-codes';

interface GenerateTestsDialogProps {
  onGenerate: (strategy: GenerationStrategy) => Promise<void>;
  onClose: () => void;
}

const strategies: Array<{ value: GenerationStrategy; title: string; description: string }> = [
  {
    value: 'schema',
    title: 'Schema 覆盖',
    description: '生成正向、必填项缺失、类型错误和边界值草稿。',
  },
  {
    value: 'example',
    title: '示例优先',
    description: '依据接口定义中的请求示例生成可审核的草稿。',
  },
  { value: 'status-codes', title: '状态码覆盖', description: '围绕接口声明的响应状态码生成草稿。' },
];

export function GenerateTestsDialog({ onGenerate, onClose }: GenerateTestsDialogProps) {
  const [strategy, setStrategy] = useState<GenerationStrategy>('schema');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onGenerate(strategy);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法创建生成任务');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="endpoint-definition-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        className="endpoint-generation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="从接口生成用例"
      >
        <header className="endpoint-definition-header">
          <div>
            <span className="eyebrow">GENERATED DRAFTS</span>
            <h3>
              <CheckCircle size={18} /> 从接口生成用例
            </h3>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="关闭生成用例"
          >
            <X size={18} />
          </button>
        </header>
        <p className="endpoint-generation-intro">
          生成内容会以草稿进入用例管理，审核后才会创建 TestCaseVersion。
        </p>
        <div className="endpoint-generation-options">
          {strategies.map((item) => (
            <label
              className={`endpoint-generation-option${strategy === item.value ? ' is-selected' : ''}`}
              key={item.value}
            >
              <input
                type="radio"
                name="strategy"
                value={item.value}
                checked={strategy === item.value}
                onChange={() => setStrategy(item.value)}
                disabled={submitting}
              />
              <span>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
            </label>
          ))}
        </div>
        {error ? <p className="endpoint-definition-error">{error}</p> : null}
        <footer className="endpoint-generation-actions">
          <button
            className="button button--ghost"
            type="button"
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
          >
            {submitting ? (
              <SpinnerGap size={16} className="import-center__spinner" />
            ) : (
              <CheckCircle size={16} />
            )}
            创建草稿
          </button>
        </footer>
      </section>
    </div>
  );
}
