import { PageHeader, Planned } from '../components/ui';

export default function JournalPage() {
  return (
    <>
      <PageHeader title="Trade Journal" subtitle="每筆交易與多腿交易群組、交易理由、費用與損益" />
      <Planned phase="P1-A" items={['交易日誌與標籤', '多腿交易群組', '勝率、Profit Factor、期望值']} />
    </>
  );
}
