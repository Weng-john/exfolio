import { useState } from 'react';
import {
  bookRollover,
  planRollover,
  type AppData,
  type FuturesPosition,
  type Instrument,
  type RolloverPlan,
} from '@core/index';
import { Card, Field } from '../../components/ui';
import { fmtMoney, fmtNum, signClass } from '../../format';
import { upsertRow } from '../../store';
import { instrumentLabel, optionalNumber } from './shared';

interface Props {
  data: AppData;
  day: string;
  positions: FuturesPosition[];
  selected?: FuturesPosition;
  /** Other contract months of the selected position's series. */
  targetContracts: Instrument[];
  onSelect: (position: FuturesPosition) => void;
  /** Report a failure to the page, or clear it with `undefined`. */
  onError: (message: string | undefined) => void;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Plan a roll for the selected position, then record the fills the user
 * already got. The page remounts it (via `key`) whenever a position is picked,
 * which discards the target and any plan from the previous pick.
 */
export function RolloverPlanner({
  data,
  day,
  positions,
  selected,
  targetContracts,
  onSelect,
  onError,
}: Props) {
  const [targetId, setTargetId] = useState('');
  const [plan, setPlan] = useState<RolloverPlan>();
  const [actualClose, setActualClose] = useState('');
  const [actualOpen, setActualOpen] = useState('');

  const makePlan = () => {
    if (!selected || !targetId) return;
    const prices = Object.fromEntries(data.prices.map((p) => [p.id, p.price]));
    try {
      setPlan(planRollover(data, selected, targetId, prices));
      setActualClose('');
      setActualOpen('');
      onError(undefined);
    } catch (err) {
      onError(messageOf(err));
    }
  };

  const confirmRoll = () => {
    if (!plan) return;
    // A blank fill field means the user traded at the planned price.
    const actualPrices = {
      [plan.fromInstrumentId]: optionalNumber(actualClose) ?? plan.fromPrice,
      [plan.toInstrumentId]: optionalNumber(actualOpen) ?? plan.toPrice,
    };
    try {
      const booked = bookRollover(data, plan, actualPrices, day);
      booked.transactions.forEach((tx) => upsertRow('transactions', tx));
      upsertRow('rollovers', booked.rollover);
      setPlan(undefined);
      setTargetId('');
      onError(undefined);
    } catch (err) {
      onError(messageOf(err));
    }
  };

  const chooseTarget = (id: string) => {
    setTargetId(id);
    setPlan(undefined);
  };

  return (
    <Card title="轉倉計畫">
      <div className="form-grid">
        <Field label="未平倉部位">
          <select
            value={selected?.key ?? ''}
            onChange={(e) => {
              const position = positions.find((p) => p.key === e.target.value);
              if (position) onSelect(position);
            }}
          >
            <option value="">選擇部位</option>
            {positions.map((p) => (
              <option key={p.key} value={p.key}>
                {p.symbol} · {p.contracts} 口 · {p.expiry ?? '無到期日'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="目標合約">
          <select
            value={targetId}
            onChange={(e) => chooseTarget(e.target.value)}
            disabled={!selected}
          >
            <option value="">選擇同一 Series 的合約</option>
            {targetContracts.map((i) => (
              <option key={i.id} value={i.id}>
                {instrumentLabel(i)}
              </option>
            ))}
          </select>
        </Field>
        <div className="futures-action">
          <button className="primary" onClick={makePlan} disabled={!selected || !targetId}>
            計算 Plan
          </button>
        </div>
      </div>
      {plan && (
        <div className="roll-plan">
          <div className="roll-plan-grid">
            <div>
              <span className="field-label">Calendar spread</span>
              <strong>{fmtNum(plan.spread)}</strong>
            </div>
            <div>
              <span className="field-label">Spread cost</span>
              <strong className={signClass(plan.spreadCost)}>
                {fmtMoney(plan.spreadCost, plan.currency)}
              </strong>
            </div>
            <div>
              <span className="field-label">Estimated fees / tax</span>
              <strong>{fmtMoney(plan.estimatedCosts, plan.currency)}</strong>
            </div>
            <div>
              <span className="field-label">Margin change</span>
              <strong>
                {plan.marginChange === undefined
                  ? '缺規格'
                  : fmtMoney(plan.marginChange, plan.currency)}
              </strong>
            </div>
          </div>
          <div className="form-grid">
            <Field label="實際平倉價" hint="留白使用 Plan 價格">
              <input
                type="number"
                value={actualClose}
                onChange={(e) => setActualClose(e.target.value)}
              />
            </Field>
            <Field label="實際開倉價" hint="留白使用 Plan 價格">
              <input
                type="number"
                value={actualOpen}
                onChange={(e) => setActualOpen(e.target.value)}
              />
            </Field>
          </div>
          <p className="muted">確認後只會記錄你已在券商執行的兩筆成交；本網站不送出任何訂單。</p>
          <button className="primary" onClick={confirmRoll}>
            確認並記錄轉倉
          </button>
        </div>
      )}
    </Card>
  );
}
