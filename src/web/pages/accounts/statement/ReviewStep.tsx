import { useState } from 'react';
import {
  type AppData,
  type Instrument,
  type InstrumentProposal,
  type InstrumentType,
  type ParsedRow,
  type RowOutcome,
  type StatementBuildResult,
} from '@core/index';
import { Badge } from '../../../components/ui';
import { fmtNum } from '../../../format';
import { TX_LABELS } from '../labels';

type Status = RowOutcome['status'];

const STATUS_LABEL: Record<Status, string> = {
  ok: '可匯入',
  duplicate: '已匯入過（略過）',
  error: '錯誤',
  needs_instrument: '需確認商品',
  needs_review: '需確認比對',
};
const STATUS_TONE: Record<Status, 'ok' | 'warn' | 'bad' | 'info'> = {
  ok: 'ok',
  duplicate: 'info',
  error: 'bad',
  needs_instrument: 'warn',
  needs_review: 'warn',
};
const TYPES: InstrumentType[] = ['stock', 'etf', 'future', 'perpetual', 'crypto', 'option'];
const TYPE_LABEL: Record<InstrumentType, string> = {
  stock: '股票',
  etf: 'ETF',
  future: '期貨',
  perpetual: '永續合約',
  crypto: '加密現貨',
  option: '選擇權',
};

export interface ReviewStepProps {
  data: AppData;
  rows: ParsedRow[];
  build: StatementBuildResult;
  drafts: Record<string, Instrument>;
  confirmed: Record<string, boolean>;
  choices: Record<string, string>;
  onDraft: (key: string, draft: Instrument) => void;
  onConfirm: (key: string, on: boolean) => void;
  onChoice: (key: string, instrumentId: string | undefined) => void;
}

export default function ReviewStep(p: ReviewStepProps) {
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const outcomes = new Map(p.build.outcomes.map((o) => [o.rowNumber, o]));
  const counts: Record<Status, number> = {
    ok: 0,
    duplicate: 0,
    error: 0,
    needs_instrument: 0,
    needs_review: 0,
  };
  for (const o of p.build.outcomes) counts[o.status]++;
  const shown = p.rows.filter(
    (r) => filter === 'all' || outcomes.get(r.rowNumber)?.status === filter,
  );
  const instSymbol = (id?: string) =>
    p.data.instruments.find((i) => i.id === id)?.symbol ?? id ?? '';
  const txByRow = new Map(
    p.build.outcomes.filter((o) => o.transactionId).map((o) => [o.rowNumber, o.transactionId!]),
  );
  const txById = new Map(p.build.transactions.map((t) => [t.id, t]));
  const choiceOnly = Object.keys(p.choices).filter(
    (k) => !p.build.newInstruments.some((n) => n.key === k),
  );

  return (
    <div>
      <div className="si-counts">
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
          全部 {p.rows.length}
        </button>
        {(Object.keys(counts) as Status[]).map(
          (s) =>
            counts[s] > 0 && (
              <button key={s} className={filter === s ? 'on' : ''} onClick={() => setFilter(s)}>
                {STATUS_LABEL[s]} {counts[s]}
              </button>
            ),
        )}
      </div>

      {(p.build.newInstruments.length > 0 || choiceOnly.length > 0) && (
        <div className="si-block">
          <h3>商品確認</h3>
          <p className="si-note">
            下列代號在您的商品清單中找不到。系統不會自動建立商品：請確認（可修改）新增，或改對應到既有商品。未確認的代號，其交易列不會匯入。
          </p>
          {p.build.newInstruments.map((n) => (
            <InstrumentCard key={n.key} n={n} {...p} />
          ))}
          {choiceOnly.map((k) => (
            <div key={k} className="si-inst confirmed">
              <div className="si-inst-head">
                <strong>{k}</strong> → 對應到 {instSymbol(p.choices[k])}
                <button className="ghost" onClick={() => p.onChoice(k, undefined)}>
                  取消對應
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="si-block">
        <h3>逐列檢視{shown.length > 300 ? '（僅顯示前 300 列）' : ''}</h3>
        <div className="table-wrap si-table">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>狀態</th>
                <th>日期</th>
                <th>類型</th>
                <th>商品</th>
                <th className="num">數量</th>
                <th className="num">價格</th>
                <th className="num">手續費</th>
                <th className="num">稅</th>
                <th>說明</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 300).map((r) => {
                const o = outcomes.get(r.rowNumber);
                const tx = txById.get(txByRow.get(r.rowNumber) ?? '');
                return (
                  <tr key={r.rowNumber}>
                    <td className="muted">{r.rowNumber}</td>
                    <td>
                      {o && <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>}
                    </td>
                    <td>{r.date ?? '—'}</td>
                    <td>{r.type ? TX_LABELS[r.type] : '—'}</td>
                    <td>{tx ? instSymbol(tx.instrumentId) : (r.symbol ?? r.name ?? '')}</td>
                    <td className="num">{fmtNum(tx?.quantity ?? r.quantity, 4)}</td>
                    <td className="num">{fmtNum(tx?.price ?? r.price, 4)}</td>
                    <td className="num">{fmtNum(tx ? tx.fee : r.fee, 2)}</td>
                    <td className="num">{fmtNum(tx ? tx.tax : r.tax, 2)}</td>
                    <td className={o?.status === 'error' ? 'si-bad' : 'si-note'}>
                      {o?.message ?? ''}
                      {o?.status === 'ok' && r.notes.length > 0 ? r.notes.join('；') : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {p.build.warnings.length > 0 && (
        <div className="notice warn si-block">
          <strong>提醒</strong>
          <ul>
            {p.build.warnings.slice(0, 20).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function InstrumentCard({
  n,
  data,
  drafts,
  confirmed,
  onDraft,
  onConfirm,
  onChoice,
}: { n: InstrumentProposal } & ReviewStepProps) {
  const draft = drafts[n.key] ?? n.instrument;
  const isConfirmed = confirmed[n.key] === true;
  const set = (patch: Partial<Instrument>) => onDraft(n.key, { ...draft, ...patch });
  return (
    <div className={`si-inst ${isConfirmed ? 'confirmed' : ''}`}>
      <div className="si-inst-head">
        <strong>{n.key}</strong>
        <span className="muted">{n.rows} 列</span>
        {isConfirmed ? <Badge tone="ok">已確認新增</Badge> : <Badge tone="warn">待確認</Badge>}
        {n.hints.map((h) => (
          <span key={h} className="si-note">
            {h}
          </span>
        ))}
      </div>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">代號</span>
          <input value={draft.symbol} onChange={(e) => set({ symbol: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">名稱</span>
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">類型</span>
          <select
            value={draft.type}
            onChange={(e) => set({ type: e.target.value as InstrumentType })}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">幣別</span>
          <input
            value={draft.currency}
            onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
          />
        </label>
        <label className="field">
          <span className="field-label">契約乘數（股票／現貨為 1）</span>
          <input
            type="number"
            min={0}
            step="any"
            value={draft.multiplier}
            onChange={(e) => set({ multiplier: Number(e.target.value) || 1 })}
          />
        </label>
        <label className="field">
          <span className="field-label">交易所</span>
          <input value={draft.exchange} onChange={(e) => set({ exchange: e.target.value })} />
        </label>
      </div>
      <div className="si-inst-head si-block">
        <button
          className={isConfirmed ? '' : 'primary'}
          onClick={() => onConfirm(n.key, !isConfirmed)}
        >
          {isConfirmed ? '取消確認' : '確認新增此商品'}
        </button>
        {n.weakMatch && (
          <button onClick={() => onChoice(n.key, n.weakMatch!.id)}>
            改用既有商品 {n.weakMatch.symbol} {n.weakMatch.name}
          </button>
        )}
        <select
          aria-label="對應到既有商品"
          value=""
          onChange={(e) => e.target.value && onChoice(n.key, e.target.value)}
        >
          <option value="">對應到既有商品…</option>
          {data.instruments.map((i) => (
            <option key={i.id} value={i.id}>
              {i.symbol} {i.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
