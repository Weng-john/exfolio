import { useMemo, useState } from 'react';
import {
  coreExposureOf,
  DEFAULT_ASSUMPTIONS,
  replacementAnalysis,
  type ReplacementAssumptions,
} from '@core/index';
import { useData } from '../../store';
import { usePortfolio } from '../../usePortfolio';
import { Card, Empty, Field } from '../../components/ui';
import { fmtMoney } from '../../format';
import { ReplacementHistory } from './ReplacementHistory';
import { ReplacementSubstitution } from './ReplacementSubstitution';
import { ReplacementTable } from './ReplacementTable';
import './replacement.css';

const STORAGE_KEY = 'exfolio.replacement.assumptions';

function loadAssumptions(): ReplacementAssumptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ReplacementAssumptions>;
      const out = { ...DEFAULT_ASSUMPTIONS };
      for (const k of Object.keys(out) as Array<keyof ReplacementAssumptions>)
        if (typeof parsed[k] === 'number' && Number.isFinite(parsed[k])) out[k] = parsed[k]!;
      return out;
    }
  } catch {
    /* storage unavailable: use defaults */
  }
  return { ...DEFAULT_ASSUMPTIONS };
}

/** Number input that keeps what is typed and commits on blur. */
function NumField(props: {
  label: string;
  hint: string;
  value: number;
  scale?: number;
  step?: number;
  onCommit: (v: number) => void;
}) {
  const scale = props.scale ?? 1;
  const [draft, setDraft] = useState<string>();
  const shown = draft ?? String(Number((props.value * scale).toFixed(6)));
  return (
    <Field label={props.label} hint={props.hint}>
      <input
        type="number"
        step={props.step ?? 0.1}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== undefined) {
            const n = parseFloat(draft);
            if (Number.isFinite(n) && n >= 0) props.onCommit(n / scale);
            setDraft(undefined);
          }
        }}
      />
    </Field>
  );
}

/** Instrument replacement comparison: estimates under stated assumptions. */
export function ReplacementPanel() {
  const data = useData();
  const portfolio = usePortfolio();
  const { valuation } = portfolio;
  const base = valuation.baseCurrency;

  const indexOptions = useMemo(
    () =>
      data.indices.filter(
        (ix) => data.instruments.filter((i) => i.indexId === ix.id && i.active).length >= 2,
      ),
    [data.indices, data.instruments],
  );
  const [indexPick, setIndexPick] = useState('');
  const [exposureDraft, setExposureDraft] = useState<string>();
  const [fromPick, setFromPick] = useState('');
  const [accountPick, setAccountPick] = useState('');
  const [assumptions, setAssumptions] = useState(loadAssumptions);

  const indexId =
    indexOptions.find((ix) => ix.id === indexPick)?.id ??
    indexOptions.find((ix) => coreExposureOf(valuation, ix.id) > 0)?.id ??
    indexOptions[0]?.id ??
    '';
  const instruments = data.instruments.filter((i) => i.indexId === indexId && i.active);
  const held = instruments.filter((i) =>
    valuation.positions.some((p) => p.instrumentId === i.id && p.bucket === 'core' && p.quantity),
  );
  const fromId = fromPick === '-' ? '' : fromPick || held[0]?.id || '';
  const accounts = data.accounts.filter((a) => a.active);
  const accountId =
    accounts.find((a) => a.id === accountPick)?.id ??
    valuation.positions.find((p) => p.instrumentId === fromId)?.accountId ??
    accounts[0]?.id ??
    '';

  const coreExposure = indexId ? coreExposureOf(valuation, indexId) : 0;
  const typed = exposureDraft === undefined ? undefined : parseFloat(exposureDraft);
  const exposure = typed !== undefined && Number.isFinite(typed) ? typed : coreExposure;

  const update = (patch: Partial<ReplacementAssumptions>) => {
    const next = { ...assumptions, ...patch };
    setAssumptions(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const analysis = useMemo(
    () =>
      indexId
        ? replacementAnalysis(data, valuation, {
            indexId,
            fromInstrumentId: fromId || undefined,
            exposure,
            assumptions,
            accountId: accountId || undefined,
          })
        : undefined,
    [data, valuation, indexId, fromId, exposure, assumptions, accountId],
  );

  return (
    <Card
      title="商品替代比較"
      actions={
        <button onClick={() => setAssumptions({ ...DEFAULT_ASSUMPTIONS })}>還原預設假設</button>
      }
    >
      <div className="notice">
        以下皆為在所示假設下的估計。歷史結果只描述過去，不是預測；網站不會下單、也不會寫入任何交易。
      </div>
      {!indexOptions.length ? (
        <Empty>沒有同一指數下至少兩個可用商品，無法比較。請先到商品設定加入商品。</Empty>
      ) : (
        <>
          <div className="rp-controls">
            <Field label="指數">
              <select
                value={indexId}
                onChange={(e) => {
                  setIndexPick(e.target.value);
                  setFromPick('');
                  setExposureDraft(undefined);
                }}
              >
                {indexOptions.map((ix) => (
                  <option key={ix.id} value={ix.id}>
                    {ix.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={`曝險金額（${base}）`}
              hint={`目前 Core：${fmtMoney(coreExposure, base)}`}
            >
              <input
                type="number"
                step={10000}
                value={exposureDraft ?? String(Math.round(coreExposure))}
                onChange={(e) => setExposureDraft(e.target.value)}
              />
            </Field>
            <Field label="要替換的現有商品">
              <select value={fromId || '-'} onChange={(e) => setFromPick(e.target.value)}>
                <option value="-">不指定</option>
                {instruments.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.symbol}
                    {held.includes(i) ? '（持有）' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="帳戶（手續費規則）">
              <select value={accountId} onChange={(e) => setAccountPick(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="rp-assume">
            <NumField
              label="融資利率 %／年"
              hint="槓桿 ETF 借入部分、期貨隱含融資"
              value={assumptions.financingRate}
              scale={100}
              onCommit={(v) => update({ financingRate: v })}
            />
            <NumField
              label="現金利率 %／年"
              hint="未占用資金的收益（抵減項）"
              value={assumptions.cashRate}
              scale={100}
              onCommit={(v) => update({ cashRate: v })}
            />
            <NumField
              label="指數波動度 %／年"
              hint="用於每日重設波動耗損近似"
              value={assumptions.volatility}
              scale={100}
              onCommit={(v) => update({ volatility: v })}
            />
            <NumField
              label="換月次數／年"
              hint="期貨"
              value={assumptions.rollsPerYear}
              step={1}
              onCommit={(v) => update({ rollsPerYear: v })}
            />
            <NumField
              label="單邊滑價 %"
              hint="占成交金額比例"
              value={assumptions.slippage}
              scale={100}
              step={0.01}
              onCommit={(v) => update({ slippage: v })}
            />
          </div>

          {analysis && (
            <>
              <ReplacementTable analysis={analysis} />
              {analysis.warnings.map((w, i) => (
                <p key={i} className="muted">
                  {w}
                </p>
              ))}
              <p className="muted">
                模型未納入：稅負與股利處理差異、實際基差與資金費率、保證金調整、匯率變動、買賣價差的實際分布。波動耗損為
                ½·L·(L−1)·σ²·資金的近似，會隨實際路徑而不同。
              </p>
            </>
          )}

          <div className="rp-section">
            <h3>歷史路徑比較</h3>
            <ReplacementHistory
              key={indexId}
              data={data}
              instruments={instruments}
              defaultBase={instruments.find((i) => i.leverage === 1 && i.type === 'etf')?.id}
            />
          </div>

          <div className="rp-section">
            <h3>替換預覽（僅供參考，不建立任何交易）</h3>
            <ReplacementSubstitution
              key={indexId}
              data={data}
              portfolio={portfolio}
              indexId={indexId}
              instruments={instruments}
              assumptions={assumptions}
            />
          </div>
        </>
      )}
    </Card>
  );
}
