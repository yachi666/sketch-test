import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImportConfig } from '../types/import';

interface ImportProgress {
  phase: string;
  current: number;
  total: number;
}

interface UseImportWorkerReturn {
  startImport: (config: ImportConfig) => void;
  progress: ImportProgress | null;
  result: unknown | null;
  error: string | null;
  cancel: () => void;
  isRunning: boolean;
}

export function useImportWorker(): UseImportWorkerReturn {
  const workerRef = useRef<Worker | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const startImport = useCallback((config: ImportConfig) => {
    setProgress(null);
    setResult(null);
    setError(null);
    setIsRunning(true);

    // Create worker
    const worker = new Worker(new URL('../workers/import.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { type, ...data } = e.data;
      switch (type) {
        case 'progress':
          setProgress(data);
          break;
        case 'complete':
          setResult(data.result);
          setIsRunning(false);
          worker.terminate();
          break;
        case 'error':
          setError(data.message);
          setIsRunning(false);
          worker.terminate();
          break;
      }
    };

    worker.onerror = (err) => {
      setError(`Worker error: ${err.message}`);
      setIsRunning(false);
      worker.terminate();
    };

    worker.postMessage({
      type: 'import',
      content: config.content,
      format: config.detectedFormat,
      options: {
        fileName: config.fileName,
        importVariables: config.options.importVariables,
        importAuth: config.options.importAuth,
        convertAssertions: config.options.convertAssertions,
        foldersToTags: config.options.foldersToTags,
      },
      envContent: config.envFileContent,
    });
  }, []);

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setIsRunning(false);
    setProgress(null);
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  return { startImport, progress, result, error, cancel, isRunning };
}
