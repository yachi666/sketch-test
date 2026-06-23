// Web Worker that imports API specs using adapter packages
import { importHar } from '@sketch-test/adapter-har';
import { importPostmanCollection } from '@sketch-test/adapter-postman';
import type { ContentHash } from '@sketch-test/contracts-common';
import type { ImportFormat } from '@sketch-test/format-detector';

type ImportResult = Awaited<ReturnType<typeof importPostmanCollection | typeof importHar>>;

interface ImportMessage {
  type: 'import';
  content: string;
  format: ImportFormat;
  options: Record<string, unknown>;
  envContent?: string;
}

interface CancelMessage {
  type: 'cancel';
}

/** Compute a SHA-256 content hash for source provenance. */
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

self.onmessage = async (e: MessageEvent<ImportMessage | CancelMessage>) => {
  const { type } = e.data;

  if (type === 'cancel') {
    // Signal cancellation — the caller will terminate the worker
    return;
  }

  if (type === 'import') {
    const { content, format, options } = e.data;

    try {
      const parsed = JSON.parse(content);

      self.postMessage({
        type: 'progress',
        phase: '解析格式',
        current: 0,
        total: 1,
      });

      // Compute real SHA-256 content hash for source provenance
      const sourceHash = (await sha256(content)) as ContentHash;
      const fileName = options['fileName'] as string;

      // Parse optional Postman environment file
      let env;
      const { envContent } = e.data;
      if (envContent) {
        try {
          env = JSON.parse(envContent);
        } catch {
          // Ignore parse errors — environment is best-effort
        }
      }

      let result: ImportResult;
      switch (format) {
        case 'postman-collection': {
          result = importPostmanCollection(parsed, {
            sourceLabel: fileName,
            sourceHash,
            environment: env,
            importAuth: options['importAuth'] !== false,
            foldersToTags: options['foldersToTags'] !== false,
          });
          break;
        }
        case 'har': {
          result = importHar(parsed, {
            sourceLabel: fileName,
            sourceHash,
          });
          break;
        }
        case 'openapi': {
          self.postMessage({
            type: 'error',
            message: 'OpenAPI 格式请使用远程 URL 导入方式',
          });
          return;
        }
        default:
          self.postMessage({
            type: 'error',
            message: `Unsupported format: ${format}`,
          });
          return;
      }

      self.postMessage({ type: 'complete', result });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) });
    }
  }
};
