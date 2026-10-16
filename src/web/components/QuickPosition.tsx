import { useMemo, useState } from 'react';
import {
  customInstrument,
  isDerivative,
  MARKET_LABELS,
  MARKETS,
  QUOTE_SOURCES,
  quickPosition,
  searchInstruments,
  today,
  type Instrument,
  type InstrumentType,
  type QuoteSource,
} from '@core/index';
import { fmtNum } from '../format';
import { setTable, useData } from '../store';
import { Field, Modal } from './ui';

const TYPE_LABELS: Record<InstrumentType, string> = {
  etf: 'ETF',
  stock: '股票',
  future: '期貨',
  perpetual: '永續合約',
  crypto: '加密現貨',
  option: '選擇權',
};

const leverageLabel = (i: Instrument) =>
  i.leverage === 1 ? '' : i.leverage > 0 ? `${i.leverage}×` : `反向 ${-i.leverage}×`;

/**
 * Enter a holding as it stands — instrument, size, average price — without
 * its trade history. Anything missing from the catalogue can be defined here.
 */
export function QuickPosition(props: { onClose: () => void }) {
  const data = useData();
  const [query, setQuery] = useState('');
  const [instrumentId, setInstrumentId] = useState('');
  const [defining, setDefining] = useState(false);
  const [accountId, setAccountId] = useState(data.accounts.find((a) => a.active)?.id ?? '');
  const [newAccountName, setNewAccountName] = useState('');
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [quantity, setQuantity] = useState('');
  const [averageCost, setAverageCost] = useState('');
  const [date, setDate] = useState(today());
  const [fund, setFund] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  const results = useMemo(() => searchInstruments(data, query, 40), [data, query]);
  const instrument = data.instruments.find((i) => i.id === instrumentId);
  const derivative = instrument ? isDerivative(instrument.type) : false;
  const indexName = (id?: string) => data.indices.find((i) => i.id === id)?.name ?? '未分類';

  const save = () => {
    const result = quickPosition(data, {
      accountId: accountId || undefined,
      newAccountName,
      instrumentId,
      quantity: Number(quantity),
      side: derivative ? side : 'long',
      averageCost: Number(averageCost),
      date,
      fundFromOutside: fund,
    });
    if (result.errors.length) return setErrors(result.errors);
    if (result.broker) setTable('brokers', [...data.brokers, result.broker]);
    if (result.account) setTable('accounts', [...data.accounts, result.account]);
    setTable('transactions', [...data.transactions, ...result.transactions]);
    props.onClose();
  };

  return (
    <Modal
      title="新增倉位"
      wide
      onClose={props.onClose}
      footer={
        <>
          <button className="ghost" onClick={props.onClose}>
            取消
          </button>
          <button className="primary" onClick={save} disabled={!instrument}>
            新增
          </button>
        </>
      }
    >
      {errors.length > 0 && (
        <div className="notice warn">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      {defining ? (
        <CustomInstrumentForm
          onCancel={() => setDefining(false)}
          onCreated={(id) => {
            setInstrumentId(id);
            setDefining(false);
          }}
        />
      ) : (
        <>
          <Field label="商品" hint="輸入代號、名稱或指數，例如 SPY、SPYUSDT、0050、日經、KOSPI">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋…" />
          </Field>
          <div
            className="table-wrap"
            style={{ maxHeight: 240, overflowY: 'auto', margin: '8px 0' }}
          >
            <table>
              <tbody>
                {results.map((i) => (
                  <tr
                    key={i.id}
                    onClick={() => setInstrumentId(i.id)}
                    style={{ cursor: 'pointer' }}
                    className={i.id === instrumentId ? 'selected-row' : ''}
                  >
                    <td>
                      <input
                        type="radio"
                        readOnly
                        checked={i.id === instrumentId}
                        aria-label={`選擇 ${i.symbol}`}
                      />
                    </td>
                    <td>
                      <strong>{i.symbol}</strong>
                    </td>
                    <td>{i.name}</td>
                    <td className="muted">{TYPE_LABELS[i.type]}</td>
                    <td className="muted">{indexName(i.indexId)}</td>
                    <td>{leverageLabel(i)}</td>
                    <td className="muted">{i.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <button className="ghost" onClick={() => setDefining(true)}>
              找不到？新增自訂商品
            </button>
          </p>
        </>
      )}

      {instrument && !defining && (
        <>
          <p className="muted">
            {instrument.symbol}：{TYPE_LABELS[instrument.type]}，追蹤{' '}
            {indexName(instrument.indexId)}
            {leverageLabel(instrument) && `，每日 ${leverageLabel(instrument)}`}
            {instrument.multiplier !== 1 && `，契約乘數 ${fmtNum(instrument.multiplier)}`}，以{' '}
            {instrument.currency} 計價。
          </p>
          <div className="form-grid">
            <Field label="帳戶">
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {data.accounts
                  .filter((a) => a.active)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}（{a.baseCurrency}）
                    </option>
                  ))}
                <option value="">＋ 新帳戶…</option>
              </select>
            </Field>
            {!accountId && (
              <Field label="新帳戶名稱">
                <input
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  placeholder="例如：美股帳戶"
                />
              </Field>
            )}
            {derivative && (
              <Field label="方向">
                <select value={side} onChange={(e) => setSide(e.target.value as 'long' | 'short')}>
                  <option value="long">多單</option>
                  <option value="short">空單</option>
                </select>
              </Field>
            )}
            <Field label={derivative ? '口數／數量' : '數量'}>
              <input
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field label={`平均成本（${instrument.currency}）`}>
              <input
                inputMode="decimal"
                value={averageCost}
                onChange={(e) => setAverageCost(e.target.value)}
              />
            </Field>
            <Field label="建立日期" hint="不確定可以填今天">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          {!derivative && (
            <label style={{ display: 'block', marginTop: 8 }}>
              <input type="checkbox" checked={fund} onChange={(e) => setFund(e.target.checked)} />{' '}
              同時記錄買入所用的資金（外部投入），讓現金不會變成負數
            </label>
          )}
          {derivative && (
            <p className="muted">
              期貨與永續合約只占用保證金，不需要記錄買入金額；請另外在這個帳戶記錄入金，系統才知道保證金與帳戶權益。
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

function CustomInstrumentForm(props: { onCancel: () => void; onCreated: (id: string) => void }) {
  const data = useData();
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<InstrumentType>('etf');
  const [indexId, setIndexId] = useState('');
  const [leverage, setLeverage] = useState('1');
  const [multiplier, setMultiplier] = useState('1');
  const [currency, setCurrency] = useState('USD');
  const [quoteSource, setQuoteSource] = useState<QuoteSource>('manual');
  const [quoteSymbol, setQuoteSymbol] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const create = () => {
    const { instrument, errors: problems } = customInstrument(data, {
      symbol,
      name,
      type,
      indexId: indexId || undefined,
      leverage: Number(leverage),
      multiplier: Number(multiplier),
      currency,
      quoteSource,
      quoteSymbol,
    });
    if (!instrument) return setErrors(problems);
    setTable('instruments', [...data.instruments, instrument]);
    props.onCreated(instrument.id);
  };

  const indices = [...data.indices].sort(
    (a, b) => MARKETS.indexOf(a.market) - MARKETS.indexOf(b.market),
  );

  return (
    <>
      <h2 style={{ margin: '0 0 8px' }}>自訂商品</h2>
      {errors.length > 0 && (
        <div className="notice warn">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      <div className="form-grid">
        <Field label="代號">
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        </Field>
        <Field label="名稱">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="類型">
          <select value={type} onChange={(e) => setType(e.target.value as InstrumentType)}>
            {(['etf', 'stock', 'future', 'perpetual', 'crypto'] as InstrumentType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="追蹤的指數" hint="決定曝險算在哪個指數">
          <select value={indexId} onChange={(e) => setIndexId(e.target.value)}>
            <option value="">未分類</option>
            {indices.map((i) => (
              <option key={i.id} value={i.id}>
                {MARKET_LABELS[i.market]}｜{i.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="每日槓桿倍數" hint="一般 1；兩倍 2；反向 -1、-2">
          <input
            inputMode="decimal"
            value={leverage}
            onChange={(e) => setLeverage(e.target.value)}
          />
        </Field>
        <Field label="契約乘數" hint="股票、ETF、永續合約填 1；期貨填每點價值">
          <input
            inputMode="decimal"
            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value)}
          />
        </Field>
        <Field label="計價幣別">
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} />
        </Field>
        <Field label="報價來源">
          <select
            value={quoteSource}
            onChange={(e) => setQuoteSource(e.target.value as QuoteSource)}
          >
            {QUOTE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s === 'manual' ? '手動輸入' : s}
              </option>
            ))}
          </select>
        </Field>
        {quoteSource !== 'manual' && (
          <Field
            label="報價代號"
            hint={
              quoteSource === 'yahoo'
                ? 'Yahoo Finance 代號，如 VOO、0050.TW、1306.T'
                : quoteSource === 'taifex'
                  ? '期交所商品代碼，如 TXF'
                  : 'Binance 交易對，如 SPYUSDT'
            }
          >
            <input value={quoteSymbol} onChange={(e) => setQuoteSymbol(e.target.value)} />
          </Field>
        )}
      </div>
      <p className="actions">
        <button className="ghost" onClick={props.onCancel}>
          返回清單
        </button>
        <button className="primary" onClick={create}>
          建立商品並選用
        </button>
      </p>
    </>
  );
}
