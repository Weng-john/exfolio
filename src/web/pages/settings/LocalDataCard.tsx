import { useState } from 'react';
import { lockLocalData } from '../../auth';
import { Badge, Card, Field } from '../../components/ui';
import { IS_PUBLIC } from '../../edition';
import * as vault from '../../localVault';
import { flush } from '../../store';

/** Protection and removal of the data kept in this browser. */
export default function LocalDataCard() {
  const [encrypted, setEncrypted] = useState(vault.isEncrypted);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  /** One change at a time, and only once everything pending is safely stored. */
  const run = async (task: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(true);
    setMsg(undefined);
    try {
      if (!(await flush()))
        throw new Error('有變更尚未成功儲存，請先解決儲存問題（或匯出備份）再操作');
      await task();
      setEncrypted(vault.isEncrypted());
      setMsg({ ok: true, text: done });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setBusy(false);
  };

  const setPassword = () => {
    if (passphrase.length < vault.MIN_PASSPHRASE_LENGTH) {
      return setMsg({ ok: false, text: `密碼至少 ${vault.MIN_PASSPHRASE_LENGTH} 個字元` });
    }
    if (passphrase !== confirm) return setMsg({ ok: false, text: '兩次輸入的密碼不一致' });
    void run(
      async () => {
        await vault.enableEncryption(passphrase);
        setPassphrase('');
        setConfirm('');
      },
      encrypted ? '密碼已變更。' : '已加密。之後每次開啟網站都要輸入這組密碼。',
    );
  };

  const lockNow = async () => {
    if (busy) return;
    setBusy(true);
    if (!(await lockLocalData())) {
      setMsg({ ok: false, text: '有變更尚未成功儲存，為避免遺失資料沒有鎖定' });
      setBusy(false);
    }
  };

  const erase = () => {
    if (!window.confirm('清除這個瀏覽器中的全部 Exfolio 資料與設定？沒有備份就無法復原。')) return;
    void vault.eraseEverything().then(() => window.location.reload());
  };

  return (
    <Card title="這個瀏覽器中的資料">
      <p>
        目前：
        {encrypted ? <Badge tone="ok">已用密碼加密</Badge> : <Badge tone="warn">未加密</Badge>}
      </p>
      <p className="muted">你的資料存在這個瀏覽器裡。未加密時，下列情況讀得到它：</p>
      <ul className="planned">
        <li>共用這台電腦或這個瀏覽器設定檔的人。</li>
        <li>有權讀取網頁內容的瀏覽器擴充套件。</li>
        <li>
          同一個網址來源下的其他網頁。GitHub Pages
          上，同一個帳號的所有專案網站共用一個來源，所以該帳號的其他專案頁面也讀得到。
        </li>
      </ul>
      <p className="muted">
        加密後，存下來的是密文，密碼只留在分頁的記憶體裡；每次開啟都要輸入密碼，閒置 20
        分鐘會自動鎖定，忘記密碼只能清除後從備份還原。
      </p>
      <p className="muted">
        加密保護的是存下來的資料，不是隔離：已經在這個網址來源上執行的惡意程式仍可刪除或替換你的資料，或在你解鎖後偷看畫面。要完全隔離，網站需要放在獨立的網域。匯出的備份檔是未加密的，請自行妥善保管。
      </p>
      {msg && <p className={msg.ok ? 'pos' : 'neg'}>{msg.text}</p>}

      <div className="form-grid">
        <Field
          label={encrypted ? '新密碼' : '設定密碼'}
          hint={`至少 ${vault.MIN_PASSPHRASE_LENGTH} 個字元`}
        >
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="再輸入一次">
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
      </div>
      <p className="actions">
        <button className="primary" disabled={busy} onClick={setPassword}>
          {busy ? '處理中…' : encrypted ? '變更密碼' : '用密碼加密'}
        </button>
        {encrypted && (
          <button disabled={busy} onClick={() => void lockNow()}>
            立即鎖定
          </button>
        )}
        {/* The public edition keeps real data only in encrypted form. */}
        {encrypted && !IS_PUBLIC && (
          <button
            disabled={busy}
            onClick={() => void run(() => vault.disableEncryption(), '已改為不加密。')}
          >
            取消加密
          </button>
        )}
        <button className="danger" disabled={busy} onClick={erase}>
          清除這個瀏覽器中的全部資料
        </button>
      </p>
    </Card>
  );
}
