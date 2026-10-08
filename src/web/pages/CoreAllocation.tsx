import { useMemo, useState } from 'react';
import {
  compareAllocation,
  newId,
  planAllocation,
  type AllocationTarget,
  type ID,
} from '@core/index';
import { removeRow, upsertRow, useData } from '../store';
import { usePortfolio } from '../usePortfolio';
import { fmtMoney, fmtPct, signClass } from '../format';
import { Badge, Card, Empty, PageHeader, Stat } from '../components/ui';
import { PlanView } from './allocation/PlanView';
import { ReplacementPanel } from './allocation/ReplacementPanel';
import { WeightBar } from './allocation/WeightBar';
import './allocation/allocation.css';

/** Percent input that keeps what is typed and commits on blur. */
function PctInput(props: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string>();
  const shown = draft ?? String(Number((props.value * 100).toFixed(4)));
  return (
    <input
      className="pct-input"
      type="number"
      step="0.5"
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== undefined) {
          const n = parseFloat(draft);
          if (Number.isFinite(n)) props.onCommit(n / 100);
          setDraft(undefined);
        }
      }}
    />
  );
}

function TargetRow(props: {
  target: AllocationTarget;
  indexName: string;
  options: Array<[ID, string]>;
}) {
  const { target: t } = props;
  const save = (patch: Partial<AllocationTarget>) => upsertRow('targets', { ...t, ...patch });
  return (
    <tr>
      <td>{props.indexName}</td>
      <td className="num">
        <PctInput value={t.targetWeight} onCommit={(v) => save({ targetWeight: v })} />
      </td>
      <td className="num">
        <PctInput value={t.tolerance} onCommit={(v) => save({ tolerance: Math.abs(v) })} />
      </td>
      <td>
        <select
          value={t.preferredInstrumentId ?? ''}
          onChange={(e) => save({ preferredInstrumentId: e.target.value || undefined })}
        >
          <option value="">自動（無槓桿商品）</option>
          {props.options.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input value={t.note ?? ''} onChange={(e) => save({ note: e.target.value || undefined })} />
      </td>
      <td>
        <button className="danger" onClick={() => removeRow('targets', t.id)}>
          移除
        </button>
      </td>
    </tr>
  );
}

export default function CoreAllocationPage() {
  const data = useData();
  const { valuation } = usePortfolio();
  const [newIndex, setNewIndex] = useState('');
  const base = valuation.baseCurrency;

  const cmp = useMemo(() => compareAllocation(data, valuation), [data, valuation]);
  const names = useMemo(
    () => Object.fromEntries(data.indices.map((i) => [i.id, i.name])),
    [data.indices],
  );
  const plan = useMemo(() => {
    const account = data.accounts.find((a) => a.active)?.id ?? '';
    return planAllocation(data, valuation, {
      amount: 0,
      currency: base,
      source: 'internal',
      accountId: account,
      allowSell: true,
      useExistingCash: true,
    });
  }, [data, valuation, base]);

  const available = data.indices.filter((i) => !data.targets.some((t) => t.indexId === i.id));
  const t = cmp.totals;
  const scale = Math.max(
    0.5,
    ...cmp.rows.flatMap((r) => [Math.abs(r.targetWeight), Math.abs(r.coreWeight)]),
  );
  const m = (v: number) => fmtMoney(v, base);

  return (
    <>
      <PageHeader
        title="Core Allocation"
        subtitle="被動核心組合：目標曝險 vs 實際曝險（以 NAV 為分母）"
      />
      <div className="notice">
        不設強制槓桿上限：目標權重可超過 100% 或為負值，容忍區間與門檻僅供參考提示。優化器只管理
        Core；主動策略曝險另列，但計入總曝險。
      </div>

      <div className="stats">
        <Stat label="NAV" value={m(t.nav)} />
        <Stat
          label="目標 Net／Gross"
          value={`${fmtPct(t.targetNet)} ／ ${fmtPct(t.targetGross)}`}
        />
        <Stat
          label="Core 實際 Net／Gross"
          value={`${m(t.coreNet)} ／ ${m(t.coreGross)}`}
          hint={
            cmp.navValid
              ? `${fmtPct(t.coreNet / t.nav)} ／ ${fmtPct(t.coreGross / t.nav)}`
              : undefined
          }
        />
        <Stat label="策略 Net／Gross" value={`${m(t.strategyNet)} ／ ${m(t.strategyGross)}`} />
        <Stat
          label="合計 Net／Gross（含策略）"
          value={`${m(t.totalNet)} ／ ${m(t.totalGross)}`}
          hint={
            cmp.navValid
              ? `${fmtPct(t.totalNet / t.nav)} ／ ${fmtPct(t.totalGross / t.nav)}`
              : undefined
          }
        />
      </div>

      {cmp.warnings.length > 0 && <div className="notice warn">{cmp.warnings.join('；')}</div>}

      <Card
        title="目標設定"
        actions={
          <>
            <select
              value={newIndex}
              onChange={(e) => setNewIndex(e.target.value)}
              aria-label="選擇指數"
            >
              <option value="">選擇指數…</option>
              {available.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <button
              className="primary"
              disabled={!newIndex}
              onClick={() => {
                upsertRow('targets', {
                  id: newId('tg'),
                  indexId: newIndex,
                  targetWeight: 0,
                  tolerance: 0.02,
                });
                setNewIndex('');
              }}
            >
              新增目標
            </button>
          </>
        }
      >
        {data.targets.length === 0 ? (
          <Empty>尚未設定目標，請先選擇指數並新增</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>指數</th>
                  <th className="num">目標權重 %</th>
                  <th className="num">容忍區間 ± %</th>
                  <th>偏好商品</th>
                  <th>備註</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.targets.map((tg) => (
                  <TargetRow
                    key={tg.id}
                    target={tg}
                    indexName={names[tg.indexId] ?? tg.indexId}
                    options={data.instruments
                      .filter((i) => i.indexId === tg.indexId && i.active)
                      .map((i): [ID, string] => [
                        i.id,
                        `${i.symbol}${i.leverage !== 1 ? `（${i.leverage}×）` : ''}`,
                      ])}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>合計</td>
                  <td className="num">Net {fmtPct(t.targetNet)}</td>
                  <td className="num">Gross {fmtPct(t.targetGross)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="目標 vs 實際"
        actions={
          <span className="muted">
            <span className="legend" />
            目標
            <span className="legend actual" />
            Core 實際
          </span>
        }
      >
        {cmp.rows.length === 0 ? (
          <Empty>沒有目標也沒有持倉</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>市場 / 指數 / 商品</th>
                  <th className="num">目標</th>
                  <th className="num">Core 實際</th>
                  <th className="num">策略</th>
                  <th className="num">合計</th>
                  <th className="num">缺口（{base}）</th>
                  <th className="num">缺口（百分點）</th>
                  <th>狀態</th>
                  <th>目標 / 實際</th>
                </tr>
              </thead>
              <tbody>
                {cmp.groups.map((g) => (
                  <GroupRows key={g.market} group={g} scale={scale} base={base} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <h2>再平衡建議</h2>
      <p className="muted">
        再平衡模式（可買可賣）：只處理超出容忍區間的指數，並以賣出所得支應買進。以下為建議清單，網站不會下單、也不會寫入任何交易。
      </p>
      <PlanView plan={plan} names={names} />

      <ReplacementPanel />
    </>
  );
}

function GroupRows(props: {
  group: ReturnType<typeof compareAllocation>['groups'][number];
  scale: number;
  base: string;
}) {
  const { group: g, scale, base } = props;
  const m = (v: number) => fmtMoney(v, base);
  return (
    <>
      <tr className="market-row">
        <td>{g.market}</td>
        <td className="num">{fmtPct(g.targetWeight)}</td>
        <td className="num">{m(g.coreExposure)}</td>
        <td className="num">{m(g.strategyExposure)}</td>
        <td className="num">{m(g.totalExposure)}</td>
        <td colSpan={5} />
      </tr>
      {g.rows.map((r) => (
        <IndexRows key={r.indexId} row={r} scale={scale} base={base} />
      ))}
    </>
  );
}

function IndexRows(props: {
  row: ReturnType<typeof compareAllocation>['rows'][number];
  scale: number;
  base: string;
}) {
  const { row: r, scale, base } = props;
  const m = (v: number) => fmtMoney(v, base);
  return (
    <>
      <tr>
        <td className="indent">{r.name}</td>
        <td className="num">{r.hasTarget ? fmtPct(r.targetWeight) : '—'}</td>
        <td className="num">
          {m(r.coreExposure)} <span className="muted">({fmtPct(r.coreWeight)})</span>
        </td>
        <td className="num">{m(r.strategyExposure)}</td>
        <td className="num">{m(r.totalExposure)}</td>
        <td className={`num ${signClass(r.gap)}`}>{r.hasTarget ? m(r.gap) : '—'}</td>
        <td className={`num ${signClass(r.gapWeight)}`}>
          {r.hasTarget ? fmtPct(r.gapWeight) : '—'}
        </td>
        <td>
          {!r.hasTarget ? (
            <Badge tone="info">無目標</Badge>
          ) : r.outOfBand ? (
            <Badge tone="warn">超出區間</Badge>
          ) : (
            <Badge tone="ok">區間內</Badge>
          )}
        </td>
        <td>
          <WeightBar target={r.targetWeight} actual={r.coreWeight} scale={scale} />
        </td>
      </tr>
      {r.instruments.map((i) => (
        <tr key={`${i.instrumentId}-${i.bucket}`} className="instrument-row">
          <td className="indent" style={{ paddingLeft: 44 }}>
            {i.symbol} · {i.bucket === 'core' ? 'Core' : `策略 ${i.bucket}`}
          </td>
          <td />
          <td className="num" colSpan={3}>
            {m(i.exposure)}
            {i.share !== undefined && <span> ({fmtPct(i.share, 0)})</span>}
          </td>
          <td className="num" colSpan={5}>
            數量 {i.quantity}
          </td>
        </tr>
      ))}
    </>
  );
}
