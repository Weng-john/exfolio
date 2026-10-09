import {
  BALANCING_EXPLANATION,
  type AppData,
  type BalancingMode,
  type ImportImpact,
  type Transaction,
} from '@core/index';
import { Badge, Empty } from '../../../components/ui';
import { fmtMoney, fmtNum, signClass } from '../../../format';

export interface ImpactStepProps {
  data: AppData;
  impact: ImportImpact;
  mode: BalancingMode;
  deposits: Transaction[];
  onMode: (m: BalancingMode) => void;
}

export default function ImpactStep({ data, impact, mode, deposits, onMode }: ImpactStepProps) {
  const acct = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? id;
  const inst = (id: string) => data.instruments.find((i) => i.id === id)?.symbol ?? id;
  if (!impact.positions.length && !impact.cash.length)
    return <Empty>沒有可匯入的交易，無影響可預覽。</Empty>;
  return (
    <div>
      {impact.warnings.length > 0 && (
        <div className="notice warn">
          {impact.warnings.map((w, i) => (
            <div key={i}>
              <Badge tone={w.level === 'warn' ? 'warn' : 'info'}>
                {w.level === 'warn' ? '注意' : '提示'}
              </Badge>{' '}
              {w.message}
            </div>
          ))}
        </div>
      )}

      <div className="si-block">
        <h3>持倉變化</h3>
        <div className="table-wrap si-table">
          <table>
            <thead>
              <tr>
                <th>帳戶</th>
                <th>商品</th>
                <th className="num">數量（前 → 後）</th>
                <th className="num">均價（後）</th>
                <th className="num">新增已實現損益</th>
              </tr>
            </thead>
            <tbody>
              {impact.positions.map((c) => (
                <tr key={c.key}>
                  <td>{acct(c.accountId)}</td>
                  <td>{inst(c.instrumentId)}</td>
                  <td className="num">
                    {fmtNum(c.quantityBefore, 4)} → {fmtNum(c.quantityAfter, 4)}
                  </td>
                  <td className="num">{c.quantityAfter ? fmtNum(c.avgCostAfter, 4) : '—'}</td>
                  <td className={`num ${signClass(c.realizedPnlDelta)}`}>
                    {c.realizedPnlDelta
                      ? `${fmtMoney(c.realizedPnlDelta, c.currency)} ${c.currency}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="si-block">
        <h3>現金變化</h3>
        <div className="table-wrap si-table">
          <table>
            <thead>
              <tr>
                <th>帳戶</th>
                <th>幣別</th>
                <th className="num">匯入前</th>
                <th className="num">匯入後</th>
                <th className="num">期間最低</th>
              </tr>
            </thead>
            <tbody>
              {impact.cash.map((c) => (
                <tr key={`${c.accountId}|${c.currency}`}>
                  <td>{acct(c.accountId)}</td>
                  <td>{c.currency}</td>
                  <td className="num">{fmtMoney(c.before, c.currency)}</td>
                  <td className={`num ${signClass(c.after)}`}>{fmtMoney(c.after, c.currency)}</td>
                  <td className={`num ${c.minAfter < -1e-6 ? 'si-bad' : ''}`}>
                    {fmtMoney(c.minAfter, c.currency)}
                    {c.minDate ? ` （${c.minDate}）` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="si-note">
          已實現損益（未含手續費，依商品幣別）：
          {impact.realizedPnl.length
            ? impact.realizedPnl
                .map((r) => `${fmtMoney(r.amount, r.currency)} ${r.currency}`)
                .join('、')
            : '無'}
          ；累計投入資本變化 {fmtMoney(impact.totalsDelta.contributedCapital)}（基準幣別）。
        </p>
      </div>

      <div className="si-block">
        <h3>資金來源</h3>
        <label className="si-radio">
          <input
            type="radio"
            name="si-mode"
            checked={mode === 'none'}
            onChange={() => onMode('none')}
          />
          <span>不補資金（預設）。現金如果變成負數，請事後自行補登真實的入金紀錄。</span>
        </label>
        <label className="si-radio">
          <input
            type="radio"
            name="si-mode"
            checked={mode === 'opening'}
            onChange={() => onMode('opening')}
          />
          <span>
            補「開帳入金」：最早一筆成交的前一天，替每個受影響的帳戶／幣別補一筆剛好讓現金不為負的外部入金
            {deposits.length > 0
              ? `（${deposits.map((d) => `${acct(d.accountId)} ${fmtMoney(d.amount, d.currency)} ${d.currency}，${d.date}`).join('；')}）`
              : '（目前不需要）'}
            。
          </span>
        </label>
        <div className="notice warn">{BALANCING_EXPLANATION}</div>
      </div>
    </div>
  );
}
