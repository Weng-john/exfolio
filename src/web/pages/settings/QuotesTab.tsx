import { useState } from 'react';
import type { FxRate, PriceQuote, QuoteSource } from '@core/index';
import { getSettings } from '@core/index';
import { removeRow, upsertRow, useData } from '../../store';
import { refreshQuotes, useQuoteSync, REFRESH_MS } from '../../quotes';
import { fmtNum, fmtTime } from '../../format';
import { Badge, Card, Empty, Field, Modal } from '../../components/ui';
import { ErrorList } from './shared';

function statusOf(q: PriceQuote | undefined, staleMin: number, now: number) {
  if (!q) return <Badge tone="bad">無報價</Badge>;
  const age = (now - new Date(q.asOf).getTime()) / 60_000;
  if (q.status === 'stale' || age > staleMin)
    return <Badge tone="warn">過期（{Math.round(age)} 分鐘前）</Badge>;
  if (q.status === 'manual') return <Badge tone="info">手動</Badge>;
  return (
    <Badge tone={q.status === 'realtime' ? 'ok' : 'info'}>
      {q.status === 'realtime' ? '即時' : '延遲'}
    </Badge>
  );
}

function PriceRow(props: {
  instId: string;
  label: string;
  currency: string;
  quote?: PriceQuote;
  staleMin: number;
  now: number;
}) {
  const [val, setVal] = useState('');
  const submit = () => {
    const price = Number(val);
    if (val.trim() === '' || !Number.isFinite(price) || price <= 0) return;
    upsertRow('prices', {
      id: props.instId,
      price,
      currency: props.currency,
      asOf: new Date().toISOString(),
      source: 'manual',
      status: 'manual',
    });
    setVal('');
  };
  const q = props.quote;
  return (
    <tr>
      <td>{props.label}</td>
      <td className="num">{q ? fmtNum(q.price, 6) : '—'}</td>
      <td>{q?.currency ?? props.currency}</td>
      <td>{fmtTime(q?.asOf)}</td>
      <td>{q?.source ?? '—'}</td>
      <td>{statusOf(q, props.staleMin, props.now)}</td>
      <td>
        <div className="settings-row-actions">
          <input
            className="settings-inline-input"
            type="number"
            step="any"
            placeholder="手動價格"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            aria-label={`${props.label} 手動價格`}
          />
          <button onClick={submit} disabled={!val.trim()}>
            寫入
          </button>
        </div>
      </td>
    </tr>
  );
}

interface FxDraft {
  from: string;
  to: string;
  rate: string;
  isNew: boolean;
}

export default function QuotesTab() {
  const data = useData();
  const sync = useQuoteSync();
  const settings = getSettings(data);
  const now = Date.now();
  const [fx, setFx] = useState<FxDraft>();
  const [errors, setErrors] = useState<string[]>([]);
  const prices = new Map(data.prices.map((p) => [p.id, p]));

  const saveFx = () => {
    if (!fx) return;
    const from = fx.from.trim().toUpperCase();
    const to = fx.to.trim().toUpperCase();
    const rate = Number(fx.rate);
    const errs: string[] = [];
    if (!from || !to) errs.push('幣別為必填');
    if (from && from === to) errs.push('兩個幣別不可相同');
    if (!Number.isFinite(rate) || rate <= 0 || fx.rate.trim() === '') errs.push('匯率必須大於 0');
    if (fx.isNew && data.fxRates.some((r) => r.id === `${from}/${to}`))
      errs.push(`${from}/${to} 已存在，請直接編輯`);
    if (errs.length) return setErrors(errs);
    const row: FxRate = {
      id: `${from}/${to}`,
      from,
      to,
      rate,
      asOf: new Date().toISOString(),
      source: 'manual' as QuoteSource,
    };
    upsertRow('fxRates', row);
    setFx(undefined);
  };

  return (
    <>
      <div className="notice warn">
        每 {REFRESH_MS / 1000} 秒自動更新不代表即時資料。免費來源（Yahoo Finance、Binance
        公開端點）屬非官方介面， 報價可能延遲、缺漏或隨時失效；下單與保證金判斷請以券商 /
        交易所畫面為準。
      </div>

      <Card
        title="同步狀態"
        actions={
          <button
            className="primary"
            onClick={() => void refreshQuotes()}
            disabled={sync.refreshing}
          >
            {sync.refreshing ? '更新中…' : '立即更新報價'}
          </button>
        }
      >
        <p>
          最近嘗試：{fmtTime(sync.lastAttemptAt)}　最近成功：{fmtTime(sync.lastSuccessAt)}
        </p>
        {sync.errors.length ? (
          <ul className="settings-form-errors">
            {sync.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">沒有錯誤。</p>
        )}
      </Card>

      <Card title={`商品報價（過期門檻 ${settings.alerts.staleQuoteMinutes} 分鐘）`}>
        {data.instruments.length === 0 ? (
          <Empty>尚無商品</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>商品</th>
                  <th className="num">價格</th>
                  <th>幣別</th>
                  <th>時間</th>
                  <th>來源</th>
                  <th>狀態</th>
                  <th>手動輸入</th>
                </tr>
              </thead>
              <tbody>
                {data.instruments.map((i) => (
                  <PriceRow
                    key={i.id}
                    instId={i.id}
                    label={`${i.symbol} ${i.name}${i.active ? '' : '（停用）'}`}
                    currency={i.currency}
                    quote={prices.get(i.id)}
                    staleMin={settings.alerts.staleQuoteMinutes}
                    now={now}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="匯率"
        actions={
          <button
            onClick={() => {
              setFx({ from: '', to: settings.baseCurrency, rate: '', isNew: true });
              setErrors([]);
            }}
          >
            新增匯率
          </button>
        }
      >
        {data.fxRates.length === 0 ? (
          <Empty>尚無匯率；請新增或按「立即更新報價」</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>幣別對</th>
                  <th className="num">匯率</th>
                  <th>時間</th>
                  <th>來源</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.fxRates.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.from} → {r.to}
                    </td>
                    <td className="num">{fmtNum(r.rate, 6)}</td>
                    <td>{fmtTime(r.asOf)}</td>
                    <td>{r.source}</td>
                    <td>
                      <div className="settings-row-actions">
                        <button
                          onClick={() => {
                            setFx({ from: r.from, to: r.to, rate: String(r.rate), isNew: false });
                            setErrors([]);
                          }}
                        >
                          編輯
                        </button>
                        <button
                          className="danger"
                          onClick={() =>
                            window.confirm(`刪除 ${r.id}？`) && removeRow('fxRates', r.id)
                          }
                        >
                          刪除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          手動編輯會把來源標為 manual；之後自動更新可能再次覆寫追蹤中的幣別對。
        </p>
      </Card>

      {fx && (
        <Modal
          title={fx.isNew ? '新增匯率' : `編輯匯率 ${fx.from}/${fx.to}`}
          onClose={() => setFx(undefined)}
          footer={
            <>
              <button onClick={() => setFx(undefined)}>取消</button>
              <button className="primary" onClick={saveFx}>
                儲存
              </button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="從（1 單位）">
              <input
                value={fx.from}
                disabled={!fx.isNew}
                onChange={(e) => setFx({ ...fx, from: e.target.value })}
              />
            </Field>
            <Field label="到">
              <input
                value={fx.to}
                disabled={!fx.isNew}
                onChange={(e) => setFx({ ...fx, to: e.target.value })}
              />
            </Field>
            <Field label="匯率（1 單位 from = 多少 to）">
              <input
                type="number"
                step="any"
                value={fx.rate}
                onChange={(e) => setFx({ ...fx, rate: e.target.value })}
              />
            </Field>
          </div>
          <ErrorList errors={errors} />
        </Modal>
      )}
    </>
  );
}
