import type { AllocationPlan } from '@core/index';
import { fmtMoney, fmtNum, fmtPct, fmtX, signClass } from '../../format';
import { Badge, Card, Empty, Stat } from '../../components/ui';
import './allocation.css';

/** Suggested trades, totals, post-trade state and warnings of one plan. */
export function PlanView(props: { plan: AllocationPlan; names: Record<string, string> }) {
  const { plan, names } = props;
  const base = plan.baseCurrency;
  const m = (v: number) => fmtMoney(v, base);
  return (
    <>
      <div className="stats">
        <Stat label="交易後 NAV（資金到位後）" value={m(plan.postFundingNav)} hint={`交易費用後 ${m(plan.postTrade.nav)}`} />
        <Stat label="可用資金" value={m(plan.availableCash)} hint={plan.sellProceeds ? `含賣出所得 ${m(plan.sellProceeds)}` : undefined} />
        <Stat label="資金占用（成本／保證金）" value={m(plan.cashUsed)} hint={`預估費用 ${m(plan.totalFees)}`} />
        <Stat label="剩餘現金" value={m(plan.leftoverCash)} tone={plan.leftoverCash < 0 ? 'neg' : undefined} />
        <Stat label="交易後 Gross／Net 曝險" value={`${m(plan.postTrade.grossExposure)} ／ ${m(plan.postTrade.netExposure)}`} />
        <Stat label="交易後槓桿 Gross／Net" value={`${fmtX(plan.postTrade.grossLeverage)} ／ ${fmtX(plan.postTrade.netLeverage)}`} hint="僅供參考，無強制上限" />
        <Stat label="未補足缺口" value={m(plan.unfunded)} tone={plan.unfunded > 0 ? 'warn' : undefined} />
      </div>

      {plan.warnings.length > 0 && (
        <div className="notice warn">
          <strong>提醒</strong>
          <ul className="notes-list">
            {plan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <Card title="交易建議清單（僅供參考，網站不會下單）">
        {plan.suggestions.length === 0 ? (
          <Empty>沒有需要執行的交易</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>指數</th>
                  <th>商品</th>
                  <th>方向</th>
                  <th className="num">數量</th>
                  <th className="num">預估價格</th>
                  <th className="num">資金需求（商品幣別）</th>
                  <th className="num">資金需求（{base}）</th>
                  <th className="num">新增曝險</th>
                  <th className="num">交易後權重 / 目標</th>
                </tr>
              </thead>
              <tbody>
                {plan.suggestions.map((s, i) => (
                  <tr key={`${s.instrumentId}-${s.side}-${i}`}>
                    <td>{names[s.indexId] ?? s.indexId}</td>
                    <td>{s.symbol}</td>
                    <td>
                      <Badge tone={s.side === 'buy' ? 'ok' : 'warn'}>{s.side === 'buy' ? '買進' : '賣出'}</Badge>
                    </td>
                    <td className="num">{fmtNum(s.quantity, 8)}</td>
                    <td className="num">
                      {fmtMoney(s.price, s.currency)} {s.currency}
                    </td>
                    <td className="num">
                      {s.side === 'buy' ? `${fmtMoney(s.cashRequired, s.currency)} ${s.currency}${s.isMargin ? '（保證金）' : ''}` : '—'}
                    </td>
                    <td className="num">{s.side === 'buy' ? m(s.cashRequiredBase) : '—'}</td>
                    <td className={`num ${signClass(s.exposureAdded)}`}>{m(s.exposureAdded)}</td>
                    <td className="num">
                      {fmtPct(s.postTradeWeight)} / {fmtPct(s.targetWeight)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {plan.residualGaps.length > 0 && (
        <Card title="交易後剩餘缺口">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>指數</th>
                  <th className="num">目標</th>
                  <th className="num">交易後權重</th>
                  <th className="num">缺口（{base}）</th>
                  <th className="num">缺口（百分點）</th>
                </tr>
              </thead>
              <tbody>
                {plan.residualGaps.map((g) => (
                  <tr key={g.indexId}>
                    <td>{g.name}</td>
                    <td className="num">{fmtPct(g.targetWeight)}</td>
                    <td className="num">{fmtPct(g.postTradeWeight)}</td>
                    <td className={`num ${signClass(g.gap)}`}>{m(g.gap)}</td>
                    <td className={`num ${signClass(g.gapWeight)}`}>{fmtPct(g.gapWeight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
