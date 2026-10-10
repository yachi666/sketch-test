import {
  CheckCircle,
  FileArrowUp,
  PlugsConnected,
  Spinner,
  UploadSimple,
  X,
} from '@phosphor-icons/react';
import { type DetectionResult, detectFormat } from '@sketch-test/format-detector';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiSource } from '../../types';
import type { ImportConfig } from '../../types/import';

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (config: ImportConfig) => void;
  sources: ApiSource[];
}

/**
 * Modal dialog for importing API specifications from multiple formats.
 * Supports file upload (JSON, YAML, HAR, TXT/cURL) and remote URL sources.
 * Performs automatic format detection and shows import options.
 */
export function ImportDialog({ open, onClose, onImport, sources }: ImportDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [source, setSource] = useState<'file' | 'url'>('file');
  const [url, setUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileContent, setFileContent] = useState('');

  // Format detection state
  const [detecting, setDetecting] = useState(false);
  const [detectionResult, setDetectionResult] = useState<DetectionResult | null>(null);
  const [detectionError, setDetectionError] = useState<string | null>(null);

  // Postman environment file
  const [envFileName, setEnvFileName] = useState('');
  const [envFileContent, setEnvFileContent] = useState('');

  // Import options
  const [importVariables, setImportVariables] = useState(true);
  const [importAuth, setImportAuth] = useState(true);
  const [convertAssertions, setConvertAssertions] = useState(false);
  const [foldersToTags, setFoldersToTags] = useState(true);

  // Conflict strategy
  const [conflictStrategy, setConflictStrategy] = useState<
    'skip' | 'overwrite' | 'keep-both' | 'decide-per-item'
  >('skip');

  // Source selection
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [newSourceName, setNewSourceName] = useState('');

  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus();
      setUrl('');
      setFileName('');
      setFileContent('');
      setDetectionResult(null);
      setDetectionError(null);
      setEnvFileName('');
      setEnvFileContent('');
      setImportVariables(true);
      setImportAuth(true);
      setConvertAssertions(false);
      setFoldersToTags(true);
      setConflictStrategy('skip');
      setSelectedSourceId('');
      setNewSourceName('');
      setDetecting(false);
    }
  }, [open]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setDetectionResult(null);
    setDetectionError(null);
    setDetecting(true);

    try {
      const text = await file.text();
      setFileContent(text);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Not valid JSON — pass raw text for cURL detection
        parsed = text;
      }
      const results = detectFormat(parsed);
      const top = results[0];
      if (top && top.format !== 'unknown') {
        setDetectionResult(top);
      } else {
        setDetectionError('无法识别格式');
      }
    } catch {
      setDetectionError('文件读取失败');
    } finally {
      setDetecting(false);
    }
  }, []);

  const handleEnvFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEnvFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setEnvFileContent(reader.result as string);
    };
    reader.readAsText(file);
  }, []);

  const handleImport = useCallback(() => {
    const config: ImportConfig = {
      content: fileContent,
      fileName,
      detectedFormat: detectionResult?.format ?? 'unknown',
      options: {
        importVariables,
        importAuth,
        convertAssertions,
        foldersToTags,
      },
      conflictStrategy,
      sourceId: selectedSourceId || undefined,
      newSourceName: selectedSourceId === '' ? newSourceName : undefined,
    };
    if (envFileContent) {
      config.envFileContent = envFileContent;
    }
    onImport(config);
    onClose();
  }, [
    fileContent,
    fileName,
    detectionResult,
    envFileContent,
    importVariables,
    importAuth,
    convertAssertions,
    foldersToTags,
    conflictStrategy,
    onImport,
    onClose,
  ]);

  const isValid =
    source === 'file' ? fileName !== '' && detectionResult !== null : url.trim() !== '';

  const isPostman = detectionResult?.format === 'postman-collection';

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">API SOURCE</span>
            <h2 id="import-title">导入 API 文档</h2>
          </div>
          <button
            className="icon-button"
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>

        <div className="segmented">
          <button
            type="button"
            className={source === 'file' ? 'active' : ''}
            onClick={() => setSource('file')}
          >
            <FileArrowUp size={17} />
            上传文件
          </button>
          <button
            type="button"
            className={source === 'url' ? 'active' : ''}
            onClick={() => setSource('url')}
          >
            <PlugsConnected size={17} />
            远程 URL
          </button>
        </div>

        {source === 'file' ? (
          <>
            <label className="drop-zone">
              <input type="file" accept=".json,.yaml,.yml,.har,.txt" onChange={handleFileChange} />
              <FileArrowUp size={36} weight="duotone" />
              <strong>{fileName || '拖入 JSON / YAML / HAR / TXT 文件'}</strong>
              <span>支持 Postman, OpenAPI, HAR, cURL，最大 10 MB</span>
            </label>

            {/* Format detection status */}
            {detecting && (
              <div className="detection-status">
                <Spinner size={18} className="spin" />
                <span>正在识别格式...</span>
              </div>
            )}

            {/* Detection result */}
            {detectionResult && !detecting && (
              <div className="detection-result">
                <CheckCircle size={18} weight="fill" />
                <div>
                  <strong>{detectionResult.label}</strong>
                  {detectionResult.version && <small>版本 {detectionResult.version}</small>}
                  {detectionResult.details && (
                    <div className="detection-details">
                      {detectionResult.details.endpointCount !== undefined &&
                        detectionResult.details.endpointCount > 0 && (
                          <span>{detectionResult.details.endpointCount} 个接口</span>
                        )}
                      {detectionResult.details.hasVariables && <span>含变量定义</span>}
                      {detectionResult.details.hasAuth && <span>含认证配置</span>}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Detection error */}
            {detectionError && !detecting && (
              <div className="detection-error">
                <span>{detectionError}</span>
              </div>
            )}

            {/* Postman environment file upload (conditional) */}
            {isPostman && (
              <label className="env-file-upload">
                <span className="env-upload-label">Postman 环境文件（可选）</span>
                <div className="env-file-input-wrap">
                  <input type="file" accept=".json" onChange={handleEnvFileChange} />
                  <span className="env-file-name">{envFileName || '选择 .json 环境文件'}</span>
                </div>
              </label>
            )}

            {/* Import options */}
            {detectionResult && (
              <>
                <div className="import-options-section">
                  <h3 className="import-section-title">导入选项</h3>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={importVariables}
                      onChange={(e) => setImportVariables(e.target.checked)}
                    />
                    <div>
                      <strong>导入变量定义</strong>
                      <small>导入集合中定义的变量</small>
                    </div>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={importAuth}
                      onChange={(e) => setImportAuth(e.target.checked)}
                    />
                    <div>
                      <strong>导入认证配置</strong>
                      <small>导入 API Key、Bearer Token 等认证信息</small>
                    </div>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={convertAssertions}
                      onChange={(e) => setConvertAssertions(e.target.checked)}
                    />
                    <div>
                      <strong>转换测试脚本为断言</strong>
                      <small>将 Postman 测试脚本转换为平台断言规则</small>
                    </div>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={foldersToTags}
                      onChange={(e) => setFoldersToTags(e.target.checked)}
                    />
                    <div>
                      <strong>文件夹结构 → 标签</strong>
                      <small>将集合文件夹层级转换为接口标签</small>
                    </div>
                  </label>
                </div>

                {/* Source selection */}
                <div className="import-strategy-section">
                  <h3 className="import-section-title">所属系统</h3>
                  <div className="modal-field">
                    <select
                      value={selectedSourceId}
                      onChange={(e) => setSelectedSourceId(e.target.value)}
                      className="input"
                    >
                      <option value="">新建系统...</option>
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.sourceLabel})
                        </option>
                      ))}
                    </select>
                    {selectedSourceId === '' && (
                      <input
                        className="input"
                        value={newSourceName}
                        onChange={(e) => setNewSourceName(e.target.value)}
                        placeholder="新系统名称，例如：支付服务"
                        style={{ marginTop: 8 }}
                      />
                    )}
                  </div>
                </div>

                {/* Conflict strategy */}
                <div className="import-strategy-section">
                  <h3 className="import-section-title">冲突处理策略</h3>
                  <div className="radio-group">
                    <label className="radio-field">
                      <input
                        type="radio"
                        name="conflict-strategy"
                        value="skip"
                        checked={conflictStrategy === 'skip'}
                        onChange={() => setConflictStrategy('skip')}
                      />
                      <div>
                        <strong>跳过重复</strong>
                        <small>已存在的接口不重复导入</small>
                      </div>
                    </label>
                    <label className="radio-field">
                      <input
                        type="radio"
                        name="conflict-strategy"
                        value="overwrite"
                        checked={conflictStrategy === 'overwrite'}
                        onChange={() => setConflictStrategy('overwrite')}
                      />
                      <div>
                        <strong>覆盖</strong>
                        <small>用新导入数据覆盖已有接口</small>
                      </div>
                    </label>
                    <label className="radio-field">
                      <input
                        type="radio"
                        name="conflict-strategy"
                        value="keep-both"
                        checked={conflictStrategy === 'keep-both'}
                        onChange={() => setConflictStrategy('keep-both')}
                      />
                      <div>
                        <strong>保留两者</strong>
                        <small>同时保留新旧两个版本</small>
                      </div>
                    </label>
                    <label className="radio-field">
                      <input
                        type="radio"
                        name="conflict-strategy"
                        value="decide-per-item"
                        checked={conflictStrategy === 'decide-per-item'}
                        onChange={() => setConflictStrategy('decide-per-item')}
                      />
                      <div>
                        <strong>逐项决定</strong>
                        <small>对每个冲突的接口单独选择处理方式</small>
                      </div>
                    </label>
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <label className="modal-field">
            文档地址
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/openapi.yaml"
            />
          </label>
        )}

        <div className="import-preview">
          <CheckCircle size={20} weight="fill" />
          <span>
            <strong>导入后自动生成</strong>
            接口目录、Schema、正向/负向/边界测试草稿
          </span>
        </div>

        <div className="modal-actions">
          <button className="button button--ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={!isValid}
            onClick={handleImport}
          >
            <UploadSimple size={17} />
            校验并导入
          </button>
        </div>
      </section>
    </div>
  );
}
