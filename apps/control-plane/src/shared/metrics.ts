interface HttpMetric {
  method: string;
  route: string;
  status: number;
  count: number;
  durationSeconds: number;
}

function label(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

export class MetricsRegistry {
  private readonly startedAt = Date.now();
  private readonly http = new Map<string, HttpMetric>();

  recordHttp(method: string, route: string, status: number, durationMs: number): void {
    const key = JSON.stringify([method, route, status]);
    const metric = this.http.get(key) ?? {
      method,
      route,
      status,
      count: 0,
      durationSeconds: 0,
    };
    metric.count++;
    metric.durationSeconds += durationMs / 1000;
    this.http.set(key, metric);
  }

  render(): string {
    const lines = [
      '# HELP sketchtest_process_uptime_seconds Process uptime in seconds.',
      '# TYPE sketchtest_process_uptime_seconds gauge',
      `sketchtest_process_uptime_seconds ${(Date.now() - this.startedAt) / 1000}`,
      '# HELP sketchtest_http_requests_total HTTP responses by method, route, and status.',
      '# TYPE sketchtest_http_requests_total counter',
      '# HELP sketchtest_http_request_duration_seconds_sum Cumulative HTTP response duration.',
      '# TYPE sketchtest_http_request_duration_seconds_sum counter',
    ];
    for (const metric of [...this.http.values()].sort((a, b) =>
      `${a.method}:${a.route}:${a.status}`.localeCompare(`${b.method}:${b.route}:${b.status}`),
    )) {
      const labels = `method="${label(metric.method)}",route="${label(metric.route)}",status="${metric.status}"`;
      lines.push(`sketchtest_http_requests_total{${labels}} ${metric.count}`);
      lines.push(
        `sketchtest_http_request_duration_seconds_sum{${labels}} ${metric.durationSeconds}`,
      );
    }
    return `${lines.join('\n')}\n`;
  }

  reset(): void {
    this.http.clear();
  }
}

export const metrics = new MetricsRegistry();
