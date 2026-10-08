import { useMemo, useState } from 'react';
import {
  instrumentReferences,
  isDerivative,
  newId,
  validateInstrument,
  type Instrument,
  type InstrumentType,
  type QuoteSource,
} from '@core/index';
import { removeRow, upsertRow, useData } from '../../store';
import { usePortfolio } from '../../usePortfolio';
import { Badge, Card, Empty, Field, Modal } from '../../components/ui';
import { Check, describeRefs, ErrorList, numStr, parseNum } from './shared';

const TYPE_LABEL: Record<InstrumentType, string> = {
  stock: '股票',
  etf: 'ETF',
  future: '期貨',
  perpetual: '永續合約',
  crypto: '加密貨幣現貨',
  option: '選擇權',
};

// Form state keeps numbers as strings so half-typed input is not lost.
interface Draft {
  id: string;
  symbol: string;
  name: string;
  type: InstrumentType;
  exchange: string;
  currency: string;
  indexId: string;
  leverage: string;
  multiplier: string;
  lotSize: string;
  quoteSource: QuoteSource;
  quoteSymbol: string;
  expenseRatio: string;
  seriesId: string;
  expiry: string;
  tickSize: string;
  initialMargin: string;
  maintenanceMargin: string;
  settlement: '' | 'cash' | 'physical';
  brokerIds: string[];
  validFrom: string;
  validTo: string;
  active: boolean;
  note: string;
}

function toDraft(i: Instrument): Draft {
  return {
    id: i.id, symbol: i.symbol, name: i.name, type: i.type, exchange: i.exchange, currency: i.currency,
    indexId: i.indexId ?? '', leverage: String(i.leverage), multiplier: String(i.multiplier),
    lotSize: String(i.lotSize), quoteSource: i.quoteSource, quoteSymbol: i.quoteSymbol ?? '',
    expenseRatio: numStr(i.expenseRatio), seriesId: i.seriesId ?? '', expiry: i.expiry ?? '',
    tickSize: numStr(i.tickSize), initialMargin: numStr(i.initialMargin),
    maintenanceMargin: numStr(i.maintenanceMargin), settlement: i.settlement ?? '',
    brokerIds: i.brokerIds ?? [], validFrom: i.validFrom ?? '', validTo: i.validTo ?? '',
    active: i.active, note: i.note ?? '',
  };
}

function blankDraft(): Draft {
  return toDraft({
    id: newId('inst'), symbol: '', name: '', type: 'etf', exchange: '', currency: 'TWD', leverage: 1,
    multiplier: 1, lotSize: 1, quoteSource: 'manual', active: true,
  });
}

function fromDraft(d: Draft): Instrument {
  const deriv = isDerivative(d.type);
  const i: Instrument = {
    id: d.id.trim(), symbol: d.symbol.trim(), name: d.name.trim(), type: d.type,
    exchange: d.exchange.trim(), currency: d.currency.trim().toUpperCase(),
    leverage: Number(d.leverage), multiplier: Number(d.multiplier), lotSize: Number(d.lotSize),
    quoteSource: d.quoteSource, active: d.active,
  };
  if (d.indexId) i.indexId = d.indexId;
  if (d.quoteSymbol.trim()) i.quoteSymbol = d.quoteSymbol.trim();
  if (d.brokerIds.length) i.brokerIds = d.brokerIds;
  if (d.validFrom) i.validFrom = d.validFrom;
  if (d.validTo) i.validTo = d.validTo;
  if (d.note.trim()) i.note = d.note.trim();
  if (!deriv) {
    const er = parseNum(d.expenseRatio);
    if (er !== undefined) i.expenseRatio = er;
  } else {
    if (d.seriesId.trim()) i.seriesId = d.seriesId.trim();
    if (d.expiry) i.expiry = d.expiry;
    for (const k of ['tickSize', 'initialMargin', 'maintenanceMargin'] as const) {
      const v = parseNum(d[k]);
      if (v !== undefined) i[k] = v;
    }
    if (d.settlement) i.settlement = d.settlement;
  }
  return i;
}

export default function InstrumentsTab() {
  const data = useData();
  const { ledger } = usePortfolio();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [indexId, setIndexId] = useState('');
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState<{ draft: Draft; isNew: boolean } | undefined>();
  const [errors, setErrors] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<Instrument | undefined>();

  const indexName = (id?: string) => data.indices.find((x) => x.id === id)?.name ?? '—';
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.instruments.filter(
      (i) =>
        (!type || i.type === type) &&
        (!indexId || i.indexId === indexId) &&
        (!active || String(i.active) === active) &&
        (!needle || `${i.id} ${i.symbol} ${i.name} ${i.exchange}`.toLowerCase().includes(needle)),
    );
  }, [data.instruments, q, type, indexId, active]);

  const set = (patch: Partial<Draft>) => editing && setEditing({ ...editing, draft: { ...editing.draft, ...patch } });

  const save = () => {
    if (!editing) return;
    const inst = fromDraft(editing.draft);
    const errs = validateInstrument(inst, data.instruments, editing.isNew);
    if (errs.length) return setErrors(errs);
    upsertRow('instruments', inst);
    setEditing(undefined);
    setErrors([]);
  };

  const tryDelete = (inst: Instrument) => {
    const held = ledger.positions.some((p) => p.instrumentId === inst.id);
    if (instrumentReferences(data, inst.id, held).length) return setBlocked(inst);
    if (window.confirm(`確定刪除商品「${inst.symbol} ${inst.name}」？`)) removeRow('instruments', inst.id);
  };

  const d = editing?.draft;
  const deriv = d ? isDerivative(d.type) : false;
  const blockedHeld = blocked ? ledger.positions.some((p) => p.instrumentId === blocked.id) : false;

  return (
    <Card
      title={`商品登錄（${rows.length} / ${data.instruments.length}）`}
      actions={<button className="primary" onClick={() => { setEditing({ draft: blankDraft(), isNew: true }); setErrors([]); }}>新增商品</button>}
    >
      <div className="settings-toolbar">
        <input type="search" placeholder="搜尋代號 / 名稱 / 交易所" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="類型">
          <option value="">全部類型</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={indexId} onChange={(e) => setIndexId(e.target.value)} aria-label="標的指數">
          <option value="">全部指數</option>
          {data.indices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select value={active} onChange={(e) => setActive(e.target.value)} aria-label="狀態">
          <option value="">全部狀態</option>
          <option value="true">啟用</option>
          <option value="false">停用</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <Empty>沒有符合的商品</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>代號</th><th>名稱</th><th>類型</th><th>指數</th><th className="num">槓桿</th>
                <th className="num">乘數</th><th>報價來源</th><th>狀態</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td>{i.symbol}</td>
                  <td>{i.name}</td>
                  <td>{TYPE_LABEL[i.type]}</td>
                  <td>{indexName(i.indexId)}</td>
                  <td className="num">{i.leverage}</td>
                  <td className="num">{i.multiplier}</td>
                  <td>{i.quoteSource}{i.quoteSymbol ? ` · ${i.quoteSymbol}` : ''}</td>
                  <td>{i.active ? <Badge tone="ok">啟用</Badge> : <Badge tone="warn">停用</Badge>}</td>
                  <td>
                    <div className="settings-row-actions">
                      <button onClick={() => { setEditing({ draft: toDraft(i), isNew: false }); setErrors([]); }}>編輯</button>
                      <button className="danger" onClick={() => tryDelete(i)}>刪除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {blocked && (
        <Modal
          title="無法刪除商品"
          onClose={() => setBlocked(undefined)}
          footer={
            <>
              <button onClick={() => setBlocked(undefined)}>取消</button>
              {blocked.active && (
                <button className="primary" onClick={() => { upsertRow('instruments', { ...blocked, active: false }); setBlocked(undefined); }}>
                  停用
                </button>
              )}
            </>
          }
        >
          <p>
            「{blocked.symbol} {blocked.name}」仍被引用：{describeRefs(instrumentReferences(data, blocked.id, blockedHeld))}。
            刪除會讓歷史交易與持倉失去商品定義、造成估值錯誤。
          </p>
          <p className="muted">
            {blocked.active ? '可改為「停用」：保留資料與歷史，但不再用於新交易與報價更新。' : '此商品已停用。'}
          </p>
        </Modal>
      )}

      {editing && d && (
        <Modal
          wide
          title={editing.isNew ? '新增商品' : `編輯商品 ${d.symbol}`}
          onClose={() => setEditing(undefined)}
          footer={
            <>
              <button onClick={() => setEditing(undefined)}>取消</button>
              <button className="primary" onClick={save}>儲存</button>
            </>
          }
        >
          <div className="form-grid">
            <Field label="id（唯一）"><input value={d.id} disabled={!editing.isNew} onChange={(e) => set({ id: e.target.value })} /></Field>
            <Field label="類型">
              <select value={d.type} onChange={(e) => set({ type: e.target.value as InstrumentType })}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="代號"><input value={d.symbol} onChange={(e) => set({ symbol: e.target.value })} /></Field>
            <Field label="名稱"><input value={d.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="交易所"><input value={d.exchange} onChange={(e) => set({ exchange: e.target.value })} /></Field>
            <Field label="幣別"><input value={d.currency} onChange={(e) => set({ currency: e.target.value })} /></Field>
            <Field label="標的指數">
              <select value={d.indexId} onChange={(e) => set({ indexId: e.target.value })}>
                <option value="">（未指定）</option>
                {data.indices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            <Field label="最小交易單位"><input type="number" step="any" value={d.lotSize} onChange={(e) => set({ lotSize: e.target.value })} /></Field>
            <Field label="每日目標槓桿" hint="一般商品 1；反向用負數"><input type="number" step="any" value={d.leverage} onChange={(e) => set({ leverage: e.target.value })} /></Field>
            {!deriv && (
              <Field label="費用率" hint="例如 0.0095 = 0.95%"><input type="number" step="any" value={d.expenseRatio} onChange={(e) => set({ expenseRatio: e.target.value })} /></Field>
            )}
            <Field label="合約乘數"><input type="number" step="any" value={d.multiplier} onChange={(e) => set({ multiplier: e.target.value })} /></Field>
            <Field label="報價來源">
              <select value={d.quoteSource} onChange={(e) => set({ quoteSource: e.target.value as QuoteSource })}>
                <option value="manual">manual（手動）</option>
                <option value="yahoo">yahoo</option>
                <option value="binance">binance</option>
              </select>
            </Field>
            <Field label="報價代號" hint={d.quoteSource === 'yahoo' ? '如 0050.TW、VOO、ES=F' : d.quoteSource === 'binance' ? '如 BTCUSDT' : ''}>
              <input value={d.quoteSymbol} disabled={d.quoteSource === 'manual'} onChange={(e) => set({ quoteSymbol: e.target.value })} />
            </Field>
            <Field label="生效日"><input type="date" value={d.validFrom} onChange={(e) => set({ validFrom: e.target.value })} /></Field>
            <Field label="失效日"><input type="date" value={d.validTo} onChange={(e) => set({ validTo: e.target.value })} /></Field>
          </div>

          {deriv && (
            <>
              <div className="settings-section-title">合約規格</div>
              <div className="form-grid">
                <Field label="系列 seriesId"><input value={d.seriesId} onChange={(e) => set({ seriesId: e.target.value })} /></Field>
                <Field label="到期日"><input type="date" value={d.expiry} onChange={(e) => set({ expiry: e.target.value })} /></Field>
                <Field label="最小跳動點"><input type="number" step="any" value={d.tickSize} onChange={(e) => set({ tickSize: e.target.value })} /></Field>
                <Field label="原始保證金"><input type="number" step="any" value={d.initialMargin} onChange={(e) => set({ initialMargin: e.target.value })} /></Field>
                <Field label="維持保證金"><input type="number" step="any" value={d.maintenanceMargin} onChange={(e) => set({ maintenanceMargin: e.target.value })} /></Field>
                <Field label="結算方式">
                  <select value={d.settlement} onChange={(e) => set({ settlement: e.target.value as Draft['settlement'] })}>
                    <option value="">（未指定）</option>
                    <option value="cash">現金結算</option>
                    <option value="physical">實物交割</option>
                  </select>
                </Field>
              </div>
            </>
          )}

          <div className="settings-section-title">可交易券商（不勾選 = 不限制）</div>
          <div className="form-grid">
            {data.brokers.map((b) => (
              <Check
                key={b.id}
                label={b.name}
                checked={d.brokerIds.includes(b.id)}
                onChange={(v) => set({ brokerIds: v ? [...d.brokerIds, b.id] : d.brokerIds.filter((x) => x !== b.id) })}
              />
            ))}
          </div>

          <div className="settings-section-title">其他</div>
          <div className="form-grid">
            <Check label="啟用" checked={d.active} onChange={(v) => set({ active: v })} />
            <Field label="備註"><input value={d.note} onChange={(e) => set({ note: e.target.value })} /></Field>
          </div>
          <ErrorList errors={errors} />
        </Modal>
      )}
    </Card>
  );
}
