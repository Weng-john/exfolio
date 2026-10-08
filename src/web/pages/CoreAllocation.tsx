import { PageHeader, Planned } from '../components/ui';

export default function CoreAllocationPage() {
  return (
    <>
      <PageHeader title="Core Allocation" subtitle="市場 → 指數 → 工具的目標與實際曝險、偏差與再平衡建議" />
      <Planned phase="P0-C" items={['各指數目標曝險（以 NAV 為分母）', '實際曝險與偏差', '再平衡建議']} />
    </>
  );
}
