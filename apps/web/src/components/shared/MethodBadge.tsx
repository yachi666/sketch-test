import type { HttpMethod } from '@sketch-test/contracts-common';

interface MethodBadgeProps {
  method: HttpMethod;
  /** Whether to show a smaller variant. */
  compact?: boolean;
}

const METHOD_LABELS: Record<string, string> = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DEL',
  HEAD: 'HEAD',
  OPTIONS: 'OPT',
};

export function MethodBadge({ method, compact = false }: MethodBadgeProps) {
  const label = compact ? (METHOD_LABELS[method] ?? method) : method;
  return (
    <em className={`method method--${method.toLowerCase()}${compact ? ' method--compact' : ''}`}>
      {label}
    </em>
  );
}
