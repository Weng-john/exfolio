import { PageHeader, Planned } from '../components/ui';

export default function NewMoneyPage() {
  return (
    <>
      <PageHeader title="New Money Allocator" subtitle="輸入新資金來源與金額，產生可執行的配置方案" />
      <Planned phase="P0-C" items={['新資金來源與金額', '交易後 NAV 與目標缺口', '交易建議清單']} />
    </>
  );
}
