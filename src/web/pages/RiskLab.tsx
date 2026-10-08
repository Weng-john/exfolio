import { PageHeader, Planned } from '../components/ui';

export default function RiskLabPage() {
  return (
    <>
      <PageHeader title="Risk Lab" subtitle="Static Stress Test 與 Cash Flow Survival Simulation" />
      <Planned phase="P1-C" items={['靜態壓力測試', '現金流生存模擬', '追繳與保證金缺口']} />
    </>
  );
}
