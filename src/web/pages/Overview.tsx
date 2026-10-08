import { PageHeader, Planned } from '../components/ui';

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview Dashboard" subtitle="總 NAV、累積投入、損益、曝險、槓桿、負債、可用現金與風險警示" />
      <Planned phase="P0-B" items={['總 NAV、外部累積投入與總損益', 'Gross / Net 曝險與槓桿', '各指數曝險權重', '負債、可用現金與風險警示']} />
    </>
  );
}
