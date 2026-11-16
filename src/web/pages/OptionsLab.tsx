import { useState } from 'react';
import type { HeldStrategy } from '@core/index';
import { PageHeader } from '../components/ui';
import { Banner, SegmentedControl, Toast } from '../components/Primitives';
import { GuideTab } from './options/GuideTab';
import { HoldingsTab } from './options/HoldingsTab';
import { DEFAULT_MARKET, legId, type Builder } from './options/model';
import { StrategyBuilder } from './options/StrategyBuilder';
import './options/options.css';

const TABS = [
  { id: 'builder', label: '策略試算' },
  { id: 'holdings', label: '持倉 Greeks' },
  { id: 'guide', label: '模型與名詞' },
] as const;

type Tab = (typeof TABS)[number]['id'];

/** Builder state outlives tab and page switches for the visit, never stored. */
let remembered: Builder = { market: DEFAULT_MARKET, legs: [], elapsed: 0 };

export default function OptionsLabPage() {
  const [tab, setTab] = useState<Tab>('builder');
  const [builder, setBuilderState] = useState<Builder>(remembered);
  const [loaded, setLoaded] = useState<string | undefined>();
  const setBuilder = (b: Builder) => {
    remembered = b;
    setBuilderState(b);
  };

  const load = (s: HeldStrategy, label: string) => {
    const days = Math.max(
      1,
      Math.round(Math.max(...s.legs.map((l) => (l.kind === 'option' ? l.years : 0))) * 365),
    );
    setBuilder({
      market: {
        label,
        spot: String(s.spot),
        vol: String(+(s.vol * 100).toFixed(2)),
        days: String(days),
        rate: '0',
        multiplier: String(s.multiplier),
      },
      legs: s.legs.map((l) =>
        l.kind === 'underlying'
          ? { id: legId(), kind: 'underlying', quantity: l.quantity, strike: 0, price: l.price }
          : {
              id: legId(),
              kind: l.right,
              quantity: l.quantity,
              strike: l.strike,
              price: l.premium,
              days: Math.max(1, Math.round(l.years * 365)),
              vol: l.vol,
            },
      ),
      elapsed: 0,
    });
    setLoaded(`已帶入 ${label} 的持倉，以平均成本為進場價。`);
    setTab('builder');
  };

  return (
    <>
      <PageHeader
        title="選擇權實驗室"
        subtitle="組合多腿策略、看懂到期損益與 Greeks，並以 Delta 衡量持有選擇權的實際曝險"
      />
      <Banner title="模型估算，僅供參考">
        以 Black-Scholes-Merton
        歐式模型計算；美式選擇權可能因提前履約而價值較高。網站不會下單，也不限制任何操作。
      </Banner>
      {loaded && <Toast tone="ok" message={loaded} onDismiss={() => setLoaded(undefined)} />}
      <SegmentedControl label="選擇權檢視" items={TABS} value={tab} onChange={setTab}>
        {tab === 'builder' && <StrategyBuilder builder={builder} onChange={setBuilder} />}
        {tab === 'holdings' && <HoldingsTab onLoad={load} />}
        {tab === 'guide' && <GuideTab />}
      </SegmentedControl>
    </>
  );
}
