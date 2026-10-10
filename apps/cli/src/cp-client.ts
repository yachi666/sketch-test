/**
 * Minimal CP API client for the SketchTest CLI.
 *
 * Thin wrapper around fetch() with auth header injection and error
 * normalization. Unlike the web app's cp-client, this module has zero UI
 * dependencies and targets Node.js runtime.
 */

interface CpClientOptions {
  baseUrl: string;
  token: string;
}

const clientConfig: CpClientOptions = {
  baseUrl: 'http://localhost:3802',
  token: '',
};

export function configureClient(options: Partial<CpClientOptions>): void {
  if (options.baseUrl !== undefined) clientConfig.baseUrl = options.baseUrl;
  if (options.token !== undefined) clientConfig.token = options.token;
}

export function getClientConfig(): Readonly<CpClientOptions> {
  return clientConfig;
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${clientConfig.baseUrl}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (clientConfig.token) {
    headers['Authorization'] = `Bearer ${clientConfig.token}`;
  }

  const init: RequestInit = {
    ...options,
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string> | undefined),
    },
  };

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    throw new Error(
      `Network error connecting to ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    const message = (body as { message?: string }).message ?? `HTTP ${response.status}`;
    throw new Error(message);
  }

  return response.json() as T;
}
