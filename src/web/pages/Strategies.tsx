import { PageHeader, Planned } from '../components/ui';

export default function StrategiesPage() {
  return (
    <>
      <PageHeader title="Strategy Hub" subtitle="新增與管理自訂主動策略、資金配置與策略列表" />
      <Planned phase="P1-A" items={['Strategy Registry', '策略資金帳本', '輪動週期（rotation cycle）']} />
    </>
  );
}
