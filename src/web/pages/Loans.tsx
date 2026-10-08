import { PageHeader, Planned } from '../components/ui';

export default function LoansPage() {
  return (
    <>
      <PageHeader title="Loans & Collateral" subtitle="信貸、質押、利息、還款與維持率" />
      <Planned phase="P0-C" items={['信貸與攤還表', '質押擔保品與維持率', '還款資金來源']} />
    </>
  );
}
