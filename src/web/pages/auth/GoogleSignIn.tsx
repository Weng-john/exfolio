import { useCallback, useEffect, useState } from 'react';
import { loginChallenge, loginWithGoogle, useAuth } from '../../auth';
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
  // Each sign-in uses a fresh one-time challenge from the backend, which
  // Google writes into the token; `round` asks for the next one.
  const [nonce, setNonce] = useState<string>();
  const [round, setRound] = useState(0);
  useEffect(() => {
    let current = true;
    setNonce(undefined);
    void loginChallenge().then((n) => {
      if (!current) return;
      if (n) setNonce(n);
      else setError('無法向會員後端取得登入憑證，請稍後重試');
    });
    return () => {
      current = false;
    };
  }, [round]);

  const onToken = useCallback(
    (idToken: string) => {
      setBusy(true);
      setError('');
      setNotice('');
      loginWithGoogle(idToken, nonce)
        .then((user) => user.status === 'pending' && setNotice(PENDING))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => {
          setBusy(false);
          setRound((r) => r + 1);
        });
    },
    [nonce],
  );

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
          <li>
            登入狀態只留在這個分頁：重新整理或關閉分頁後要重新登入，閒置 30
            分鐘也會自動登出。後端的登入憑證最長 12 小時後失效。
          </li>
          <li>登入前在試算模式輸入的資料，登入後可以選擇存進帳號。</li>
        </ul>
        {auth.phase === 'error' ? (
          <div className="notice warn">目前無法連線會員後端：{auth.error}</div>
        ) : clientId && nonce ? (
          <div className="auth-google">
            <GoogleButton
              clientId={clientId}
              onToken={onToken}
              label="continue_with"
              nonce={nonce}
            />
          </div>
        ) : clientId ? (
          <p className="muted">準備登入…</p>
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
