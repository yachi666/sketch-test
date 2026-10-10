const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface HttpMetric {
  method: string;
  route: string;
  status: number;
  count: number;
  durationSeconds: number;
  buckets: number[];
}

function label(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

export class MetricsRegistry {
  private readonly startedAt = Date.now();
  private readonly dependencies = new Map<string, boolean>();

  recordDependency(name: 'postgres' | 'object-store', healthy: boolean): void {
    this.dependencies.set(name, healthy);
  }

  private readonly http = new Map<string, HttpMetric>();

  recordHttp(method: string, route: string, status: number, durationMs: number): void {
    const key = JSON.stringify([method, route, status]);
    const metric = this.http.get(key) ?? {
      method,
      route,
      status,
      count: 0,
      durationSeconds: 0,
      buckets: DURATION_BUCKETS.map(() => 0),
    };
    metric.count++;
    metric.durationSeconds += durationMs / 1000;
    DURATION_BUCKETS.forEach((bound, index) => {
      if (durationMs / 1000 <= bound) metric.buckets[index] = (metric.buckets[index] ?? 0) + 1;
    });
    this.http.set(key, metric);
  }

  render(): string {
    const lines = [
      '# HELP sketchtest_process_uptime_seconds Process uptime in seconds.',
      '# TYPE sketchtest_process_uptime_seconds gauge',
      `sketchtest_process_uptime_seconds ${(Date.now() - this.startedAt) / 1000}`,
      '# HELP sketchtest_http_requests_total HTTP responses by method, route, and status.',
      '# TYPE sketchtest_http_requests_total counter',
      '# HELP sketchtest_http_request_duration_seconds HTTP response duration.',
      '# TYPE sketchtest_http_request_duration_seconds histogram',
    ];
    lines.push(
      '# HELP sketchtest_dependency_up Dependency readiness at scrape time.',
      '# TYPE sketchtest_dependency_up gauge',
    );
    for (const [name, healthy] of this.dependencies)
      lines.push(`sketchtest_dependency_up{dependency="${name}"} ${healthy ? 1 : 0}`);
    for (const metric of [...this.http.values()].sort((a, b) =>
      `${a.method}:${a.route}:${a.status}`.localeCompare(`${b.method}:${b.route}:${b.status}`),
    )) {
      const labels = `method="${label(metric.method)}",route="${label(metric.route)}",status="${metric.status}"`;
      lines.push(`sketchtest_http_requests_total{${labels}} ${metric.count}`);
      DURATION_BUCKETS.forEach((bound, index) => {
        lines.push(
          `sketchtest_http_request_duration_seconds_bucket{${labels},le="${bound}"} ${metric.buckets[index]}`,
        );
      });
      lines.push(
        `sketchtest_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${metric.count}`,
      );
      lines.push(`sketchtest_http_request_duration_seconds_count{${labels}} ${metric.count}`);
      lines.push(
        `sketchtest_http_request_duration_seconds_sum{${labels}} ${metric.durationSeconds}`,
      );
    }
    return `${lines.join('\n')}\n`;
  }

  reset(): void {
    this.http.clear();
    this.dependencies.clear();
  }
}

export const metrics = new MetricsRegistry();
