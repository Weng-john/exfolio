import { useMemo, useState } from 'react';
import { TEMPLATES, type TemplateId } from '@core/index';
import { Badge, Card, Field } from '../../components/ui';
import {
  Banner,
  EmptyState,
  Popover,
  ProgressBar,
  Toast,
  Toggle,
  Tooltip,
} from '../../components/Primitives';
import { fmtNum, fmtPct } from '../../format';
import { LegDialog } from './LegDialog';
import {
  analyse,
  fromTemplate,
  modelPremium,
  parseMarket,
  type Builder,
  type UiLeg,
} from './model';
import { PayoffChart } from './PayoffChart';
import { TemplateCarousel } from './TemplateCarousel';

const GREEKS: Array<{
  key: 'delta' | 'gamma' | 'theta' | 'vega' | 'rho';
  label: string;
  help: string;
  digits: number;
}> = [
  {
    key: 'delta',
    label: 'Delta',
    help: '標的每漲 1，組合損益的變化。也等於約當持有多少單位的標的。',
    digits: 2,
  },
  {
    key: 'gamma',
    label: 'Gamma',
    help: '標的每漲 1，Delta 的變化。為正時，行情越走越有利；為負時，越走越不利。',
    digits: 4,
  },
  {
    key: 'theta',
    label: 'Theta',
    help: '其他條件不變，每過一個日曆日，組合價值的變化。買方通常為負（時間價值流失）。',
    digits: 2,
  },
  { key: 'vega', label: 'Vega', help: '波動率每上升 1 個百分點，組合價值的變化。', digits: 2 },
  { key: 'rho', label: 'Rho', help: '利率每上升 1 個百分點，組合價值的變化。', digits: 2 },
];

const KIND: Record<UiLeg['kind'], string> = { call: 'Call', put: 'Put', underlying: '標的' };

function money(v: number | undefined, unbounded: string) {
  return v === undefined ? unbounded : fmtNum(v, 0);
}

export function StrategyBuilder(props: { builder: Builder; onChange: (b: Builder) => void }) {
  const b = props.builder;
  const set = (patch: Partial<Builder>) => props.onChange({ ...b, ...patch });
  const setMarket = (patch: Partial<Builder['market']>) =>
    set({ market: { ...b.market, ...patch } });
  const [dialog, setDialog] = useState<{ leg?: UiLeg } | undefined>();
  const [toast, setToast] = useState<string | undefined>();
  const [showToday, setShowToday] = useState(true);

  const parsed = parseMarket(b.market);
  const m = parsed.ok ? parsed.value : undefined;
  const result = useMemo(() => {
    const p = parseMarket(b.market);
    return p.ok && b.legs.length ? analyse(b, p.value) : undefined;
  }, [b]);

  const pick = (id: TemplateId) => {
    if (!m) return;
    const legs = fromTemplate(id, m);
    const t = TEMPLATES.find((x) => x.id === id)!;
    set({ legs, template: id, elapsed: 0 });
    setToast(`已套用「${t.name}」：${legs.length} 隻腿，權利金依模型計算。`);
  };
  const upsert = (leg: UiLeg) => {
    const exists = b.legs.some((l) => l.id === leg.id);
    set({
      legs: exists ? b.legs.map((l) => (l.id === leg.id ? leg : l)) : [...b.legs, leg],
      template: undefined,
    });
    setToast(exists ? '已更新部位腿。' : '已加入部位腿。');
    setDialog(undefined);
  };
  const remove = (id: string) =>
    set({ legs: b.legs.filter((l) => l.id !== id), template: undefined });
  const flip = (leg: UiLeg) => upsert({ ...leg, quantity: -leg.quantity });
  const reprice = () => {
    if (!m) return;
    set({
      legs: b.legs.map((l) =>
        l.kind === 'underlying'
          ? { ...l, price: m.spot }
          : { ...l, price: modelPremium(l.kind, l.strike, m, l.days ?? m.days, l.vol ?? m.vol) },
      ),
      elapsed: 0,
    });
    setToast('已依目前市場條件重新計價每一隻腿。');
  };

  const horizon = result?.horizon ?? 0;
  const elapsed = Math.min(b.elapsed, horizon);
  const todayLabel = elapsed > 0 ? `${elapsed} 天後損益（模型）` : '今日損益（模型）';
  const net = result?.premium ?? 0;

  return (
    <>
      <div className="section-kicker">
        <span>01</span> 選擇策略範本
      </div>
      <TemplateCarousel selected={b.template} onPick={pick} />

      <div className="section-kicker">
        <span>02</span> 設定標的與市場
      </div>
      <Card title="標的與市場" className="opt-market">
        <div className="form-grid">
          <Field label="標的名稱" hint="僅供辨識">
            <input value={b.market.label} onChange={(e) => setMarket({ label: e.target.value })} />
          </Field>
          <Field label="標的價格">
            <input
              type="number"
              min="0"
              step="any"
              value={b.market.spot}
              onChange={(e) => setMarket({ spot: e.target.value })}
            />
          </Field>
          <Field label="波動率（%）" hint="年化隱含波動率">
            <input
              type="number"
              min="0"
              step="any"
              value={b.market.vol}
              onChange={(e) => setMarket({ vol: e.target.value })}
            />
          </Field>
          <Field label="到期天數" hint="日曆日">
            <input
              type="number"
              min="1"
              step="1"
              value={b.market.days}
              onChange={(e) => setMarket({ days: e.target.value })}
            />
          </Field>
          <Field label="無風險利率（%）">
            <input
              type="number"
              step="any"
              value={b.market.rate}
              onChange={(e) => setMarket({ rate: e.target.value })}
            />
          </Field>
          <Field label="合約乘數" hint="例：美股選擇權 100、臺指選擇權 50">
            <input
              type="number"
              min="0"
              step="any"
              value={b.market.multiplier}
              onChange={(e) => setMarket({ multiplier: e.target.value })}
            />
          </Field>
        </div>
        {!parsed.ok && (
          <div className="notice warn" role="alert">
            {parsed.errors.join('；')}
          </div>
        )}
      </Card>

      <div className="section-kicker">
        <span>03</span> 組合部位腿
      </div>
      <Card
        title={`部位腿${b.legs.length ? `（${b.legs.length}）` : ''}`}
        actions={
          <>
            {b.legs.length > 0 && (
              <button type="button" className="ghost" disabled={!m} onClick={reprice}>
                依模型重新計價
              </button>
            )}
            <button type="button" className="primary" disabled={!m} onClick={() => setDialog({})}>
              ＋ 新增部位腿
            </button>
          </>
        }
      >
        {b.legs.length === 0 ? (
          <EmptyState
            title="從一隻腿開始"
            action={
              <button type="button" className="primary" disabled={!m} onClick={() => setDialog({})}>
                新增部位腿
              </button>
            }
          >
            選上方任一範本，或自行加入買權、賣權與標的部位，組出你的策略。
          </EmptyState>
        ) : (
          <div className="table-wrap" role="region" aria-label="部位腿（可左右捲動）" tabIndex={0}>
            <table className="opt-legs">
              <thead>
                <tr>
                  <th>方向</th>
                  <th>種類</th>
                  <th className="num">數量</th>
                  <th className="num">履約價</th>
                  <th className="num">權利金／進場價</th>
                  <th className="num">到期天數</th>
                  <th className="num">波動率</th>
                  <th className="num">現金流</th>
                  <th>
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {b.legs.map((l) => {
                  const buy = l.quantity > 0;
                  const option = l.kind !== 'underlying';
                  const flow = option && m ? -l.quantity * l.price * m.multiplier : undefined;
                  return (
                    <tr key={l.id}>
                      <td data-label="方向">
                        <Badge tone={buy ? 'ok' : 'bad'}>{buy ? '買進' : '賣出'}</Badge>
                      </td>
                      <td data-label="種類">
                        <span className={`opt-kind opt-kind-${l.kind}`}>{KIND[l.kind]}</span>
                      </td>
                      <td data-label="數量" className="num">
                        {fmtNum(Math.abs(l.quantity), 4)}
                      </td>
                      <td data-label="履約價" className="num">
                        {option ? fmtNum(l.strike, 4) : '—'}
                      </td>
                      <td data-label="權利金／進場價" className="num">
                        {fmtNum(l.price, 4)}
                      </td>
                      <td data-label="到期天數" className="num">
                        {option ? (l.days ?? <span className="muted">{m?.days ?? '—'}</span>) : '—'}
                      </td>
                      <td data-label="波動率" className="num">
                        {option ? (
                          l.vol !== undefined ? (
                            fmtPct(l.vol)
                          ) : (
                            <span className="muted">{m ? fmtPct(m.vol) : '—'}</span>
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                      <td
                        data-label="現金流"
                        className={`num ${flow === undefined ? '' : flow >= 0 ? 'pos' : 'neg'}`}
                      >
                        {flow === undefined ? '—' : fmtNum(flow, 0)}
                      </td>
                      <td className="opt-row-menu">
                        <Popover
                          label={`${buy ? '買進' : '賣出'} ${KIND[l.kind]} ${option ? fmtNum(l.strike, 4) : ''} 的操作`}
                          trigger={<span aria-hidden="true">⋯</span>}
                        >
                          <button
                            type="button"
                            className="menu-item"
                            onClick={() => setDialog({ leg: l })}
                          >
                            編輯
                          </button>
                          <button type="button" className="menu-item" onClick={() => flip(l)}>
                            {buy ? '改為賣出' : '改為買進'}
                          </button>
                          <button
                            type="button"
                            className="menu-item"
                            onClick={() => upsert({ ...l, id: `${l.id}c${Date.now()}` })}
                          >
                            複製
                          </button>
                          <div className="menu-divider" />
                          <button
                            type="button"
                            className="menu-item danger"
                            onClick={() => remove(l.id)}
                          >
                            刪除
                          </button>
                        </Popover>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {result && m && (
        <>
          <div className="section-kicker">
            <span>04</span> 檢視損益與風險
          </div>
          <div className="opt-summary">
            <div className={`opt-hero ${net > 0 ? 'debit' : 'credit'}`}>
              <span className="opt-hero-label">
                {net > 0 ? '淨支付權利金' : net < 0 ? '淨收取權利金' : '權利金收支'}
              </span>
              <strong className="opt-hero-value">{fmtNum(Math.abs(net), 0)}</strong>
              <span className="opt-hero-hint">
                {b.market.label || '標的'} · 現價 {fmtNum(m.spot, 4)} · 乘數{' '}
                {fmtNum(m.multiplier, 4)}
              </span>
            </div>
            <div className="stats opt-stats">
              <div className="stat">
                <div className="stat-label">最大獲利（到期）</div>
                <div className="stat-value pos">
                  {result.profile ? money(result.profile.maxProfit, '無上限') : '—'}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">最大損失（到期）</div>
                <div className="stat-value neg">
                  {result.profile ? money(result.profile.maxLoss, '無上限') : '—'}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">損益兩平</div>
                <div className="stat-value">
                  {result.profile ? (
                    result.profile.breakevens.length ? (
                      <span className="opt-chips">
                        {result.profile.breakevens.map((x) => (
                          <span key={x} className="opt-chip">
                            {fmtNum(x, 2)}
                          </span>
                        ))}
                      </span>
                    ) : (
                      '無'
                    )
                  ) : (
                    '—'
                  )}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">
                  <Tooltip label="獲利機率">
                    依對數常態模型與輸入的波動率估算到期時落在獲利區間的機率（風險中立）。真實行情的尾端風險較大，這不是預測。
                  </Tooltip>
                </div>
                <div className="stat-value">
                  {result.probability === undefined ? '—' : fmtPct(result.probability)}
                </div>
              </div>
            </div>
          </div>
          {!result.profile && (
            <Banner tone="warn" title="不同到期日">
              各腿到期日不同，到期損益不是折線，最大損益與兩平點不在此計算；圖中「到期損益」為最早到期時的模型值。
            </Banner>
          )}

          <Card
            title="損益圖"
            className="opt-chart-card"
            actions={<Toggle label="顯示模型曲線" checked={showToday} onChange={setShowToday} />}
          >
            <div className="opt-legend" aria-hidden="true">
              <span className="opt-legend-expiry">到期損益</span>
              {showToday && <span className="opt-legend-today">{todayLabel}</span>}
              <span className="opt-legend-spot">現價</span>
              <span className="opt-legend-be">損益兩平</span>
            </div>
            <PayoffChart
              curve={result.curve}
              spot={m.spot}
              breakevens={result.profile?.breakevens ?? []}
              showToday={showToday}
              todayLabel={todayLabel}
            />
            {horizon > 0 && (
              <div className="opt-time">
                <label className="field">
                  <span className="field-label">
                    評估日：{elapsed === 0 ? '今天' : `${elapsed} 天後`}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={horizon}
                    step={1}
                    value={elapsed}
                    aria-valuetext={elapsed === 0 ? '今天' : `${elapsed} 天後`}
                    onChange={(e) => set({ elapsed: Number(e.target.value) })}
                  />
                </label>
                <ProgressBar
                  label={`距最早到期 ${horizon - elapsed} 天`}
                  value={horizon ? elapsed / horizon : 0}
                />
              </div>
            )}
          </Card>

          <Card title={`組合 Greeks${elapsed > 0 ? `（${elapsed} 天後）` : ''}`}>
            <div className="opt-greeks">
              {GREEKS.map((g) => {
                const v = result.greeks[g.key];
                return (
                  <div className="opt-greek" key={g.key}>
                    <Tooltip label={g.label}>{g.help}</Tooltip>
                    <strong className={v > 0 ? 'pos' : v < 0 ? 'neg' : ''}>
                      {fmtNum(v, g.digits)}
                    </strong>
                  </div>
                );
              })}
              <div className="opt-greek">
                <Tooltip label="Delta 曝險">
                  Delta × 標的價格：組合目前約當的標的部位金額，正為多頭、負為空頭。
                </Tooltip>
                <strong>{fmtNum(result.greeks.delta * m.spot, 0)}</strong>
              </div>
            </div>
          </Card>
        </>
      )}

      {dialog && m && (
        <LegDialog
          market={m}
          initial={dialog.leg}
          onSave={upsert}
          onClose={() => setDialog(undefined)}
        />
      )}
      {toast && (
        <div className="opt-toast-region">
          <Toast tone="ok" message={toast} onDismiss={() => setToast(undefined)} />
        </div>
      )}
    </>
  );
}
