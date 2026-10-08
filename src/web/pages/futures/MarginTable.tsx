import type { MarginByAccount } from '@core/index';
import { Badge, Card, Empty } from '../../components/ui';
import { fmtMoney, signClass } from '../../format';

/** A margin figure, or a warning badge when an instrument lacks its margin spec. */
function MarginCell({
  missing,
  amount,
  currency,
}: {
  missing: boolean;
  amount?: number;
  currency: string;
}) {
  return (
    <td className="num">
      {missing ? <Badge tone="warn">缺規格</Badge> : fmtMoney(amount, currency)}
    </td>
  );
}

export function MarginTable({ margins }: { margins: MarginByAccount[] }) {
  return (
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
              {margins.map((m) => {
                const currency = m.baseCurrency;
                return (
                  <tr key={m.accountId}>
                    <td>{m.accountName}</td>
                    <td>{currency}</td>
                    <td className="num">{fmtMoney(m.cash, currency)}</td>
                    <td className={`num ${signClass(m.unrealizedPnl)}`}>
                      {fmtMoney(m.unrealizedPnl, currency)}
                    </td>
                    <td className="num">{fmtMoney(m.equity, currency)}</td>
                    <MarginCell
                      missing={m.marginSpecMissing}
                      amount={m.initialMarginRequired}
                      currency={currency}
                    />
                    <MarginCell
                      missing={m.marginSpecMissing}
                      amount={m.maintenanceMarginRequired}
                      currency={currency}
                    />
                    <td className={`num ${m.shortfall ? 'neg' : 'pos'}`}>
                      {m.shortfall
                        ? `-${fmtMoney(m.shortfall, currency)}`
                        : fmtMoney(m.excessMaintenance, currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
