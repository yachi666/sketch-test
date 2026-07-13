import { Cube, SignIn, Warning } from '@phosphor-icons/react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cpClient } from '../../lib/cp-client';
import { useAuthStore } from '../../stores/authStore';

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [workspaceId, setWorkspaceId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session = await cpClient.login(email.trim(), password, workspaceId.trim());
      setSession(session.token, session.user);
      navigate('/apis', { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-view">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <span className="brand-mark">
            <Cube size={28} weight="duotone" />
          </span>
          <div>
            <span className="eyebrow">CONTROL PLANE</span>
            <strong>SketchTest</strong>
          </div>
        </div>
        <div className="login-heading">
          <h1 id="login-title">登录工作区</h1>
          <p>使用工作区 ID 和成员凭据访问测试资产与运行证据。</p>
        </div>
        <form className="form-stack" onSubmit={(event) => void submit(event)}>
          <label>
            Workspace ID
            <input
              className="text-input"
              required
              autoComplete="organization"
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              placeholder="ws_…"
            />
          </label>
          <label>
            邮箱
            <input
              className="text-input"
              required
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </label>
          <label>
            密码
            <input
              className="text-input"
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? (
            <div className="login-error" role="alert">
              <Warning size={18} />
              <span>{error}</span>
            </div>
          ) : null}
          <button className="button button--primary" type="submit" disabled={submitting}>
            <SignIn size={18} weight="bold" />
            {submitting ? '正在验证…' : '登录'}
          </button>
        </form>
      </section>
    </main>
  );
}
