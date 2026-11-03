import { Link } from 'react-router-dom';
import { heldStrategy, optionBook, type HeldStrategy } from '@core/index';
import { Badge, Card, Stat } from '../../components/ui';
import { Accordion, Banner, EmptyState, Tooltip } from '../../components/Primitives';
import { fmtMoney, fmtNum, fmtPct } from '../../format';
import { usePortfolio } from '../../usePortfolio';
import { useData } from '../../store';

export function HoldingsTab(props: { onLoad: (s: HeldStrategy, label: string) => void }) {
  const data = useData();
  const { valuation } = usePortfolio();
  const base = valuation.baseCurrency;
  const book = optionBook(valuation);
  const names = new Map(data.instruments.map((i) => [i.id, i]));

  if (!book.rows.length) {
    return (
      <Card>
        <EmptyState
          title="還沒有持有選擇權"
          action={
            <>
              <Link className="button primary" to="/settings">
                新增選擇權商品 ↗
              </Link>
              <Link className="button" to="/accounts">
                記錄交易 ↗
              </Link>
            </>
          }
        >
          在「設定與資料 →
          商品登錄」新增類型為選擇權的商品，填入買賣權、履約價、到期日與標的，再到帳戶記錄買進或賣出。這裡會列出每個部位的
          Greeks 與 Delta 曝險。
        </EmptyState>
      </Card>
    );
  }

  const underlyings = [
    ...new Set(book.rows.map((r) => r.position.instrument.underlyingId).filter(Boolean)),
  ] as string[];
  const nav = valuation.nav;

  return (
    <>
      {book.incomplete > 0 && (
        <Banner tone="warn" title={`${book.incomplete} 個部位無法計算 Greeks`}>
          曝險暫以 0
          計，不會猜測。請在商品設定補齊買賣權、履約價、到期日與標的，並確認標的有報價；選擇權本身沒有報價時，需填寫波動率。
        </Banner>
      )}
      <div className="stats">
        <Stat
          label="選擇權 Delta 曝險"
          value={fmtMoney(book.totals.exposure, base)}
          hint={nav > 0 ? `占 NAV ${fmtPct(book.totals.exposure / nav)}` : undefined}
        />
        <Stat
          label="Gamma（合計）"
          value={fmtNum(book.totals.gamma, 2)}
          hint="標的漲 1 時 Delta 的變化"
        />
        <Stat
          label="Theta／日"
          value={fmtMoney(book.totals.theta, base)}
          tone={book.totals.theta < 0 ? 'neg' : 'pos'}
          hint="每過一日的時間價值變化"
        />
        <Stat
          label="Vega／1%"
          value={fmtMoney(book.totals.vega, base)}
          hint="波動率上升 1 個百分點"
        />
      </div>

      <Card title={`選擇權部位（${book.rows.length}）`}>
        <div
          className="table-wrap"
          role="region"
          aria-label="選擇權部位（可左右捲動）"
          tabIndex={0}
        >
          <table className="opt-holdings">
            <thead>
              <tr>
                <th>商品</th>
                <th>權別</th>
                <th className="num">履約價</th>
                <th className="num">剩餘天數</th>
                <th className="num">數量</th>
                <th className="num">標的價</th>
                <th className="num">波動率</th>
                <th className="num">Delta</th>
                <th className="num">Gamma</th>
                <th className="num">Theta／日</th>
                <th className="num">Vega</th>
                <th className="num">Delta 曝險（{base}）</th>
                <th className="num">曝險 / NAV</th>
              </tr>
            </thead>
            <tbody>
              {book.rows.map((r) => {
                const p = r.position;
                const i = p.instrument;
                const o = p.option;
                const days = r.daysToExpiry;
                return (
                  <tr key={p.key}>
                    <td>
                      <strong>{i.symbol}</strong>
                      <span className="muted opt-sub">
                        {i.underlyingId
                          ? (names.get(i.underlyingId)?.symbol ?? i.underlyingId)
                          : '未指定標的'}
                      </span>
                    </td>
                    <td>
                      {i.optionRight ? (
                        <span className={`opt-kind opt-kind-${i.optionRight}`}>
                          {i.optionRight === 'call' ? 'Call' : 'Put'}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{fmtNum(i.strike, 4)}</td>
                    <td className="num">
                      {o?.ok ? (
                        o.expired ? (
                          <Badge tone="bad">已到期</Badge>
                        ) : (days ?? 0) <= 7 ? (
                          <Badge tone="warn">{days} 天</Badge>
                        ) : (
                          days
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={`num ${p.quantity < 0 ? 'neg' : ''}`}>
                      {fmtNum(p.quantity, 4)}
                    </td>
                    <td className="num">{o?.ok ? fmtNum(o.underlyingPrice, 4) : '—'}</td>
                    <td className="num">
                      {o?.ok ? (
                        o.expired ? (
                          '—'
                        ) : (
                          <span className="opt-vol">
                            {fmtPct(o.vol)}
                            <Badge tone={o.volSource === 'implied' ? 'ok' : 'info'}>
                              {o.volSource === 'implied' ? '反推' : '設定'}
                            </Badge>
                          </span>
                        )
                      ) : (
                        <Badge tone="bad">{o?.reason ?? '無資料'}</Badge>
                      )}
                    </td>
                    <td className="num">{r.greeks ? fmtNum(r.greeks.delta, 2) : '—'}</td>
                    <td className="num">{r.greeks ? fmtNum(r.greeks.gamma, 4) : '—'}</td>
                    <td className={`num ${r.greeks && r.greeks.theta < 0 ? 'neg' : ''}`}>
                      {r.greeks ? fmtNum(r.greeks.theta, 2) : '—'}
                    </td>
                    <td className="num">{r.greeks ? fmtNum(r.greeks.vega, 2) : '—'}</td>
                    <td className="num">{fmtMoney(r.exposure, base)}</td>
                    <td className="num">{fmtPct(r.weight)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted opt-footnote">
          Greeks 以部位計（每單位 Greeks × 數量 × 合約乘數，商品幣別）；合計換算為 {base}。
        </p>
      </Card>

      {underlyings.length > 0 && (
        <Card title="帶入策略試算">
          <p className="muted">
            以平均成本為進場價，把同一標的的選擇權（與標的持股）帶進試算，檢視整體的到期損益與兩平點。
          </p>
          <div className="opt-load">
            {underlyings.map((id) => {
              const s = heldStrategy(valuation, id);
              const u = names.get(id);
              return (
                <button
                  key={id}
                  type="button"
                  className="opt-load-card"
                  disabled={!s}
                  onClick={() => s && props.onLoad(s, u ? `${u.symbol} ${u.name}` : id)}
                >
                  <strong>{u?.symbol ?? id}</strong>
                  <span className="muted">
                    {s ? `${s.legs.length} 隻腿 · 現價 ${fmtNum(s.spot, 4)}` : '缺少模型資料'}
                  </span>
                  <span aria-hidden="true" className="opt-load-arrow">
                    →
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <Accordion title="選擇權的曝險怎麼算？">
        <p>
          權利金照一般證券入帳：買進是資產、賣出是負債，因此 NAV 不會重複計算。曝險則是標的的
          <Tooltip label="Delta 曝險">
            Delta × 數量 × 標的價格 × 合約乘數（標的為槓桿 ETF 時再乘其槓桿），歸入標的的指數。
          </Tooltip>
          ，會隨價格與時間變動。
        </p>
        <p>
          波動率優先由選擇權報價反推；沒有報價時採商品設定。兩者都沒有，或標的沒有價格時，該部位曝險以
          0 計並提出警示。
        </p>
      </Accordion>
    </>
  );
}
