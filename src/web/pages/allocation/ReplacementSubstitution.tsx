import { useMemo, useState } from 'react';
import {
  substitutionEffect,
  type AppData,
  type Instrument,
  type Portfolio,
  type ReplacementAssumptions,
} from '@core/index';
import { Empty, Field, Stat } from '../../components/ui';
import { fmtMoney, fmtNum, fmtX } from '../../format';

/** Preview of replacing part of a held position. Advisory: writes nothing. */
export function ReplacementSubstitution(props: {
  data: AppData;
  portfolio: Portfolio;
  indexId: string;
  instruments: Instrument[];
  assumptions: ReplacementAssumptions;
}) {
  const { data, portfolio, indexId, instruments, assumptions } = props;
  const positions = portfolio.valuation.positions.filter(
    (p) => p.indexId === indexId && p.bucket === 'core' && p.quantity !== 0,
  );
  const [posKey, setPosKey] = useState('');
  const [toId, setToId] = useState('');
  const [fraction, setFraction] = useState(100);
  const pos = positions.find((p) => p.key === posKey) ?? positions[0];
  const target =
    instruments.find((i) => i.id === toId && i.id !== pos?.instrumentId) ??
    instruments.find((i) => i.id !== pos?.instrumentId);

  const effect = useMemo(
    () =>
      pos && target
        ? substitutionEffect(data, portfolio, {
            fromPositionKey: pos.key,
            toInstrumentId: target.id,
            fraction: fraction / 100,
            assumptions,
          })
        : undefined,
    [data, portfolio, pos, target, fraction, assumptions],
  );

  if (!positions.length) return <Empty>此指數在 Core 沒有持倉可替換。</Empty>;
  const base = portfolio.valuation.baseCurrency;
  const m = (v?: number) => fmtMoney(v, base);
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? id;

  return (
    <>
      <div className="rp-controls">
        <Field label="現有部位">
          <select value={pos?.key} onChange={(e) => setPosKey(e.target.value)}>
            {positions.map((p) => (
              <option key={p.key} value={p.key}>
                {p.instrument.symbol} · {accountName(p.accountId)} · {fmtNum(p.quantity, 4)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="換成">
          <select value={target?.id} onChange={(e) => setToId(e.target.value)}>
            {instruments
              .filter((i) => i.id !== pos?.instrumentId)
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.symbol}
                </option>
              ))}
          </select>
        </Field>
        <Field label="替換比例 %">
          <input
            type="number"
            min={1}
            max={100}
            step={5}
            value={fraction}
            onChange={(e) => setFraction(Math.min(100, Math.max(0, Number(e.target.value))))}
          />
        </Field>
      </div>
      {effect && (
        <>
          {effect.problems.length > 0 && (
            <div className="notice warn">
              <ul className="notes-list">
                {effect.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {effect.feasible && (
            <>
              <div className="stats">
                <Stat
                  label="需要的交易（取整後）"
                  value={effect.trades
                    .map(
                      (t) =>
                        `${t.side === 'buy' ? '買' : '賣'} ${t.symbol} ${fmtNum(t.quantity, 4)}`,
                    )
                    .join('；')}
                />
                <Stat
                  label="曝險殘差（取整）"
                  value={m(effect.exposureResidual)}
                  hint={`移出 ${m(effect.exposureRemoved)} → 移入 ${m(effect.exposureAdded)}`}
                />
                <Stat
                  label="現金釋出／所需（含保證金）"
                  value={m(effect.freeCashChange)}
                  hint={`買賣淨額 ${m(effect.tradeCashChange)}；保證金變動 ${m(effect.marginChange)}`}
                />
                <Stat label="預估轉換成本" value={m(effect.switching?.total)} />
                <Stat
                  label="Gross 曝險 前→後"
                  value={`${m(effect.grossExposureBefore)} → ${m(effect.grossExposureAfter)}`}
                />
                <Stat
                  label="Net 曝險 前→後"
                  value={`${m(effect.netExposureBefore)} → ${m(effect.netExposureAfter)}`}
                />
                <Stat
                  label="Gross 槓桿 前→後"
                  value={`${fmtX(effect.grossLeverageBefore)} → ${fmtX(effect.grossLeverageAfter)}`}
                  hint="僅供參考，無強制上限"
                />
              </div>
              {effect.switching && effect.switching.flags.length > 0 && (
                <p className="muted">{effect.switching.flags.join('；')}</p>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
