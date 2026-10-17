import { useState, type FormEvent } from 'react';
import { initAuth, unlockLocalData } from '../../auth';
import { Field } from '../../components/ui';
import { eraseEverything } from '../../localVault';
import { Brand } from '../../components/Brand';
import './auth.css';
import { confirmDialog } from '../../dialog';

/** Asks for the passphrase that encrypts the data kept in this browser. */
export default function UnlockPage() {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (!(await unlockLocalData(passphrase))) setError('密碼不正確');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  const erase = async () => {
    if (
      !(await confirmDialog('清除這個瀏覽器中的全部 Exfolio 資料？沒有備份就無法復原。', {
        tone: 'danger',
        confirmText: '清除',
      }))
    )
      return;
    void eraseEverything().then(initAuth);
  };

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-head">
          <Brand />
        </div>
        <p className="muted">
          這個瀏覽器中的資料已加密。輸入密碼後才會解開，密碼只留在這個分頁的記憶體裡。
        </p>
        <form onSubmit={(e) => void submit(e)} className="auth-form">
          <Field label="密碼">
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </Field>
          {error && <div className="notice warn">{error}</div>}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? '解鎖中…' : '解鎖'}
          </button>
        </form>
        <p className="muted">
          忘記密碼就無法解開，只能清除後從備份還原。{' '}
          <button className="ghost danger" onClick={erase}>
            清除全部資料
          </button>
        </p>
      </div>
    </div>
  );
}
