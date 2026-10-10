import { useEffect, useRef, useState } from 'react';
import { cpClient } from '../../lib/cp-client';
import { useAuthStore } from '../../stores/authStore';
import { useEnvironmentStore } from '../../stores/environmentStore';
import { useUIStore } from '../../stores/uiStore';
import type { Environment } from '../../types';

export function EnvironmentDialog({
  open,
  mode,
  environment,
  onClose,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  environment: Environment | null;
  onClose: () => void;
}) {
  const { createEnvironment, updateEnvironment } = useEnvironmentStore();
  const workspaceId = useAuthStore((s) => s.user?.workspaceId);
  const notify = useUIStore((s) => s.notify);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [variablesText, setVariablesText] = useState('{}');
  const [busy, setBusy] = useState(false);
  const createdId = useRef<string | null>(null);
  const versions = useEnvironmentStore((s) => s.versions);
  const refresh = useEnvironmentStore((s) => s.fetchFromServer);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === 'edit' && environment) {
      setName(environment.name);
      setDescription(environment.description || '');
    } else {
      setName('');
      setDescription('');
    }
    createdId.current = null;
    const latest = environment ? versions[environment.id]?.[0] : undefined;
    setBaseUrl(latest?.baseUrl ?? '');
    setVariablesText(JSON.stringify(latest?.variables ?? {}, null, 2));
    setErrors({});
  }, [open, mode, environment, versions]);

  useEffect(() => {
    if (open && nameRef.current) nameRef.current.focus();
  }, [open]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs['name'] = '环境名称不能为空';
    try {
      const url = new URL(baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        errs['baseUrl'] = '使用不含凭证的 HTTP(S) 基础地址';
    } catch {
      errs['baseUrl'] = '填写有效的 HTTP(S) 基础地址';
    }
    try {
      const value = JSON.parse(variablesText);
      if (
        !value ||
        Array.isArray(value) ||
        typeof value !== 'object' ||
        Object.values(value).some((v) => typeof v !== 'string')
      )
        errs['variables'] = '变量必须是字符串键值 JSON 对象';
    } catch {
      errs['variables'] = '填写有效的 JSON 对象';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    if (!workspaceId) return;
    setBusy(true);
    try {
      let id = mode === 'edit' ? environment?.id : createdId.current;
      if (!id) {
        const env = await createEnvironment(workspaceId, name.trim(), description.trim());
        if (!env) throw new Error('创建环境失败');
        id = env.id;
        createdId.current = id;
      } else if (mode === 'edit') {
        const env = await updateEnvironment(id, name.trim(), description.trim());
        if (!env) throw new Error('更新环境失败');
      }
      const previous = versions[id]?.[0];
      await cpClient.createEnvironmentVersion(id, {
        baseUrl: baseUrl.trim(),
        variables: JSON.parse(variablesText),
        runnerLabels: previous?.runnerLabels ?? [],
        requireApproval: previous?.requireApproval ?? false,
      });
      await refresh(workspaceId);
      notify('环境版本已保存，已有运行继续使用原版本。');
      onClose();
    } catch (e) {
      setErrors({ save: e instanceof Error ? e.message : '保存环境版本失败' });
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'create' ? '新建环境' : '编辑环境'}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">{mode === 'create' ? 'CREATE' : 'EDIT'} ENVIRONMENT</span>
            <h2>{mode === 'create' ? '新建环境' : '编辑环境'}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <label>
            环境名称 <span className="required">*</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：测试环境、预发环境"
            />
            {errors['name'] ? <span className="field-error">{errors['name']}</span> : null}
          </label>
          <label>
            描述
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简短描述环境用途"
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            基础地址
            <input
              aria-label="环境基础地址"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://staging.example.com"
            />
            {errors['baseUrl'] ? <span className="field-error">{errors['baseUrl']}</span> : null}
          </label>
          <label>
            运行变量（JSON）
            <textarea
              aria-label="环境变量"
              value={variablesText}
              onChange={(e) => setVariablesText(e.target.value)}
              rows={4}
            />
            {errors['variables'] ? (
              <span className="field-error">{errors['variables']}</span>
            ) : null}
          </label>
          <p>每次保存创建新环境版本；敏感凭证请使用 Secret。</p>
          {errors['save'] ? <p role="alert">{errors['save']}</p> : null}
        </div>
        <div className="modal-actions">
          <button className="button button--ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={busy}
            onClick={() => void handleSave()}
          >
            {mode === 'create' ? '创建环境' : '保存更改'}
          </button>
        </div>
      </section>
    </div>
  );
}
