import { useMemo, useState } from 'react';
import { positionTotals, type ValuedPosition } from '@core/index';
import { useData } from '../../store';
import { usePortfolio } from '../../usePortfolio';
import { QuickPosition } from '../../components/QuickPosition';
import { Badge, Card } from '../../components/ui';
import { EmptyState, Toggle } from '../../components/Primitives';
import { fmtMoney, fmtNum, fmtPct, fmtTime, signClass } from '../../format';
import { PRICE_STATUS_LABELS, PRICE_STATUS_TONES } from './labels';

export default function PositionsTab() {
  const data = useData();
  const { valuation: v } = usePortfolio();
  const [accountId, setAccountId] = useState('');
  const [grouped, setGrouped] = useState(true);
  const [adding, setAdding] = useState(false);
  const base = v.baseCurrency;
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? id;

  const rows = useMemo(
    () =>
      v.positions
        .filter((p) => !accountId || p.accountId === accountId)
        .sort(
          (a, b) =>
            accountName(a.accountId).localeCompare(accountName(b.accountId)) ||
            a.instrument.symbol.localeCompare(b.instrument.symbol),
        ),
    [v.positions, accountId, data.accounts],
  );
  const total = positionTotals(rows, v.nav);

  const line = (p: ValuedPosition) => (
    <tr key={p.key}>
      <td data-label="帳戶">{accountName(p.accountId)}</td>
      <td data-title>
        <strong>{p.instrument.symbol}</strong> <span className="muted">{p.instrument.name}</span>
      </td>
      <td data-label="策略">
        {p.bucket === 'core'
          ? 'core'
          : (data.strategies.find((s) => s.id === p.bucket)?.name ?? p.bucket)}
      </td>
      <td data-label="數量" className={`num ${signClass(p.quantity)}`}>
        {fmtNum(p.quantity, 4)}
      </td>
      <td data-label="均價" className="num">
        {fmtNum(p.avgCost, 4)}
      </td>
      <td data-label="現價" className="num">
        {fmtNum(p.price, 4)}{' '}
        <Badge tone={PRICE_STATUS_TONES[p.priceStatus]}>{PRICE_STATUS_LABELS[p.priceStatus]}</Badge>
        <div className="muted stack-hide">{fmtTime(p.priceAsOf)}</div>
      </td>
      <td data-label="市值" className="num">
        {fmtMoney(p.marketValue, base)}
      </td>
      <td data-label="曝險" className={`num ${signClass(p.exposure)}`}>
        {fmtMoney(p.exposure, base)}
      </td>
      <td data-label="未實現損益" className={`num ${signClass(p.unrealizedPnl)}`}>
        {fmtMoney(p.unrealizedPnl, base)}
      </td>
      <td data-label="已實現損益" className={`num ${signClass(p.realizedPnl)}`}>
        {fmtMoney(p.realizedPnl * p.fxRate, base)}
      </td>
      <td data-label="曝險 / NAV" className="num">
        {fmtPct(v.nav > 0 ? p.exposure / v.nav : undefined)}
      </td>
    </tr>
  );

  const accountIds = [...new Set(rows.map((p) => p.accountId))];

  return (
    <Card
      title="持倉"
      actions={
        <>
          <button className="primary" onClick={() => setAdding(true)}>
            ＋ 新增倉位
          </button>
          <Toggle label="依帳戶分組" checked={grouped} onChange={setGrouped} />
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            aria-label="帳戶篩選"
          >
            <option value="">全部帳戶</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </>
      }
    >
      {v.warnings.length > 0 && (
        <div className="notice warn">
          {v.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState
          title="建立第一筆倉位"
          action={
            <button className="primary" onClick={() => setAdding(true)}>
              ＋ 新增倉位
            </button>
          }
        >
          選擇商品並輸入數量與均價，開始查看實際曝險。
        </EmptyState>
      ) : (
        <div className="table-wrap" role="region" aria-label="持倉（可左右捲動）" tabIndex={0}>
          <table className={`stack-table stack-3 ${grouped ? 'grouped' : ''}`}>
            <thead>
              <tr>
                <th>帳戶</th>
                <th>商品</th>
                <th>策略</th>
                <th className="num">數量</th>
                <th className="num">均價</th>
                <th className="num">現價 / 報價時間</th>
                <th className="num">市值（{base}）</th>
                <th className="num">曝險</th>
                <th className="num">未實現損益</th>
                <th className="num">已實現損益</th>
                <th className="num">曝險 / NAV</th>
              </tr>
            </thead>
            <tbody>
              {grouped
                ? accountIds.map((id) => {
                    const group = rows.filter((p) => p.accountId === id);
                    const t = positionTotals(group, v.nav);
                    return [
                      <tr key={`g-${id}`} className="acct-group">
                        <td colSpan={6} data-title>
                          {accountName(id)}
                        </td>
                        <td data-label="市值" className="num">
                          {fmtMoney(t.marketValue, base)}
                        </td>
                        <td data-label="曝險" className="num">
                          {fmtMoney(t.exposure, base)}
                        </td>
                        <td data-label="未實現損益" className="num">
                          {fmtMoney(t.unrealizedPnl, base)}
                        </td>
                        <td data-label="已實現損益" className="num">
                          {fmtMoney(t.realizedPnl, base)}
                        </td>
                        <td data-label="曝險 / NAV" className="num">
                          {fmtPct(t.exposureToNav)}
                        </td>
                      </tr>,
                      ...group.map(line),
                    ];
                  })
                : rows.map(line)}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} data-title>
                  合計
                </td>
                <td data-label="市值" className="num">
                  {fmtMoney(total.marketValue, base)}
                </td>
                <td data-label="曝險" className={`num ${signClass(total.exposure)}`}>
                  {fmtMoney(total.exposure, base)}
                </td>
                <td data-label="未實現損益" className={`num ${signClass(total.unrealizedPnl)}`}>
                  {fmtMoney(total.unrealizedPnl, base)}
                </td>
                <td data-label="已實現損益" className={`num ${signClass(total.realizedPnl)}`}>
                  {fmtMoney(total.realizedPnl, base)}
                </td>
                <td data-label="曝險 / NAV" className="num">
                  {fmtPct(total.exposureToNav)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="muted">
        期貨 / 永續合約市值為 0（損益結算到現金），曝險為名目價值 ×
        每日目標槓桿。已實現損益未扣手續費。
      </p>
      {adding && <QuickPosition onClose={() => setAdding(false)} />}
    </Card>
  );
}
