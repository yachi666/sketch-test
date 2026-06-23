import { detectCurl } from './detectors/curl.js';
import { detectHar } from './detectors/har.js';
import { detectOpenApi } from './detectors/openapi.js';
import { detectPostman } from './detectors/postman.js';

export type ImportFormat =
  | 'postman-collection'
  | 'postman-environment'
  | 'openapi'
  | 'har'
  | 'curl'
  | 'unknown';

export interface DetectionResult {
  format: ImportFormat;
  confidence: number;
  version?: string;
  label: string;
  details?: { endpointCount?: number; hasAuth?: boolean; hasVariables?: boolean };
}

export function detectFormat(content: unknown): DetectionResult[] {
  const results: DetectionResult[] = [];
  const pm = detectPostman(content);
  if (pm) results.push(pm);
  const oa = detectOpenApi(content);
  if (oa) results.push(oa);
  const hr = detectHar(content);
  if (hr) results.push(hr);
  const cl = detectCurl(content);
  if (cl) results.push(cl);
  results.sort((a, b) => b.confidence - a.confidence);
  const top = results[0];
  if (!top || top.confidence < 0.5) {
    return [{ format: 'unknown', confidence: 0.3, label: '未知格式' }];
  }
  return results;
}
