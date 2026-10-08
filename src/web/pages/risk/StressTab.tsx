import { useMemo, useState } from 'react';
import { runStressTest, STRESS_PRESETS, type StressShocks } from '@core/index';
import { Badge, Card, Empty, Field, Stat } from '../../components/ui';
import { fmtMoney, fmtNum, fmtPct, fmtX, signClass } from '../../format';
import { useData } from '../../store';
import { usePortfolio } from '../../usePortfolio';
import { foreignCurrencies, NumInput, PctInput, ScenarioBar } from './shared';

const EMPTY: StressShocks = { indexMoves: {}, currencyMoves: {} };

/** Saved params may come from an older version or by hand: keep only what is valid. */
function readShocks(params: Record<string, unknown>): StressShocks {
  const rec = (v: unknown): Record<string, number> =>
    v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v).filter(([, n]) => typeof n === 'number' && Number.isFinite(n)),
        )
      : {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    indexMoves: rec(params.indexMoves),
    currencyMoves: rec(params.currencyMoves),
    defaultIndexMove: num(params.defaultIndexMove),
    rateShift: num(params.rateShift),
  };
}

export default function StressTab() {
  const data = useData();
  const portfolio = usePortfolio();
  const base = portfolio.valuation.baseCurrency;
  const [shocks, setShocks] = useState<StressShocks>(EMPTY);

  const result = useMemo(() => runStressTest(data, portfolio, shocks), [data, portfolio, shocks]);
  const held = new Set(portfolio.valuation.byIndex.map((i) => i.indexId));
  const indices = [
    ...data.indices.map((i) => ({ id: i.id, name: i.name })),
    ...[...held]
      .filter((id) => !data.indices.some((i) => i.id === id))
      .map((id) => ({ id, name: id })),
  ].sort((a, b) => Number(held.has(b.id)) - Number(held.has(a.id)));
  const currencies = foreignCurrencies(data, portfolio);
  const symbolOf = (id: string) => data.instruments.find((i) => i.id === id)?.symbol ?? id;
  const indexName = (id: string) => data.indices.find((i) => i.id === id)?.name ?? id;
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? id;

  const setIndex = (id: string, v: number | undefined) =>
    setShocks((s) => {
      const indexMoves = { ...s.indexMoves };
      if (v === undefined) delete indexMoves[id];
      else indexMoves[id] = v;
      return { ...s, indexMoves };
    });
  const setCurrency = (id: string, v: number | undefined) =>
    setShocks((s) => {
      const currencyMoves = { ...s.currencyMoves };
      if (v === undefined) delete currencyMoves[id];
      else currencyMoves[id] = v;
      return { ...s, currencyMoves };
    });

  const r = result;
  const hasBook = portfolio.valuation.positions.length > 0 || portfolio.valuation.cash.length > 0;

  return (
    <div className="risk-stack">
      <Card title="情境與預設">
        <div className="risk-presets">
          <span className="muted">示意預設：</span>
          {STRESS_PRESETS.map((p) => (
            <button key={p.id} title={p.description} onClick={() => setShocks(p.shocks)}>
              {p.name}
            </button>
          ))}
          <button className="ghost" onClick={() => setShocks(EMPTY)}>
            清除
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
          預設為示意用的整數情境，不是預測，也不是歷史重演。
        </p>
        <ScenarioBar
          data={data}
          kind="stress"
          current={() => ({ ...shocks })}
          onLoad={(params) => setShocks(readShocks(params))}
        />
      </Card>

      <Card title="衝擊設定（瞬間）">
        <div className="risk-subhead">各指數漲跌（留空 = 使用「其餘指數」）</div>
        <div className="risk-form-grid">
          {indices.map((i) => (
            <Field key={i.id} label={`${i.name}${held.has(i.id) ? '' : '（未持有）'}`}>
              <PctInput
                value={shocks.indexMoves[i.id]}
                onChange={(v) => setIndex(i.id, v)}
                placeholder={fmtPct(shocks.defaultIndexMove ?? 0, 0)}
              />
            </Field>
          ))}
          <Field label="其餘指數（統一漲跌）">
            <PctInput
              value={shocks.defaultIndexMove}
              onChange={(v) => setShocks((s) => ({ ...s, defaultIndexMove: v }))}
              placeholder="0"
            />
          </Field>
        </div>
        <div className="risk-subhead">匯率：各幣別對 {base} 的升貶（正 = 該幣升值）</div>
        <div className="risk-form-grid">
          {currencies.map((c) => (
            <Field key={c} label={`${c} / ${base}`}>
              <PctInput
                value={shocks.currencyMoves[c]}
                onChange={(v) => setCurrency(c, v)}
                placeholder="0"
              />
            </Field>
          ))}
          {!currencies.length && <span className="muted">沒有外幣部位或匯率。</span>}
        </div>
        <div className="risk-subhead">利率</div>
        <div className="risk-form-grid">
          <Field label="利率變動（百分點）" hint="例：2 = 所有借款年利率 +2pp，浮動利率假設">
            <NumInput
              value={shocks.rateShift}
              onChange={(v) => setShocks((s) => ({ ...s, rateShift: v }))}
              placeholder="0"
            />
          </Field>
        </div>
      </Card>

      {!hasBook ? (
        <Card>
          <Empty>尚無持倉或現金，沒有可模擬的內容。</Empty>
        </Card>
      ) : (
        <>
          <div className="stats">
            <Stat
              label={`情境後 NAV（${base}）`}
              value={fmtMoney(r.after.nav, base)}
              hint={`目前 ${fmtMoney(r.before.nav, base)}`}
            />
            <Stat
              label="損益"
              value={fmtMoney(r.pnl, base)}
              tone={r.pnl < 0 ? 'neg' : r.pnl > 0 ? 'pos' : undefined}
              hint={r.otherPnl ? `含現金／借款匯率 ${fmtMoney(r.otherPnl, base)}` : undefined}
            />
            <Stat
              label="剩餘淨值比例"
              value={fmtPct(r.remainingNavRatio, 1)}
              tone={
                r.remainingNavRatio !== undefined && r.remainingNavRatio < 0.7 ? 'warn' : undefined
              }
            />
            <Stat
              label="Gross 槓桿"
              value={`${fmtX(r.before.grossLeverage)} → ${fmtX(r.after.grossLeverage)}`}
              tone={
                (r.after.grossLeverage ?? 0) > (r.before.grossLeverage ?? 0) ? 'warn' : undefined
              }
            />
            <Stat
              label="Net 槓桿"
              value={`${fmtX(r.before.netLeverage)} → ${fmtX(r.after.netLeverage)}`}
            />
            <Stat
              label="負債 / NAV"
              value={`${fmtX(r.before.debtToNav)} → ${fmtX(r.after.debtToNav)}`}
            />
          </div>

          <Card title="衝擊前後">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th />
                    <th className="num">之前</th>
                    <th className="num">之後</th>
                    <th className="num">變化</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['NAV', 'nav'],
                      ['總資產', 'totalAssets'],
                      ['負債（含透支現金）', 'liabilities'],
                      ['Gross 曝險', 'grossExposure'],
                      ['Net 曝險', 'netExposure'],
                    ] as const
                  ).map(([label, key]) => (
                    <tr key={key}>
                      <td>{label}</td>
                      <td className="num">{fmtMoney(r.before[key], base)}</td>
                      <td className="num">{fmtMoney(r.after[key], base)}</td>
                      <td className={`num ${signClass(r.after[key] - r.before[key])}`}>
                        {fmtMoney(r.after[key] - r.before[key], base)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="各指數曝險">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>指數</th>
                    <th className="num">衝擊</th>
                    <th className="num">Net 之前</th>
                    <th className="num">Net 之後</th>
                    <th className="num">Gross 之前</th>
                    <th className="num">Gross 之後</th>
                    <th className="num">Net 權重（之後）</th>
                  </tr>
                </thead>
                <tbody>
                  {r.byIndex.map((i) => (
                    <tr key={i.indexId}>
                      <td>{indexName(i.indexId)}</td>
                      <td className={`num ${signClass(i.move)}`}>{fmtPct(i.move, 1)}</td>
                      <td className="num">{fmtMoney(i.netBefore, base)}</td>
                      <td className="num">{fmtMoney(i.netAfter, base)}</td>
                      <td className="num">{fmtMoney(i.grossBefore, base)}</td>
                      <td className="num">{fmtMoney(i.grossAfter, base)}</td>
                      <td className="num">{fmtPct(i.weightAfter, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="各部位">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>商品</th>
                    <th>帳戶</th>
                    <th className="num">數量</th>
                    <th className="num">價格變動</th>
                    <th className="num">價格之前</th>
                    <th className="num">價格之後</th>
                    <th className="num">價值之後</th>
                    <th className="num">損益（{base}）</th>
                  </tr>
                </thead>
                <tbody>
                  {r.positions.map((p) => (
                    <tr key={p.key}>
                      <td>
                        {p.symbol} {p.floored && <Badge tone="bad">跌幅下限 −100%</Badge>}{' '}
                        {p.derivative && <Badge>衍生品</Badge>}
                      </td>
                      <td>{accountName(p.accountId)}</td>
                      <td className="num">{fmtNum(p.quantity, 4)}</td>
                      <td className={`num ${signClass(p.priceMove)}`}>{fmtPct(p.priceMove, 1)}</td>
                      <td className="num">{fmtNum(p.priceBefore, 2)}</td>
                      <td className="num">{fmtNum(p.priceAfter, 2)}</td>
                      <td className="num">{p.derivative ? '—' : fmtMoney(p.valueAfter, base)}</td>
                      <td className={`num ${signClass(p.pnl)}`}>{fmtMoney(p.pnl, base)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="質押借款維持率">
            {!r.loans.length ? (
              <Empty>沒有使用中的質押借款。</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>借款</th>
                      <th className="num">餘額</th>
                      <th className="num">維持率之前</th>
                      <th className="num">維持率之後</th>
                      <th className="num">追繳門檻</th>
                      <th>狀態</th>
                      <th className="num">需還款</th>
                      <th className="num">或補擔保品</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.loans.map((l) => (
                      <tr key={l.loanId}>
                        <td>{l.name}</td>
                        <td className="num">
                          {fmtMoney(l.balance, l.currency)} {l.currency}
                        </td>
                        <td className="num">{fmtPct(l.ratioBefore, 1)}</td>
                        <td className={`num ${l.belowCallAfter ? 'neg' : ''}`}>
                          {fmtPct(l.ratioAfter, 1)}
                        </td>
                        <td className="num">{fmtPct(l.callRatio, 0)}</td>
                        <td>
                          {l.belowCallAfter ? (
                            <Badge tone="bad">低於門檻</Badge>
                          ) : (
                            <Badge tone="ok">未觸發</Badge>
                          )}
                        </td>
                        <td className="num">
                          {l.cureRepayment !== undefined
                            ? `${fmtMoney(l.cureRepayment, l.currency)} ${l.currency}`
                            : '—'}
                        </td>
                        <td className="num">
                          {l.cureCollateral !== undefined
                            ? `${fmtMoney(l.cureCollateral, l.currency)} ${l.currency}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="期貨／永續合約保證金">
            {!r.margins.length ? (
              <Empty>沒有期貨或永續合約部位。</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>帳戶</th>
                      <th className="num">現金</th>
                      <th className="num">權益之前</th>
                      <th className="num">權益之後</th>
                      <th className="num">維持保證金需求</th>
                      <th className="num">缺口</th>
                      <th className="num">清算估計（標的變動）</th>
                      <th>備註</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.margins.map((m) => (
                      <tr key={`${m.accountId}|${m.currency}`}>
                        <td>{accountName(m.accountId)}</td>
                        <td className="num">
                          {fmtMoney(m.cash, m.currency)} {m.currency}
                        </td>
                        <td className="num">{fmtMoney(m.equityBefore, m.currency)}</td>
                        <td className={`num ${m.equityAfter < m.required ? 'neg' : ''}`}>
                          {fmtMoney(m.equityAfter, m.currency)}
                        </td>
                        <td className="num">{fmtMoney(m.required, m.currency)}</td>
                        <td className={`num ${m.shortfall > 0 ? 'neg' : ''}`}>
                          {m.shortfall > 0 ? fmtMoney(m.shortfall, m.currency) : '—'}
                        </td>
                        <td className="num">
                          {m.liquidationMove !== undefined ? fmtPct(m.liquidationMove, 1) : '—'}
                        </td>
                        <td>
                          {m.missingSpecs.length > 0 && (
                            <Badge tone="warn">
                              缺保證金規格：{m.missingSpecs.map(symbolOf).join('、')}
                            </Badge>
                          )}{' '}
                          {m.hasPerpetual && <Badge>含永續合約</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              權益 = 帳戶現金 +
              衍生品未實現損益（變動保證金逐日結算入現金，現金可能為負）。清算估計把同帳戶所有合約的標的同幅變動，從現價到權益等於維持保證金為止。
            </p>
          </Card>

          <Card title="利息">
            <div className="stats" style={{ marginBottom: 0 }}>
              <Stat label={`每月利息 現況（${base}）`} value={fmtMoney(r.interest.before, base)} />
              <Stat
                label={`每月利息 衝擊後（${base}）`}
                value={fmtMoney(r.interest.after, base)}
                hint="浮動利率假設"
              />
              <Stat
                label="變化"
                value={fmtMoney(r.interest.delta, base)}
                tone={r.interest.delta > 0 ? 'neg' : undefined}
              />
            </div>
          </Card>

          <Card title="警示">
            {r.warnings.length ? (
              <ul className="risk-list">
                {r.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : (
              <span className="muted">此情境沒有觸發警示。</span>
            )}
          </Card>
        </>
      )}

      <div className="notice warn">
        <strong>限制說明</strong>
        <ul className="risk-list caveats">
          {r.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
