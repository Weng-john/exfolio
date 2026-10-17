import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  reconcile,
  tradesToTransactions,
  type ExchangeSnapshot,
  type IntegrationInfo,
  type IntegrationStatus,
  type TradeImport,
} from '@core/index';
import { api } from '../../auth';
import { Badge, Card, Empty, Field } from '../../components/ui';
import { fmtNum, fmtTime } from '../../format';
import { setTable, useData, useStore } from '../../store';
import { usePortfolio } from '../../usePortfolio';
import { confirmDialog } from '../../dialog';

/** Read-only exchange connections: compare the exchange with the ledger and import fills. */
export default function ExchangeTab() {
  const data = useData();
  const store = useStore();
  const portfolio = usePortfolio();
  const [status, setStatus] = useState<IntegrationStatus>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<IntegrationInfo>();
  const [snapshot, setSnapshot] = useState<ExchangeSnapshot>();
  const cryptoAccounts = data.accounts.filter((a) => a.type === 'crypto');
  const [accountId, setAccountId] = useState(cryptoAccounts[0]?.id ?? '');
  const [pending, setPending] = useState<TradeImport>();

  const run = useCallback(async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    if (store.demo) return;
    void run(async () => setStatus((await api({ action: 'integrationStatus' })).integrations));
  }, [run, store.demo]);

  const check = useMemo(
    () => (snapshot && accountId ? reconcile(data, portfolio, accountId, snapshot) : undefined),
    [data, portfolio, accountId, snapshot],
  );

  if (store.demo) {
    return <div className="notice">預覽模式無法連接交易所。登入後才能新增唯讀連線。</div>;
  }

  const sync = (integration: IntegrationInfo) =>
    void run(async () => {
      setSelected(integration);
      setPending(undefined);
      setSnapshot((await api({ action: 'integrationSync', id: integration.id })).snapshot);
      setStatus((await api({ action: 'integrationStatus' })).integrations);
    });

  const remove = async (integration: IntegrationInfo) => {
    if (
      !(await confirmDialog(`刪除連線「${integration.label}」？後端保存的金鑰會一併刪除。`, {
        tone: 'danger',
        confirmText: '刪除',
      }))
    )
      return;
    void run(async () => {
      setStatus((await api({ action: 'integrationDelete', id: integration.id })).integrations);
      if (selected?.id === integration.id) {
        setSelected(undefined);
        setSnapshot(undefined);
      }
    });
  };

  const fetchTrades = (market: 'spot' | 'futures', symbol: string, since: string) =>
    void run(async () => {
      if (!selected || !accountId) throw new Error('請先同步一個連線並選擇對應的帳戶');
      const res = await api({
        action: 'integrationTrades',
        id: selected.id,
        market,
        symbol,
        ...(since ? { since } : {}),
      });
      setPending(tradesToTransactions(data, res.trades ?? [], { accountId }));
    });

  const confirmImport = () => {
    if (!pending?.transactions.length) return;
    setTable('transactions', [...data.transactions, ...pending.transactions]);
    setNotice(`已匯入 ${pending.transactions.length} 筆成交`);
    setPending(undefined);
  };

  return (
    <>
      <div className="notice">
        這裡只接受<strong>唯讀</strong>的 API
        金鑰：後端會向交易所確認權限，能交易、提領或劃轉的金鑰一律拒絕。
        金鑰加密保存在後端，不會回傳到瀏覽器，也不會出現在備份檔。本網站不會下單。
      </div>
      {error && <div className="notice warn">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {status && !status.enabled && (
        <div className="notice warn">這個後端尚未啟用交易所同步：{status.reason}</div>
      )}

      <Card title="唯讀連線">
        {!status?.list.length ? (
          <Empty>尚未建立連線。</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名稱</th>
                  <th>交易所</th>
                  <th>金鑰末四碼</th>
                  <th>建立時間</th>
                  <th>上次同步</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {status.list.map((i) => (
                  <tr key={i.id}>
                    <td>{i.label}</td>
                    <td>Binance</td>
                    <td>…{i.keyHint}</td>
                    <td>{fmtTime(i.createdAt)}</td>
                    <td>{fmtTime(i.lastSyncAt)}</td>
                    <td className="actions">
                      <button className="primary" disabled={busy} onClick={() => sync(i)}>
                        同步
                      </button>
                      <button className="danger" disabled={busy} onClick={() => remove(i)}>
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {status?.enabled && <AddForm busy={busy} onSaved={setStatus} run={run} />}
      </Card>

      {snapshot && selected && (
        <>
          <Card title={`核對：${selected.label}`}>
            <div className="form-grid">
              <Field label="對應的帳戶" hint="交易所的餘額會與這個帳戶的現金、現貨與合約部位比對">
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">請選擇</option>
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="muted">交易所資料時間：{fmtTime(snapshot.fetchedAt)}</p>
            {snapshot.warnings.map((w) => (
              <p key={w} className="warn">
                {w}
              </p>
            ))}
            {!check ? (
              <Empty>選擇帳戶後顯示核對結果。</Empty>
            ) : (
              <>
                <p>
                  {check.clean ? (
                    <Badge tone="ok">帳本與交易所一致</Badge>
                  ) : (
                    <Badge tone="warn">有差異</Badge>
                  )}
                </p>
                <CheckTable
                  title="餘額（現貨 + 合約錢包）"
                  rows={check.balances.map((b) => ({ key: b.asset, ...b }))}
                />
                {check.positions.length > 0 && (
                  <CheckTable
                    title="合約部位（口數，空單為負）"
                    rows={check.positions.map((p) => ({ key: p.symbol, ...p }))}
                  />
                )}
                <p className="muted">
                  差異代表帳本少記或多記了入金、成交、手續費或資金費用。系統不會自動調整帳本：請匯入成交或手動補記。
                </p>
              </>
            )}
          </Card>

          <Card title="匯入成交">
            <TradeForm busy={busy} onFetch={fetchTrades} />
            {pending && (
              <>
                <p>
                  可匯入 {pending.transactions.length} 筆；已存在而略過 {pending.duplicates} 筆
                  {pending.unmatched.length > 0 &&
                    `；找不到對應商品：${pending.unmatched.join('、')}（請先到商品登錄新增，報價代號填交易對）`}
                  。
                </p>
                {pending.warnings.map((w) => (
                  <p key={w} className="warn">
                    {w}
                  </p>
                ))}
                {pending.transactions.length > 0 && (
                  <>
                    <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
                      <table>
                        <thead>
                          <tr>
                            <th>日期</th>
                            <th>買賣</th>
                            <th>商品</th>
                            <th className="num">數量</th>
                            <th className="num">價格</th>
                            <th className="num">手續費</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pending.transactions.map((t) => (
                            <tr key={t.id}>
                              <td>{t.date}</td>
                              <td>{t.type === 'buy' ? '買' : '賣'}</td>
                              <td>
                                {data.instruments.find((i) => i.id === t.instrumentId)?.symbol}
                              </td>
                              <td className="num">{fmtNum(t.quantity, 8)}</td>
                              <td className="num">{fmtNum(t.price, 8)}</td>
                              <td className="num">{fmtNum(t.fee, 8)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="actions">
                      <button className="primary" onClick={confirmImport}>
                        確認匯入
                      </button>
                      <button className="ghost" onClick={() => setPending(undefined)}>
                        取消
                      </button>
                    </p>
                  </>
                )}
              </>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function AddForm(props: {
  busy: boolean;
  onSaved: (status: IntegrationStatus | undefined) => void;
  run: (task: () => Promise<void>) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void props.run(async () => {
      const res = await api({
        action: 'integrationSave',
        provider: 'binance',
        label,
        apiKey,
        apiSecret,
      });
      props.onSaved(res.integrations);
      // Do not keep the secret in the page any longer than needed.
      setApiKey('');
      setApiSecret('');
      setLabel('');
    });
  };
  return (
    <form onSubmit={submit}>
      <h2 style={{ margin: '16px 0 8px' }}>新增 Binance 唯讀連線</h2>
      <div className="form-grid">
        <Field label="名稱">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如：主帳戶"
          />
        </Field>
        <Field label="API Key">
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
            required
          />
        </Field>
        <Field label="API Secret">
          <input
            type="password"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            autoComplete="off"
            required
          />
        </Field>
      </div>
      <p className="muted">
        請在 Binance 的 API 管理頁建立<strong>只勾選「啟用讀取」</strong>的金鑰，並建議綁定後端的
        IP。
      </p>
      <button className="primary" type="submit" disabled={props.busy}>
        {props.busy ? '確認權限中…' : '確認權限並保存'}
      </button>
    </form>
  );
}

function TradeForm(props: {
  busy: boolean;
  onFetch: (market: 'spot' | 'futures', symbol: string, since: string) => void;
}) {
  const [market, setMarket] = useState<'spot' | 'futures'>('spot');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [since, setSince] = useState('');
  return (
    <>
      <div className="form-grid">
        <Field label="市場">
          <select value={market} onChange={(e) => setMarket(e.target.value as 'spot' | 'futures')}>
            <option value="spot">現貨</option>
            <option value="futures">U 本位合約</option>
          </select>
        </Field>
        <Field label="交易對" hint="例如 BTCUSDT；需與商品登錄的報價代號相同">
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
        </Field>
        <Field label="起始日期（選填）" hint="交易所一次最多回傳 1000 筆">
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </Field>
      </div>
      <p className="actions">
        <button
          disabled={props.busy || !symbol}
          onClick={() => props.onFetch(market, symbol, since)}
        >
          讀取成交
        </button>
      </p>
    </>
  );
}

function CheckTable(props: {
  title: string;
  rows: Array<{
    key: string;
    exchange: number;
    ledger: number;
    difference: number;
    matches: boolean;
  }>;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{props.title}</th>
            <th className="num">交易所</th>
            <th className="num">帳本</th>
            <th className="num">差異</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r) => (
            <tr key={r.key}>
              <td>{r.key}</td>
              <td className="num">{fmtNum(r.exchange, 8)}</td>
              <td className="num">{fmtNum(r.ledger, 8)}</td>
              <td className={`num ${r.matches ? '' : 'neg'}`}>
                {r.matches ? '—' : fmtNum(r.difference, 8)}
              </td>
              <td>
                {r.matches ? <Badge tone="ok">一致</Badge> : <Badge tone="warn">不一致</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
