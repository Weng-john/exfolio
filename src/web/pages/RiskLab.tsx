import { useState } from 'react';
import { PageHeader } from '../components/ui';
import SurvivalTab from './risk/SurvivalTab';
import StressTab from './risk/StressTab';
import './risk/risk.css';

const TABS = [
  { id: 'stress', label: 'Static Stress Test', view: StressTab },
  { id: 'survival', label: 'Cash Flow Survival', view: SurvivalTab },
] as const;

export default function RiskLabPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('stress');
  const View = TABS.find((t) => t.id === tab)!.view;
  return (
    <>
      <PageHeader title="Risk Lab" subtitle="Static Stress Test 與 Cash Flow Survival Simulation" />
      <div className="notice risk-disclaimer">
        以下結果是模擬，僅供資訊與提醒；系統不會限制任何操作，也沒有強制的槓桿上限。
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <View />
    </>
  );
}
