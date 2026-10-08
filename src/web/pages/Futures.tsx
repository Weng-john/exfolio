import { useMemo, useState } from 'react';
import {
  bookRollover,
  buildNotifications,
  futuresPositions,
  marginByAccount,
  planRollover,
  seriesHistory,
  today as currentDay,
  type FuturesPosition,
  type Instrument,
  type Notification,
  type RolloverPlan,
} from '@core/index';
import { Badge, Card, Empty, Field, PageHeader, Stat } from '../components/ui';
import { fmtMoney, fmtNum, fmtPct, signClass } from '../format';
import { upsertRow, useData } from '../store';
import { usePortfolio } from '../usePortfolio';
import './futures/futures.css';

const LEVEL_TONE = { info: 'info', warn: 'warn', bad: 'bad' } as const;

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
function instrumentLabel(instrument: Instrument): string {
  return `${instrument.symbol}${instrument.expiry ? ` · ${instrument.expiry}` : ''}`;
}

export default function FuturesPage() {
  const data = useData();
  const portfolio = usePortfolio();
  const day = currentDay();
  const base = portfolio.valuation.baseCurrency;
  const positions = useMemo(() => futuresPositions(data, portfolio, day), [data, portfolio, day]);
  const margins = useMemo(() => marginByAccount(data, portfolio), [data, portfolio]);
  const notifications = useMemo<Notification[]>(
    () => buildNotifications(data, portfolio, day),
    [data, portfolio, day],
  );
  const [selectedKey, setSelectedKey] = useState<string>();
  const [targetId, setTargetId] = useState('');
  const [plan, setPlan] = useState<RolloverPlan>();
  const [actualClose, setActualClose] = useState('');
  const [actualOpen, setActualOpen] = useState('');
  const [error, setError] = useState<string>();

  const selected = positions.find((p) => p.key === selectedKey) ?? positions[0];
  const series = useMemo(() => {
    const map = new Map<string, Instrument[]>();
    for (const instrument of data.instruments) {
      if ((instrument.type !== 'future' && instrument.type !== 'perpetual') || !instrument.seriesId)
        continue;
      const list = map.get(instrument.seriesId) ?? [];
      list.push(instrument);
      map.set(instrument.seriesId, list);
    }
    return [...map.entries()].map(([seriesId, instruments]) => ({
      seriesId,
      instruments: instruments.sort((a, b) =>
        (a.expiry ?? '9999-12-31').localeCompare(b.expiry ?? '9999-12-31'),
      ),
    }));
  }, [data.instruments]);
  const selectedSeries = selected
    ? series.find((s) => s.seriesId === selected.seriesId)
    : undefined;
  const targetContracts =
    selectedSeries?.instruments.filter((i) => i.id !== selected?.instrumentId) ?? [];
  const priceMap = Object.fromEntries(data.prices.map((p) => [p.id, p.price]));

  const totalGross = positions.reduce((s, p) => s + Math.abs(p.notionalBase), 0);
  const totalNet = positions.reduce((s, p) => s + p.notionalBase, 0);
  const futuresExposure = positions.reduce((s, p) => s + p.exposure, 0);
  const nearest = positions.find((p) => p.expiry);
  const requiredInitial = margins.every((m) => m.initialMarginRequired !== undefined)
    ? margins.reduce((s, m) => s + (m.initialMarginRequired ?? 0), 0)
    : undefined;
  const accountEquity = margins.reduce((s, m) => s + m.equity, 0);

  const choosePosition = (position: FuturesPosition) => {
    setSelectedKey(position.key);
    setPlan(undefined);
    setTargetId('');
    setError(undefined);
  };

  const makePlan = () => {
    if (!selected || !targetId) return;
    try {
      setPlan(planRollover(data, selected, targetId, priceMap));
      setActualClose('');
      setActualOpen('');
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmRoll = () => {
    if (!plan) return;
    try {
      const booked = bookRollover(
        data,
        plan,
        {
          [plan.fromInstrumentId]: optionalNumber(actualClose) ?? plan.fromPrice,
          [plan.toInstrumentId]: optionalNumber(actualOpen) ?? plan.toPrice,
        },
        day,
      );
      booked.transactions.forEach((tx) => upsertRow('transactions', tx));
      upsertRow('rollovers', booked.rollover);
      setPlan(undefined);
      setTargetId('');
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const addNextContract = (seriesId: string) => {
    const group = series.find((s) => s.seriesId === seriesId);
    const template = group?.instruments[0];
    if (!template) return;
    const lastExpiry = [...(group?.instruments ?? [])].reverse().find((i) => i.expiry)?.expiry;
    const nextExpiry = lastExpiry ? addOneMonth(lastExpiry) : addOneMonth(day);
    let id = `${seriesId}_${nextExpiry.replace('-', '').slice(0, 6)}`;
    if (data.instruments.some((i) => i.id === id)) id = `${id}_${data.instruments.length}`;
    upsertRow('instruments', {
      ...template,
      id,
      symbol: `${template.symbol}-${nextExpiry.slice(0, 7).replace('-', '')}`,
      name: `${template.name} ${nextExpiry.slice(0, 7)}`,
      seriesId,
      expiry: nextExpiry,
      active: true,
    });
  };

  const editInstrument = (
    instrument: Instrument,
    field: 'expiry' | 'initialMargin' | 'maintenanceMargin',
    value: string,
  ) => {
    upsertRow('instruments', {
      ...instrument,
      [field]: field === 'expiry' ? value || undefined : optionalNumber(value),
    });
  };

  const history = series.map((s) => seriesHistory(data, s.seriesId));
  const futureNotifications = notifications.filter(
    (n) => n.category === 'futures-expiry' || n.category === 'futures-margin',
  );

  return (
    <>
      <PageHeader
        title="Futures & Rollover"
        subtitle={`期貨、永續合約、保證金與轉倉；所有金額以 ${base} 計`}
      />

      <div className="stats">
        <Stat
          label="Futures Gross Notional"
          value={fmtMoney(totalGross, base)}
          hint="未乘每日槓桿"
        />
        <Stat
          label="Futures Net Notional"
          value={fmtMoney(totalNet, base)}
          hint="帶符號名目曝險"
          tone={totalNet >= 0 ? 'pos' : 'neg'}
        />
        <Stat
          label="Exposure / NAV"
          value={fmtPct(
            portfolio.valuation.nav > 0 ? futuresExposure / portfolio.valuation.nav : undefined,
          )}
          hint="期貨曝險以 NAV 為分母"
        />
        <Stat
          label="Initial Margin"
          value={requiredInitial === undefined ? '—' : fmtMoney(requiredInitial, base)}
          hint={
            requiredInitial === undefined
              ? '有合約缺少保證金規格'
              : `帳戶權益 ${fmtMoney(accountEquity, base)}`
          }
        />
        <Stat
          label="最近到期"
          value={nearest?.expiry ?? '—'}
          hint={nearest ? `${nearest.symbol} · ${nearest.daysToExpiry} 天` : undefined}
        />
      </div>

      {error && <div className="notice futures-error">{error}</div>}

      <Card title="期貨部位">
        {!positions.length ? (
          <Empty>目前沒有未平倉期貨或永續合約。</Empty>
        ) : (
          <div className="table-wrap">
            <table className="futures-table">
              <thead>
                <tr>
                  <th>商品 / 帳戶</th>
                  <th>Series</th>
                  <th className="num">口數</th>
                  <th className="num">均價</th>
                  <th className="num">現價</th>
                  <th>到期</th>
                  <th className="num">Notional</th>
                  <th className="num">Exposure / NAV</th>
                  <th className="num">保證金</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr
                    key={p.key}
                    className={`clickable ${selected?.key === p.key ? 'selected' : ''}`}
                    onClick={() => choosePosition(p)}
                  >
                    <td>
                      {p.symbol}
                      <span className="muted futures-sub">
                        {data.accounts.find((a) => a.id === p.accountId)?.name ?? p.accountId} ·{' '}
                        {p.bucket === 'core'
                          ? 'Core'
                          : (data.strategies.find((st) => st.id === p.bucket)?.name ?? p.bucket)}
                      </span>
                    </td>
                    <td>{p.seriesId}</td>
                    <td className={`num ${signClass(p.contracts)}`}>{fmtNum(p.contracts)}</td>
                    <td className="num">{fmtNum(p.averagePrice)}</td>
                    <td className="num">
                      {fmtNum(p.currentPrice)}{' '}
                      <Badge tone={p.status === 'missing' || p.status === 'stale' ? 'warn' : 'ok'}>
                        {p.status}
                      </Badge>
                    </td>
                    <td>
                      {p.expiry ? (
                        <>
                          <span
                            className={
                              p.daysToExpiry !== undefined && p.daysToExpiry <= 7 ? 'warn' : ''
                            }
                          >
                            {p.expiry}
                          </span>{' '}
                          <Badge
                            tone={
                              p.daysToExpiry !== undefined && p.daysToExpiry < 0
                                ? 'bad'
                                : p.daysToExpiry !== undefined && p.daysToExpiry <= 7
                                  ? 'warn'
                                  : 'info'
                            }
                          >
                            {p.daysToExpiry === undefined ? '—' : `${p.daysToExpiry} 天`}
                          </Badge>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={`num ${signClass(p.notionalBase)}`}>
                      {fmtMoney(p.notionalBase, base)}
                    </td>
                    <td className={`num ${signClass(p.exposureNav)}`}>{fmtPct(p.exposureNav)}</td>
                    <td className="num">
                      {p.marginSpecMissing ? (
                        <Badge tone="warn">缺規格</Badge>
                      ) : (
                        fmtMoney(p.initialMarginRequired, p.currency)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted futures-note">
          期貨不計市值；未實現損益進入帳戶權益。Margin 是現金占用，不是名目曝險，也不是負債。
        </p>
      </Card>

      <Card title="各帳戶保證金">
        {!margins.length ? (
          <Empty>沒有持有衍生品的帳戶。</Empty>
        ) : (
          <div className="table-wrap">
            <table className="futures-table">
              <thead>
                <tr>
                  <th>帳戶</th>
                  <th>幣別</th>
                  <th className="num">Cash</th>
                  <th className="num">未實現損益</th>
                  <th className="num">Account Equity</th>
                  <th className="num">Initial</th>
                  <th className="num">Maintenance</th>
                  <th className="num">超額 / 短缺</th>
                </tr>
              </thead>
              <tbody>
                {margins.map((m) => (
                  <tr key={m.accountId}>
                    <td>{m.accountName}</td>
                    <td>{m.baseCurrency}</td>
                    <td className="num">{fmtMoney(m.cash, m.baseCurrency)}</td>
                    <td className={`num ${signClass(m.unrealizedPnl)}`}>
                      {fmtMoney(m.unrealizedPnl, m.baseCurrency)}
                    </td>
                    <td className="num">{fmtMoney(m.equity, m.baseCurrency)}</td>
                    <td className="num">
                      {m.marginSpecMissing ? (
                        <Badge tone="warn">缺規格</Badge>
                      ) : (
                        fmtMoney(m.initialMarginRequired, m.baseCurrency)
                      )}
                    </td>
                    <td className="num">
                      {m.marginSpecMissing ? (
                        <Badge tone="warn">缺規格</Badge>
                      ) : (
                        fmtMoney(m.maintenanceMarginRequired, m.baseCurrency)
                      )}
                    </td>
                    <td className={`num ${m.shortfall ? 'neg' : 'pos'}`}>
                      {m.shortfall
                        ? `-${fmtMoney(m.shortfall, m.baseCurrency)}`
                        : fmtMoney(m.excessMaintenance, m.baseCurrency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="轉倉計畫">
        <div className="form-grid">
          <Field label="未平倉部位">
            <select
              value={selected?.key ?? ''}
              onChange={(e) => {
                const p = positions.find((x) => x.key === e.target.value);
                if (p) choosePosition(p);
              }}
            >
              <option value="">選擇部位</option>
              {positions.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.symbol} · {p.contracts} 口 · {p.expiry ?? '無到期日'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="目標合約">
            <select
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value);
                setPlan(undefined);
              }}
              disabled={!selected}
            >
              <option value="">選擇同一 Series 的合約</option>
              {targetContracts.map((i) => (
                <option key={i.id} value={i.id}>
                  {instrumentLabel(i)}
                </option>
              ))}
            </select>
          </Field>
          <div className="futures-action">
            <button className="primary" onClick={makePlan} disabled={!selected || !targetId}>
              計算 Plan
            </button>
          </div>
        </div>
        {plan && (
          <div className="roll-plan">
            <div className="roll-plan-grid">
              <div>
                <span className="field-label">Calendar spread</span>
                <strong>{fmtNum(plan.spread)}</strong>
              </div>
              <div>
                <span className="field-label">Spread cost</span>
                <strong className={signClass(plan.spreadCost)}>
                  {fmtMoney(plan.spreadCost, plan.currency)}
                </strong>
              </div>
              <div>
                <span className="field-label">Estimated fees / tax</span>
                <strong>{fmtMoney(plan.estimatedCosts, plan.currency)}</strong>
              </div>
              <div>
                <span className="field-label">Margin change</span>
                <strong>
                  {plan.marginChange === undefined
                    ? '缺規格'
                    : fmtMoney(plan.marginChange, plan.currency)}
                </strong>
              </div>
            </div>
            <div className="form-grid">
              <Field label="實際平倉價" hint="留白使用 Plan 價格">
                <input
                  type="number"
                  value={actualClose}
                  onChange={(e) => setActualClose(e.target.value)}
                />
              </Field>
              <Field label="實際開倉價" hint="留白使用 Plan 價格">
                <input
                  type="number"
                  value={actualOpen}
                  onChange={(e) => setActualOpen(e.target.value)}
                />
              </Field>
            </div>
            <p className="muted">確認後只會記錄你已在券商執行的兩筆成交；本網站不送出任何訂單。</p>
            <button className="primary" onClick={confirmRoll}>
              確認並記錄轉倉
            </button>
          </div>
        )}
      </Card>

      <Card title="合約月份管理">
        {!series.length ? (
          <Empty>尚未建立 futures series。</Empty>
        ) : (
          series.map((s) => (
            <div className="contract-series" key={s.seriesId}>
              <div className="card-head">
                <h2>{s.seriesId}</h2>
                <button onClick={() => addNextContract(s.seriesId)}>新增下個月份</button>
              </div>
              <div className="table-wrap">
                <table className="futures-table">
                  <thead>
                    <tr>
                      <th>商品</th>
                      <th>到期日</th>
                      <th>Initial Margin</th>
                      <th>Maintenance Margin</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {s.instruments.map((i) => (
                      <tr key={i.id}>
                        <td>
                          {i.symbol}
                          <span className="muted futures-sub">{i.id}</span>
                        </td>
                        <td>
                          <input
                            type="date"
                            value={i.expiry ?? ''}
                            onChange={(e) => editInstrument(i, 'expiry', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={i.initialMargin ?? ''}
                            onChange={(e) => editInstrument(i, 'initialMargin', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={i.maintenanceMargin ?? ''}
                            onChange={(e) => editInstrument(i, 'maintenanceMargin', e.target.value)}
                          />
                        </td>
                        <td>
                          {i.initialMargin === undefined || i.maintenanceMargin === undefined ? (
                            <Badge tone="warn">缺規格</Badge>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </Card>

      <Card title="轉倉歷史">
        {history.every((h) => !h.rollovers.length) ? (
          <Empty>尚未記錄轉倉。</Empty>
        ) : (
          history
            .filter((h) => h.rollovers.length)
            .map((h) => (
              <div className="history-row" key={h.seriesId}>
                <strong>{h.seriesId}</strong>
                <span>
                  累積轉倉成本{' '}
                  <b className={signClass(h.cumulativeRollCost)}>
                    {fmtMoney(h.cumulativeRollCost, h.baseCurrency)}
                  </b>
                </span>
                <span>已實現損益 {fmtMoney(h.cumulativeRealizedPnl, h.baseCurrency)}</span>
                <span>費用 {fmtMoney(h.cumulativeFees, h.baseCurrency)}</span>
                <span>{h.rollovers.length} 次</span>
              </div>
            ))
        )}
      </Card>

      <Card title="轉倉模式與通知">
        <div className="roll-modes">
          <div>
            <Badge tone="ok">A · 提醒</Badge>
            <p>到期前提醒，由使用者自行在券商交易。</p>
          </div>
          <div>
            <Badge tone="ok">B · 半自動</Badge>
            <p>計算口數與價差，使用者確認後才記錄成交；本頁不送單。</p>
          </div>
          <div>
            <Badge tone="warn">C · 全自動</Badge>
            <p>尚未實作；需要持續運行、具安全控管的交易後端。</p>
          </div>
        </div>
        {!futureNotifications.length ? (
          <Empty>目前沒有期貨到期或保證金通知。</Empty>
        ) : (
          <div className="notification-list">
            {futureNotifications.map((n) => (
              <div key={n.id}>
                <Badge tone={LEVEL_TONE[n.level]}>{n.level}</Badge>
                <span>
                  <strong>{n.title}</strong> · {n.detail}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function addOneMonth(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const maxDay =
    nextMonth === 2
      ? nextYear % 4 === 0 && (nextYear % 100 !== 0 || nextYear % 400 === 0)
        ? 29
        : 28
      : [4, 6, 9, 11].includes(nextMonth)
        ? 30
        : 31;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(Math.min(day, maxDay)).padStart(2, '0')}`;
}
