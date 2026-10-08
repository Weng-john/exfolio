import { useRef, useState } from 'react';
import {
  addMissingSeed, backupFileName, parseBackup, rowCounts, serializeBackup, TABLE_NAMES, type AppData,
} from '@core/index';
import { connectBackend, loadBackendConfig, saveBackendConfig, type BackendConfig, type BackendMode } from '../../backend';
import { initStore, replaceAll, setTable, useData, useStore } from '../../store';
import { fmtTime } from '../../format';
import { Card, Modal } from '../../components/ui';

const TABLE_LABEL: Record<string, string> = {
  brokers: '券商', accounts: '帳戶', indices: '指數', instruments: '商品', transactions: '交易',
  loans: '借款', prices: '報價', fxRates: '匯率', targets: '配置目標', strategies: '策略',
  snapshots: 'NAV 快照', settings: '設定',
};

function BackendCard() {
  const store = useStore();
  const [cfg, setCfg] = useState<BackendConfig>(loadBackendConfig);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);

  const ping = async () => {
    setBusy(true);
    setMsg(undefined);
    try {
      const backend = await connectBackend(cfg);
      const res = await backend.call({ action: 'ping' });
      setMsg(res.ok ? { ok: true, text: `連線成功：${backend.label}` } : { ok: false, text: `後端拒絕：${res.error}` });
    } catch (err) {
      setMsg({ ok: false, text: `連線失敗：${err instanceof Error ? err.message : String(err)}` });
    }
    setBusy(false);
  };

  const apply = async () => {
    saveBackendConfig(cfg);
    setMsg({ ok: true, text: '已套用，重新載入資料中…' });
    await initStore();
  };

  return (
    <Card title="後端連線" actions={<button className="primary" onClick={() => void apply()}>套用並重新載入</button>}>
      <p>
        目前：{store.backendLabel || '—'}（{store.status}）{store.lastSavedAt && `，最近儲存 ${fmtTime(store.lastSavedAt)}`}
      </p>
      <div className="notice">
        網址與 token 只存在<strong>這個瀏覽器的 localStorage</strong>，不會寫進程式碼或 Git 儲存庫，也不會包含在備份檔中。
        換瀏覽器或清除網站資料後需要重新輸入。
      </div>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">模式</span>
          <select value={cfg.mode} onChange={(e) => setCfg({ ...cfg, mode: e.target.value as BackendMode })}>
            <option value="auto">auto（先試後端，失敗改用此瀏覽器）</option>
            <option value="remote">remote（只用後端）</option>
            <option value="browser">browser（只存此瀏覽器）</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">後端網址</span>
          <input value={cfg.url} disabled={cfg.mode === 'browser'} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} placeholder="/api" />
        </label>
        <label className="field">
          <span className="field-label">Token</span>
          <input type="password" autoComplete="off" value={cfg.token} disabled={cfg.mode === 'browser'} onChange={(e) => setCfg({ ...cfg, token: e.target.value })} />
        </label>
      </div>
      <p>
        <button onClick={() => void ping()} disabled={busy}>{busy ? '測試中…' : '測試連線'}</button>
      </p>
      {msg && <p className={msg.ok ? 'pos' : 'neg'}>{msg.text}</p>}
    </Card>
  );
}

function BackupCard() {
  const data = useData();
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState<{ data: AppData; name: string; exportedAt?: string }>();

  const exportData = () => {
    const blob = new Blob([serializeBackup(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName();
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setErrors([]);
    const res = parseBackup(await file.text());
    if (fileRef.current) fileRef.current.value = '';
    if (!res.ok) return setErrors(res.errors);
    setPending({ data: res.data, name: file.name, exportedAt: res.exportedAt });
  };

  const current = rowCounts(data);
  const incoming = pending ? rowCounts(pending.data) : undefined;

  return (
    <Card title="備份與還原">
      <div className="notice warn">
        備份檔含有個人財務資料，請妥善保管，<strong>不要提交到 Git</strong>。檔名維持 <code>exfolio-backup-*.json</code> 時會被 .gitignore 排除。
      </div>
      <p>
        <button className="primary" onClick={exportData}>匯出 JSON 備份</button>{' '}
        <button onClick={() => fileRef.current?.click()}>從檔案還原…</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      </p>
      {errors.length > 0 && (
        <>
          <p className="neg">備份檔驗證失敗，未做任何變更：</p>
          <ul className="settings-form-errors">{errors.slice(0, 20).map((e) => <li key={e}>{e}</li>)}{errors.length > 20 && <li>…另有 {errors.length - 20} 項</li>}</ul>
        </>
      )}
      {pending && incoming && (
        <Modal
          title="確認還原"
          onClose={() => setPending(undefined)}
          footer={
            <>
              <button onClick={() => setPending(undefined)}>取消</button>
              <button className="danger" onClick={() => { replaceAll(pending.data); setPending(undefined); }}>覆蓋並還原</button>
            </>
          }
        >
          <p>
            檔案：{pending.name}（匯出時間 {fmtTime(pending.exportedAt)}）。還原會<strong>整份取代</strong>目前所有資料，無法復原；建議先匯出目前資料。
          </p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>資料表</th><th className="num">目前</th><th className="num">還原後</th></tr></thead>
              <tbody>
                {TABLE_NAMES.map((t) => (
                  <tr key={t}><td>{TABLE_LABEL[t] ?? t}</td><td className="num">{current[t]}</td><td className="num">{incoming[t]}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function SeedCard() {
  const data = useData();
  const [msg, setMsg] = useState('');
  const load = () => {
    const { data: next, added } = addMissingSeed(data);
    setTable('indices', next.indices);
    setTable('brokers', next.brokers);
    setTable('accounts', next.accounts);
    setTable('instruments', next.instruments);
    setMsg(`已新增 商品 ${added.instruments}、指數 ${added.indices}、券商 ${added.brokers}、帳戶 ${added.accounts}（既有資料未被覆蓋）`);
  };
  return (
    <Card title="預設商品" actions={<button onClick={load}>載入預設商品</button>}>
      <p className="muted">補上內建的商品、指數、券商與帳戶中 id 尚不存在者；已存在的資料（含你的修改）不會被覆蓋。</p>
      {msg && <p className="pos">{msg}</p>}
    </Card>
  );
}

export default function BackendTab() {
  return (
    <>
      <BackendCard />
      <BackupCard />
      <SeedCard />
    </>
  );
}
