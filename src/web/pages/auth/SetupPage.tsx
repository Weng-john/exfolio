import { useState, type FormEvent } from 'react';
import { protectLocalData, startPreview } from '../../auth';
import { Field } from '../../components/ui';
import { hasData, MIN_PASSPHRASE_LENGTH } from '../../localVault';
import { THEME_LABELS, useTheme } from '../../theme';
import './auth.css';

/**
 * First visit to the public edition: real data is only ever kept encrypted,
 * so a passphrase comes before anything can be entered.
 */
export default function SetupPage() {
  const { theme, cycle } = useTheme();
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const existing = hasData();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      return setError(`密碼至少 ${MIN_PASSPHRASE_LENGTH} 個字元`);
    }
    if (passphrase !== confirm) return setError('兩次輸入的密碼不一致');
    setBusy(true);
    setError('');
    try {
      await protectLocalData(passphrase);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-head">
          <div className="brand">Exfolio</div>
          <button className="ghost" onClick={cycle}>
            主題：{THEME_LABELS[theme]}
          </button>
        </div>
        <p>
          這個網站沒有帳號，也沒有伺服器：你的資料只存在這個瀏覽器裡，並且一律以你設定的密碼加密後才存放。
        </p>
        <ul className="planned">
          <li>每次開啟網站都要輸入這組密碼；系統不知道密碼，忘記就只能清除後從備份還原。</li>
          <li>
            加密保護的是存下來的資料。它擋不住已經在這個網址來源上執行的惡意程式（例如有問題的瀏覽器擴充套件，或同一個
            GitHub 帳號下其他被入侵的網站）：那類程式可以刪除你的資料，或在你解鎖後偷看畫面。
          </li>
          <li>匯出的備份檔是未加密的，請自行妥善保管。</li>
        </ul>
        {existing && (
          <div className="notice warn">這個瀏覽器裡已有尚未加密的資料，設定密碼後會立即加密。</div>
        )}
        <form onSubmit={(e) => void submit(e)} className="auth-form">
          <Field
            label="設定密碼"
            hint={`至少 ${MIN_PASSPHRASE_LENGTH} 個字元；建議用幾個不相關的詞組成`}
          >
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="再輸入一次">
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
          {error && <div className="notice warn">{error}</div>}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? '加密中…' : '設定密碼並開始使用'}
          </button>
        </form>
        <p>
          <button className="ghost" onClick={startPreview} disabled={busy}>
            先用虛構的示範資料看看（不會儲存）
          </button>
        </p>
      </div>
    </div>
  );
}
