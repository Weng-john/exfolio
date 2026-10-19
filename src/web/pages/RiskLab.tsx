import { useState } from 'react';
import { PageHeader } from '../components/ui';
import { SegmentedControl } from '../components/Primitives';
import SurvivalTab from './risk/SurvivalTab';
import StressTab from './risk/StressTab';
import './risk/risk.css';

const TABS = [
  { id: 'stress', label: '靜態壓力測試', view: StressTab },
  { id: 'survival', label: '現金流生存模擬', view: SurvivalTab },
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
      <SegmentedControl label="模擬類型" items={TABS} value={tab} onChange={setTab}>
        <View />
      </SegmentedControl>
    </>
  );
}
