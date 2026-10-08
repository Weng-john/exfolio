import { useMemo, useState } from 'react';
import {
  journalEntries,
  replayTrades,
  roundTrips,
  type JournalFilter,
  type RoundTrip,
  type Transaction,
} from '@core/index';
import { Card, Empty, PageHeader } from '../components/ui';
import { fmtMoney, fmtNum, fmtPct, signClass } from '../format';
import { upsertRow, useData } from '../store';
import { usePortfolio } from '../usePortfolio';
import TxForm from './accounts/TxForm';
import JournalTable from './journal/JournalTable';
import StatsPanel from './journal/StatsPanel';
import TradeGroups from './journal/TradeGroups';
import { bucketName, symbolOf } from './strategies/shared';
import './journal/journal.css';

export default function JournalPage() {
  const data = useData();
  const base = usePortfolio().valuation.baseCurrency;
  const [filter, setFilter] = useState<JournalFilter>({ includeCore: false });
  const [adding, setAdding] = useState(false);
  const patch = (p: Partial<JournalFilter>) => setFilter((f) => ({ ...f, ...p }));

  const replay = useMemo(() => replayTrades(data), [data]);
  const entries = useMemo(() => journalEntries(data, filter), [data, filter]);
  const allTags = useMemo(
    () => [...new Set(replay.entries.flatMap((e) => e.tags))].sort(),
    [replay],
  );

  // Round trips and stats follow the same filters as the table.
  const trips: RoundTrip[] = useMemo(() => roundTrips(data, filter), [data, filter]);

  const scopeBuckets = useMemo(() => {
    const ids = [...new Set(replay.entries.map((e) => e.strategyId))].filter(
      (id) => filter.includeCore || id !== 'core',
    );
    return ids.map((id) => ({ id, name: bucketName(data, id) }));
  }, [replay, data, filter.includeCore]);

  const save = (tx: Transaction) => {
    upsertRow('transactions', tx);
    setAdding(false);
  };

  return (
    <>
      <PageHeader
        title="Trade Journal"
        subtitle="每筆交易與多腿交易群組、交易理由、費用與損益"
        actions={
          <button
            className="primary"
            onClick={() => setAdding(true)}
            disabled={!data.accounts.length}
          >
            新增交易
          </button>
        }
      />
      {adding && <TxForm data={data} onSave={save} onClose={() => setAdding(false)} />}
      <div className="jr-stack">
        <Card title={`交易日誌（${entries.length}）`}>
          <p className="jr-note">
            顯示策略內的買賣交易。已實現損益依 FIFO
            計算，與帳本一致，費用另列。新增交易請用右上角按鈕；這裡只編輯理由、標籤、備註、群組與輪動週期。
          </p>
          <div className="jr-filters">
            <select
              value={filter.strategyId ?? ''}
              onChange={(e) => patch({ strategyId: e.target.value || undefined })}
            >
              <option value="">所有策略</option>
              <option value="core">核心被動</option>
              {data.strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={filter.instrumentId ?? ''}
              onChange={(e) => patch({ instrumentId: e.target.value || undefined })}
            >
              <option value="">所有商品</option>
              {data.instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.symbol}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={filter.from ?? ''}
              onChange={(e) => patch({ from: e.target.value || undefined })}
              aria-label="起日"
            />
            <input
              type="date"
              value={filter.to ?? ''}
              onChange={(e) => patch({ to: e.target.value || undefined })}
              aria-label="迄日"
            />
            <select
              value={filter.tag ?? ''}
              onChange={(e) => patch({ tag: e.target.value || undefined })}
            >
              <option value="">所有標籤</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={filter.tradeGroupId ?? ''}
              onChange={(e) => patch({ tradeGroupId: e.target.value || undefined })}
            >
              <option value="">所有群組</option>
              {data.tradeGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={!!filter.includeCore}
                onChange={(e) => patch({ includeCore: e.target.checked })}
              />
              含核心交易
            </label>
          </div>
          <JournalTable data={data} entries={entries} base={base} />
        </Card>

        <Card title="績效統計（已平倉交易，淨額）">
          <p className="jr-note">
            依目前篩選條件，以每筆平倉配對（進場批次對應出場）計算，金額為{base}
            、已扣交易成本。期貨沒有自然的資金分母，只顯示金額，不以名目價值推算報酬率。
          </p>
          {trips.length ? (
            <StatsPanel trips={trips} groups={scopeBuckets} base={base} />
          ) : (
            <Empty>還沒有已平倉的交易</Empty>
          )}
        </Card>

        <Card title={`已平倉交易（${trips.length}）`}>
          {!trips.length ? (
            <Empty>還沒有已平倉的交易</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>策略</th>
                    <th>商品</th>
                    <th>方向</th>
                    <th>進場</th>
                    <th>出場</th>
                    <th className="num">進場價</th>
                    <th className="num">出場價</th>
                    <th className="num">數量</th>
                    <th className="num">天數</th>
                    <th className="num">成本前損益</th>
                    <th className="num">成本</th>
                    <th className="num">成本後損益</th>
                    <th className="num">報酬率</th>
                  </tr>
                </thead>
                <tbody>
                  {[...trips].reverse().map((t) => (
                    <tr key={t.id}>
                      <td>{bucketName(data, t.strategyId)}</td>
                      <td>{symbolOf(data, t.instrumentId)}</td>
                      <td>{t.direction === 'long' ? '多' : '空'}</td>
                      <td>{t.entryDate}</td>
                      <td>{t.exitDate}</td>
                      <td className="num">{fmtNum(t.entryPrice, 4)}</td>
                      <td className="num">{fmtNum(t.exitPrice, 4)}</td>
                      <td className="num">{fmtNum(t.quantity, 4)}</td>
                      <td className="num">{t.holdingDays}</td>
                      <td className={`num ${signClass(t.grossPnl)}`}>
                        {fmtMoney(t.grossPnl, t.currency)}
                      </td>
                      <td className="num">{fmtMoney(t.costs, t.currency)}</td>
                      <td className={`num ${signClass(t.netPnl)}`}>
                        {fmtMoney(t.netPnl, t.currency)}
                      </td>
                      <td className={`num ${signClass(t.returnPct)}`}>
                        {t.returnPct === undefined ? '—' : fmtPct(t.returnPct, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <TradeGroups base={base} />
      </div>
    </>
  );
}
