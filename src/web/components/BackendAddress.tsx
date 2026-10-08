import { useState } from 'react';
import { reconnect } from '../auth';
import {
  connectBackend,
  loadBackendConfig,
  saveBackendConfig,
  type BackendConfig,
  type BackendMode,
} from '../backend';

/** Where the backend lives. Shown on the sign-in page and in Settings. */
export function BackendAddress() {
  const [cfg, setCfg] = useState<BackendConfig>(loadBackendConfig);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);

  const ping = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      const backend = await connectBackend(cfg);
      const res = await backend.call({ action: 'ping' });
      setMsg(
        res.ok
          ? { ok: true, text: `連線成功：${backend.label}` }
          : { ok: false, text: `後端拒絕：${res.error}` },
      );
    } catch (err) {
      setMsg({ ok: false, text: `連線失敗：${err instanceof Error ? err.message : String(err)}` });
    }
    setBusy(false);
  };

  const apply = async () => {
    saveBackendConfig(cfg);
    setMsg({ ok: true, text: '已套用，重新連線中…' });
    await reconnect();
  };

  return (
    <>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">模式</span>
          <select
            value={cfg.mode}
            onChange={(e) => setCfg({ ...cfg, mode: e.target.value as BackendMode })}
          >
            <option value="auto">自動（先試後端，連不上改用此瀏覽器）</option>
            <option value="remote">只用後端</option>
            <option value="browser">只存此瀏覽器（無會員功能）</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">後端網址</span>
          <input
            value={cfg.url}
            disabled={cfg.mode === 'browser'}
            onChange={(e) => setCfg({ ...cfg, url: e.target.value })}
            placeholder="/api 或 GAS 網頁應用程式網址"
          />
          <span className="field-hint">只存在這個瀏覽器，不會寫進程式碼或備份檔</span>
        </label>
      </div>
      <p className="actions">
        <button onClick={() => void ping()} disabled={busy}>
          {busy ? '測試中…' : '測試連線'}
        </button>
        <button className="primary" onClick={() => void apply()}>
          套用並重新連線
        </button>
      </p>
      {msg && <p className={msg.ok ? 'pos' : 'neg'}>{msg.text}</p>}
    </>
  );
}
