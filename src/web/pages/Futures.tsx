import { useMemo, useState } from 'react';
import {
  buildNotifications,
  futuresPositions,
  marginByAccount,
  seriesHistory,
  today as currentDay,
  type FuturesPosition,
} from '@core/index';
import { PageHeader, Stat } from '../components/ui';
import { fmtMoney, fmtPct } from '../format';
import { useData } from '../store';
import { usePortfolio } from '../usePortfolio';
import { ContractMonths } from './futures/ContractMonths';
import { MarginTable } from './futures/MarginTable';
import { PositionsTable } from './futures/PositionsTable';
import { futuresNotifications, RollModes } from './futures/RollModes';
import { RolloverHistory } from './futures/RolloverHistory';
import { RolloverPlanner } from './futures/RolloverPlanner';
import { groupBySeries } from './futures/shared';
import './futures/futures.css';

export default function FuturesPage() {
  const data = useData();
  const portfolio = usePortfolio();
  const day = currentDay();
  const { nav, baseCurrency: base } = portfolio.valuation;

  const positions = useMemo(() => futuresPositions(data, portfolio, day), [data, portfolio, day]);
  const margins = useMemo(() => marginByAccount(data, portfolio), [data, portfolio]);
  const notifications = useMemo(
    () => buildNotifications(data, portfolio, day),
    [data, portfolio, day],
  );
  const series = useMemo(() => groupBySeries(data.instruments), [data.instruments]);

  const [selectedKey, setSelectedKey] = useState<string>();
  // Bumped on every pick so the planner starts fresh, even if the same row is clicked again.
  const [pickCount, setPickCount] = useState(0);
  const [error, setError] = useState<string>();

  const selected = positions.find((p) => p.key === selectedKey) ?? positions[0];
  const selectedSeries = series.find((s) => s.seriesId === selected?.seriesId);
  const targetContracts =
    selectedSeries?.instruments.filter((i) => i.id !== selected?.instrumentId) ?? [];

  const choosePosition = (position: FuturesPosition) => {
    setSelectedKey(position.key);
    setPickCount((n) => n + 1);
    setError(undefined);
  };

  const totalGross = positions.reduce((sum, p) => sum + Math.abs(p.notionalBase), 0);
  const totalNet = positions.reduce((sum, p) => sum + p.notionalBase, 0);
  const futuresExposure = positions.reduce((sum, p) => sum + p.exposure, 0);
  const exposureNav = nav > 0 ? futuresExposure / nav : undefined;
  const nearest = positions.find((p) => p.expiry);
  // One account without a margin spec makes the total unknowable, so show none.
  const specComplete = margins.every((m) => m.initialMarginRequired !== undefined);
  const requiredInitial = specComplete
    ? margins.reduce((sum, m) => sum + (m.initialMarginRequired ?? 0), 0)
    : undefined;
  const accountEquity = margins.reduce((sum, m) => sum + m.equity, 0);

  return (
    <>
      <PageHeader
        title="Futures & Rollover"
        subtitle={`期貨、永續合約、保證金與轉倉；所有金額以 ${base} 計`}
      />

      <div className="stats">
        <Stat
          label="Futures Gross Notional"
          value={fmtMoney(totalGross, base)}
          hint="未乘每日槓桿"
        />
        <Stat
          label="Futures Net Notional"
          value={fmtMoney(totalNet, base)}
          hint="帶符號名目曝險"
          tone={totalNet >= 0 ? 'pos' : 'neg'}
        />
        <Stat label="Exposure / NAV" value={fmtPct(exposureNav)} hint="期貨曝險以 NAV 為分母" />
        <Stat
          label="Initial Margin"
          value={requiredInitial === undefined ? '—' : fmtMoney(requiredInitial, base)}
          hint={
            requiredInitial === undefined
              ? '有合約缺少保證金規格'
              : `帳戶權益 ${fmtMoney(accountEquity, base)}`
          }
        />
        <Stat
          label="最近到期"
          value={nearest?.expiry ?? '—'}
          hint={nearest ? `${nearest.symbol} · ${nearest.daysToExpiry} 天` : undefined}
        />
      </div>

      {error && <div className="notice futures-error">{error}</div>}

      <PositionsTable
        positions={positions}
        accounts={data.accounts}
        strategies={data.strategies}
        base={base}
        selectedKey={selected?.key}
        onSelect={choosePosition}
      />
      <MarginTable margins={margins} />
      <RolloverPlanner
        key={pickCount}
        data={data}
        day={day}
        positions={positions}
        selected={selected}
        targetContracts={targetContracts}
        onSelect={choosePosition}
        onError={setError}
      />
      <ContractMonths series={series} instruments={data.instruments} day={day} />
      <RolloverHistory histories={series.map((s) => seriesHistory(data, s.seriesId))} />
      <RollModes notifications={futuresNotifications(notifications)} />
    </>
  );
}
