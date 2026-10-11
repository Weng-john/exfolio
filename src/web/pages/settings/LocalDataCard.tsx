import { useState } from 'react';
import { initAuth, lockLocalData } from '../../auth';
import { Badge, Card, Field } from '../../components/ui';
import * as vault from '../../localVault';
import { flush } from '../../store';

/** Protection and removal of the data kept in this browser. */
export default function LocalDataCard() {
  const [encrypted, setEncrypted] = useState(vault.isEncrypted);
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  const run = async (task: () => Promise<void>, done: string) => {
    setMsg(undefined);
    try {
      // Anything still waiting to be written goes out under the old setting first.
      await flush();
      await task();
      setEncrypted(vault.isEncrypted());
      setMsg({ ok: true, text: done });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  };

  const enable = () => {
    if (passphrase.length < 8) return setMsg({ ok: false, text: '密碼至少 8 個字元' });
    if (passphrase !== confirm) return setMsg({ ok: false, text: '兩次輸入的密碼不一致' });
    void run(async () => {
      await vault.enableEncryption(passphrase);
      setPassphrase('');
      setConfirm('');
    }, '已加密。之後每次開啟網站都要輸入這組密碼。');
  };

  const erase = () => {
    if (!window.confirm('清除這個瀏覽器中的全部 Exfolio 資料與設定？沒有備份就無法復原。')) return;
    vault.eraseEverything();
    window.location.reload();
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
        加密後，存下來的是密文，密碼只留在分頁的記憶體裡；代價是每次開啟都要輸入密碼，忘記就只能清除後從備份還原。
        加密擋不住已經在這個網站上執行的惡意程式。匯出的備份檔是未加密的，請自行妥善保管。
      </p>
      {msg && <p className={msg.ok ? 'pos' : 'neg'}>{msg.text}</p>}

      {encrypted ? (
        <p className="actions">
          <button
            onClick={() =>
              void (async () => {
                await flush();
                lockLocalData();
              })()
            }
          >
            立即鎖定
          </button>
          <button onClick={() => void run(() => vault.disableEncryption(), '已改為不加密。')}>
            取消加密
          </button>
        </p>
      ) : (
        <>
          <div className="form-grid">
            <Field label="設定密碼" hint="至少 8 個字元">
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
            <button className="primary" onClick={enable}>
              用密碼加密
            </button>
          </p>
        </>
      )}

      <p className="actions">
        <button className="danger" onClick={erase}>
          清除這個瀏覽器中的全部資料
        </button>
        <button className="ghost" onClick={() => void initAuth()}>
          重新連線
        </button>
      </p>
    </Card>
  );
}
