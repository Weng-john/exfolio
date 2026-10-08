import { PageHeader, Planned } from '../components/ui';

export default function PerformancePage() {
  return (
    <>
      <PageHeader title="Performance Analytics" subtitle="部位、策略、主被動與整體的 TWR、XIRR 與基準比較" />
      <Planned phase="P1-B" items={['TWR 與年化 TWR', 'MWR / XIRR', '基準與超額報酬', '主被動四層級比較']} />
    </>
  );
}
