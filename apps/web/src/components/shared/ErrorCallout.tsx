import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';

interface ErrorCalloutProps {
  title: string;
  message: string;
  onRetry?: () => void | Promise<void>;
  retryLabel?: string;
}

/** A compact, recoverable error state for page-level requests. */
export function ErrorCallout({ title, message, onRetry, retryLabel = '重试' }: ErrorCalloutProps) {
  return (
    <section className="error-callout" role="alert" aria-live="assertive">
      <WarningCircle aria-hidden="true" className="error-callout__icon" size={24} weight="fill" />
      <div className="error-callout__content">
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {onRetry ? (
        <button
          className="button button--outline button--sm error-callout__action"
          type="button"
          onClick={() => void onRetry()}
        >
          <ArrowClockwise aria-hidden="true" size={15} />
          {retryLabel}
        </button>
      ) : null}
    </section>
  );
}
