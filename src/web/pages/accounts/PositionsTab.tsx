import { useMemo, useState } from 'react';
import { positionTotals, type ValuedPosition } from '@core/index';
import { useData } from '../../store';
import { usePortfolio } from '../../usePortfolio';
import { Badge, Card, Empty } from '../../components/ui';
import { fmtMoney, fmtNum, fmtPct, fmtTime, signClass } from '../../format';
import { PRICE_STATUS_LABELS, PRICE_STATUS_TONES } from './labels';

export default function PositionsTab() {
  const data = useData();
  const { valuation: v } = usePortfolio();
  const [accountId, setAccountId] = useState('');
  const [grouped, setGrouped] = useState(true);
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
      <td>{accountName(p.accountId)}</td>
      <td>
        <strong>{p.instrument.symbol}</strong> <span className="muted">{p.instrument.name}</span>
      </td>
      <td>
        {p.bucket === 'core'
          ? 'core'
          : (data.strategies.find((s) => s.id === p.bucket)?.name ?? p.bucket)}
      </td>
      <td className={`num ${signClass(p.quantity)}`}>{fmtNum(p.quantity, 4)}</td>
      <td className="num">{fmtNum(p.avgCost, 4)}</td>
      <td className="num">
        {fmtNum(p.price, 4)}{' '}
        <Badge tone={PRICE_STATUS_TONES[p.priceStatus]}>{PRICE_STATUS_LABELS[p.priceStatus]}</Badge>
        <div className="muted">{fmtTime(p.priceAsOf)}</div>
      </td>
      <td className="num">{fmtMoney(p.marketValue, base)}</td>
      <td className={`num ${signClass(p.exposure)}`}>{fmtMoney(p.exposure, base)}</td>
      <td className={`num ${signClass(p.unrealizedPnl)}`}>{fmtMoney(p.unrealizedPnl, base)}</td>
      <td className={`num ${signClass(p.realizedPnl)}`}>
        {fmtMoney(p.realizedPnl * p.fxRate, base)}
      </td>
      <td className="num">{fmtPct(v.nav > 0 ? p.exposure / v.nav : undefined)}</td>
    </tr>
  );

  const accountIds = [...new Set(rows.map((p) => p.accountId))];

  return (
    <Card
      title="持倉"
      actions={
        <>
          <label>
            <input
              type="checkbox"
              checked={grouped}
              onChange={(e) => setGrouped(e.target.checked)}
            />{' '}
            依帳戶分組
          </label>
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
        <Empty>尚無持倉。到「交易」分頁新增買進紀錄。</Empty>
      ) : (
        <div className="table-wrap">
          <table>
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
                        <td colSpan={6}>{accountName(id)}</td>
                        <td className="num">{fmtMoney(t.marketValue, base)}</td>
                        <td className="num">{fmtMoney(t.exposure, base)}</td>
                        <td className="num">{fmtMoney(t.unrealizedPnl, base)}</td>
                        <td className="num">{fmtMoney(t.realizedPnl, base)}</td>
                        <td className="num">{fmtPct(t.exposureToNav)}</td>
                      </tr>,
                      ...group.map(line),
                    ];
                  })
                : rows.map(line)}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>合計</td>
                <td className="num">{fmtMoney(total.marketValue, base)}</td>
                <td className={`num ${signClass(total.exposure)}`}>
                  {fmtMoney(total.exposure, base)}
                </td>
                <td className={`num ${signClass(total.unrealizedPnl)}`}>
                  {fmtMoney(total.unrealizedPnl, base)}
                </td>
                <td className={`num ${signClass(total.realizedPnl)}`}>
                  {fmtMoney(total.realizedPnl, base)}
                </td>
                <td className="num">{fmtPct(total.exposureToNav)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="muted">
        期貨 / 永續合約市值為 0（損益結算到現金），曝險為名目價值 ×
        每日目標槓桿。已實現損益未扣手續費。
      </p>
    </Card>
  );
}
