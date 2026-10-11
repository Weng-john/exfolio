import { useRef, useState } from 'react';
import {
  addMissingSeed,
  backupFileName,
  parseBackup,
  rowCounts,
  serializeBackup,
  TABLE_NAMES,
  type AppData,
} from '@core/index';
import { BackendAddress } from '../../components/BackendAddress';
import { IS_PUBLIC } from '../../edition';
import LocalDataCard from './LocalDataCard';
import { replaceAll, setTable, useData, useStore } from '../../store';
import { fmtTime } from '../../format';
import { Card, Modal } from '../../components/ui';

const TABLE_LABEL: Record<string, string> = {
  brokers: '券商',
  accounts: '帳戶',
  indices: '指數',
  instruments: '商品',
  transactions: '交易',
  loans: '借款',
  prices: '報價',
  fxRates: '匯率',
  targets: '配置目標',
  strategies: '策略',
  snapshots: 'NAV 快照',
  settings: '設定',
};

const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

function BackendCard() {
  const store = useStore();
  return (
    <Card title="後端連線">
      <p>
        目前：{store.backendLabel || '—'}（{store.status}）
        {store.lastSavedAt && `，最近儲存 ${fmtTime(store.lastSavedAt)}`}
      </p>
      <BackendAddress />
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
    // A real backup is far smaller: refuse before reading a file that could exhaust memory.
    if (file.size > MAX_BACKUP_BYTES) {
      if (fileRef.current) fileRef.current.value = '';
      return setErrors([
        `檔案太大（上限 ${MAX_BACKUP_BYTES / 1024 / 1024} MB），不像是 Exfolio 的備份檔`,
      ]);
    }
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
        備份檔含有個人財務資料，請妥善保管，<strong>不要提交到 Git</strong>。檔名維持{' '}
        <code>exfolio-backup-*.json</code> 時會被 .gitignore 排除。
      </div>
      <p>
        <button className="primary" onClick={exportData}>
          匯出 JSON 備份
        </button>{' '}
        <button onClick={() => fileRef.current?.click()}>從檔案還原…</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </p>
      {errors.length > 0 && (
        <>
          <p className="neg">備份檔驗證失敗，未做任何變更：</p>
          <ul className="settings-form-errors">
            {errors.slice(0, 20).map((e) => (
              <li key={e}>{e}</li>
            ))}
            {errors.length > 20 && <li>…另有 {errors.length - 20} 項</li>}
          </ul>
        </>
      )}
      {pending && incoming && (
        <Modal
          title="確認還原"
          onClose={() => setPending(undefined)}
          footer={
            <>
              <button onClick={() => setPending(undefined)}>取消</button>
              <button
                className="danger"
                onClick={() => {
                  replaceAll(pending.data);
                  setPending(undefined);
                }}
              >
                覆蓋並還原
              </button>
            </>
          }
        >
          <p>
            檔案：{pending.name}（匯出時間 {fmtTime(pending.exportedAt)}）。還原會
            <strong>整份取代</strong>目前所有資料，無法復原；建議先匯出目前資料。
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>資料表</th>
                  <th className="num">目前</th>
                  <th className="num">還原後</th>
                </tr>
              </thead>
              <tbody>
                {TABLE_NAMES.map((t) => (
                  <tr key={t}>
                    <td>{TABLE_LABEL[t] ?? t}</td>
                    <td className="num">{current[t]}</td>
                    <td className="num">{incoming[t]}</td>
                  </tr>
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
    setTable('instruments', next.instruments);
    setMsg(`已新增 商品 ${added.instruments}、指數 ${added.indices}（既有資料未被覆蓋）`);
  };
  return (
    <Card title="預設商品" actions={<button onClick={load}>載入預設商品</button>}>
      <p className="muted">
        補上內建的商品與指數中 id
        尚不存在者；已存在的資料（含你的修改）不會被覆蓋。券商、銀行與交易所請到 Accounts &
        Positions 新增。
      </p>
      {msg && <p className="pos">{msg}</p>}
    </Card>
  );
}

export default function BackendTab() {
  const store = useStore();
  return (
    <>
      {IS_PUBLIC ? (
        <div className="notice">
          這個網站沒有後端，也沒有帳號：你輸入的資料存在這個瀏覽器裡，網站不會把它上傳到任何伺服器。
          網站會連到兩個地方取得公開報價：本站的報價快照，以及 Binance（只有你有啟用 Binance
          報價的商品時；Binance 會看到你查詢的交易對代號與你的 IP）。
          換瀏覽器、換裝置或清除網站資料前，請先匯出備份；在新的地方還原備份即可繼續使用。
        </div>
      ) : (
        <BackendCard />
      )}
      {!store.backendRemote && <LocalDataCard />}
      <BackupCard />
      <SeedCard />
    </>
  );
}
