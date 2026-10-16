import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { login, loginChallenge, loginWithGoogle, register, useAuth } from '../../auth';
import { BackendAddress } from '../../components/BackendAddress';
import { GoogleButton } from '../../components/GoogleButton';
import { Field } from '../../components/ui';
import { THEME_LABELS, useTheme } from '../../theme';
import './auth.css';

type Mode = 'login' | 'register';

const PENDING = '註冊已送出，待管理員核准後即可登入。';

/** Sign-in and registration: all a visitor sees before they have a session. */
export default function AuthPage(props: { onBack?: () => void }) {
  const auth = useAuth();
  const { theme, cycle } = useTheme();
  const config = auth.config;
  const first = config ? !config.hasUsers : false;
  const [mode, setMode] = useState<Mode>(first ? 'register' : 'login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showBackend, setShowBackend] = useState(auth.phase === 'error');

  const run = async (task: () => Promise<{ status: string }>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const user = await task();
      if (user.status === 'pending') setNotice(PENDING);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'login') return void run(() => login(username, password));
    if (password.length < 10) return setError('密碼至少 10 個字元');
    if (password !== confirm) return setError('兩次輸入的密碼不一致');
    void run(() => register(username, password, displayName));
  };

  // A GAS backend issues a one-time challenge per Google sign-in; the local
  // Node backend issues none, and then the button works without one.
  const [nonce, setNonce] = useState<string>();
  const [round, setRound] = useState(0);
  useEffect(() => {
    let current = true;
    if (config?.googleClientId) void loginChallenge().then((n) => current && setNonce(n));
    return () => {
      current = false;
    };
  }, [round, config?.googleClientId]);
  const onGoogle = useCallback(
    (idToken: string) =>
      void run(() => loginWithGoogle(idToken, nonce)).finally(() => setRound((r) => r + 1)),
    [nonce],
  );

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-head">
          <div className="brand">Exfolio</div>
          <div className="actions">
            {props.onBack && (
              <button className="ghost" onClick={props.onBack}>
                ← 返回預覽
              </button>
            )}
            <button className="ghost" onClick={cycle}>
              主題：{THEME_LABELS[theme]}
            </button>
          </div>
        </div>

        {auth.phase === 'error' ? (
          <div className="notice warn">無法連線後端：{auth.error}。請確認下方的後端網址。</div>
        ) : (
          <>
            <div className="tabs">
              <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
                登入
              </button>
              <button
                className={mode === 'register' ? 'active' : ''}
                onClick={() => setMode('register')}
              >
                註冊
              </button>
            </div>

            {mode === 'register' && (
              <p className="muted">
                {first
                  ? '這是第一個帳號，會成為管理員並立即啟用。'
                  : config?.registration === 'open'
                    ? '註冊後即可使用。'
                    : '註冊後需由管理員核准才能登入。'}
              </p>
            )}

            <form onSubmit={submit} className="auth-form">
              <Field
                label="帳號"
                hint={mode === 'register' ? '3–64 個字元：英數字與 . _ @ + -' : undefined}
              >
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </Field>
              {mode === 'register' && (
                <Field label="顯示名稱（選填）">
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    autoComplete="nickname"
                  />
                </Field>
              )}
              <Field
                label="密碼"
                hint={
                  mode === 'register'
                    ? '至少 10 個字元。系統不寄信，忘記密碼需請管理員重設。'
                    : undefined
                }
              >
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />
              </Field>
              {mode === 'register' && (
                <Field label="再輸入一次密碼">
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </Field>
              )}
              {error && <div className="notice warn">{error}</div>}
              {notice && <div className="notice">{notice}</div>}
              <button className="primary" type="submit" disabled={busy}>
                {busy ? '處理中…' : mode === 'login' ? '登入' : '註冊'}
              </button>
            </form>

            {config?.googleClientId && (
              <div className="auth-google">
                <span className="muted">或</span>
                <GoogleButton clientId={config.googleClientId} onToken={onGoogle} nonce={nonce} />
              </div>
            )}
          </>
        )}

        <p>
          <button className="ghost" onClick={() => setShowBackend((v) => !v)}>
            {showBackend ? '隱藏' : '顯示'}後端連線設定（目前：{auth.backendLabel || '未連線'}）
          </button>
        </p>
        {showBackend && <BackendAddress />}
      </div>
    </div>
  );
}
