import { useCallback, useEffect, useState } from 'react';
import { type ApiVersionSummary, cpClient } from '../lib/cp-client';

/** Load immutable ApiVersions directly from the Control Plane. */
export function useApiVersions() {
  const [data, setData] = useState<ApiVersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await cpClient.listApiVersions();
      setData(response.apiVersions);
    } catch (cause) {
      setData([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
