import { useCallback, useState } from 'react';
import { loginWithGoogle, useAuth } from '../../auth';
import { GoogleButton } from '../../components/GoogleButton';
import './auth.css';

const PENDING = '已收到申請，管理員核准後再用 Google 登入一次即可使用。';

/** Sign-in for backends that accept Google accounts only. */
export default function GoogleSignIn(props: { onBack: () => void }) {
  const auth = useAuth();
  const clientId = auth.config?.googleClientId;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const onToken = useCallback((idToken: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    loginWithGoogle(idToken)
      .then((user) => user.status === 'pending' && setNotice(PENDING))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }, []);

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-head">
          <div className="brand">Exfolio 會員</div>
          <div className="actions">
            <button className="ghost" onClick={props.onBack}>
              ← 返回試算
            </button>
          </div>
        </div>
        <p>用 Google 帳號登入後，你的資料會存起來，下次登入可以接著用。</p>
        <ul className="muted">
          <li>新會員要先經網站管理員核准。</li>
          <li>
            資料存在網站管理員的 Google 試算表裡，每位會員一份。
            <strong>管理員看得到這些試算表</strong>
            ，請自行判斷要輸入哪些資料；不想交給任何人保管的話，用試算模式即可，什麼都不會存。
          </li>
          <li>登入狀態只留在這個分頁，關閉或重新整理分頁就會登出。</li>
          <li>登入前在試算模式輸入的資料，登入後可以選擇存進帳號。</li>
        </ul>
        {auth.phase === 'error' ? (
          <div className="notice warn">目前無法連線會員後端：{auth.error}</div>
        ) : clientId ? (
          <div className="auth-google">
            <GoogleButton clientId={clientId} onToken={onToken} label="continue_with" />
          </div>
        ) : (
          <div className="notice warn">管理員尚未設定 Google 登入。</div>
        )}
        {busy && <p className="muted">登入中…</p>}
        {error && <div className="notice warn">{error}</div>}
        {notice && <div className="notice">{notice}</div>}
      </div>
    </div>
  );
}
