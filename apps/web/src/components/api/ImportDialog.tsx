import { CheckCircle, FileArrowUp, PlugsConnected, UploadSimple, X } from '@phosphor-icons/react';
import { useState, useRef, useEffect } from 'react';

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: () => void;
}

/**
 * Modal dialog for importing OpenAPI specifications.
 * Supports file upload (YAML/JSON) and remote URL sources.
 */
export function ImportDialog({ open, onClose, onImport }: ImportDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [source, setSource] = useState<'file' | 'url'>('file');
  const [url, setUrl] = useState('');
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus();
      setUrl('');
      setFileName('');
    }
  }, [open]);

  if (!open) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setFileName(file.name);
  };

  const handleImport = () => {
    onImport();
    onClose();
  };

  const isValid = source === 'file' ? fileName !== '' : url.trim() !== '';

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
            <h2 id="import-title">导入 OpenAPI</h2>
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
          <label className="drop-zone">
            <input type="file" accept=".yaml,.yml,.json" onChange={handleFileChange} />
            <FileArrowUp size={36} weight="duotone" />
            <strong>{fileName || '拖入 YAML 或 JSON 文件'}</strong>
            <span>支持 OpenAPI 2.0 / 3.0 / 3.1，最大 10 MB</span>
          </label>
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
