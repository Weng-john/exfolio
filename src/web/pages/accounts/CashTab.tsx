import { cashTotals } from '@core/index';
import { useData } from '../../store';
import { usePortfolio } from '../../usePortfolio';
import { Badge, Card, Empty } from '../../components/ui';
import { fmtMoney, signClass } from '../../format';

export default function CashTab() {
  const data = useData();
  const { valuation: v } = usePortfolio();
  const base = v.baseCurrency;
  const totals = cashTotals(v.cash);
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? id;
  const rows = [...v.cash].sort(
    (a, b) => accountName(a.accountId).localeCompare(accountName(b.accountId)) || a.currency.localeCompare(b.currency),
  );

  return (
    <Card title="現金">
      {totals.overdrawn > 0 && (
        <div className="notice warn">
          有帳戶現金為負（透支），已視為負債，合計 {fmtMoney(totals.overdrawn, base)} {base}。請確認是否漏記入金或貸款。
        </div>
      )}
      {rows.length === 0 ? (
        <Empty>尚無現金餘額。</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>帳戶</th>
                <th>幣別</th>
                <th className="num">餘額</th>
                <th className="num">價值（{base}）</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={`${c.accountId}|${c.currency}`} className={c.amount < 0 ? 'acct-liability' : ''}>
                  <td>{accountName(c.accountId)}</td>
                  <td>{c.currency}</td>
                  <td className={`num ${signClass(c.amount)}`}>{fmtMoney(c.amount, c.currency)}</td>
                  <td className={`num ${signClass(c.value)}`}>{fmtMoney(c.value, base)}</td>
                  <td>{c.amount < 0 && <Badge tone="bad">透支 · 負債</Badge>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>合計（淨額）</td>
                <td className={`num ${signClass(totals.total)}`}>{fmtMoney(totals.total, base)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}
