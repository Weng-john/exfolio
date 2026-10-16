import { useState, type FormEvent } from 'react';
import { eraseLegacyLocalData, legacyLocalDataEncrypted, openLegacyLocalData } from '../../auth';
import { Field } from '../../components/ui';
import './auth.css';

/**
 * Data saved in this browser by the earlier, browser-only version of the
 * public site. It opens into the calculator; nothing is written back.
 */
export default function LegacyDataPage(props: { onDone: () => void }) {
  const encrypted = legacyLocalDataEncrypted();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (await openLegacyLocalData(passphrase)) props.onDone();
      else setError('密碼不正確');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  const erase = () => {
    if (!window.confirm('刪除這個瀏覽器裡的舊資料？沒有備份就無法復原。')) return;
    void eraseLegacyLocalData().then(props.onDone);
  };

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-head">
          <div className="brand">Exfolio</div>
          <div className="actions">
            <button className="ghost" onClick={props.onDone}>
              ← 返回試算
            </button>
          </div>
        </div>
        <p>
          這個瀏覽器裡有舊版網站存下的資料。網站現在不再把資料存在瀏覽器：打開後會帶進試算模式，
          你可以用 Google 登入把它存進會員帳號，或到 Settings 匯出備份檔。
        </p>
        <form onSubmit={(e) => void submit(e)} className="auth-form">
          {encrypted && (
            <Field label="當初設定的密碼">
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
            </Field>
          )}
          {error && <div className="notice warn">{error}</div>}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? '開啟中…' : '開啟並帶入試算'}
          </button>
        </form>
        <p className="muted">
          確認資料已保存到別處後，可以把它從這個瀏覽器刪除（會一併清除本站存在瀏覽器的主題等設定；
          已帶進試算的資料不受影響，關閉分頁才會消失）。{' '}
          <button className="ghost danger" onClick={erase}>
            刪除舊資料
          </button>
        </p>
      </div>
    </div>
  );
}
