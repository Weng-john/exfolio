import { PageHeader, Planned } from '../components/ui';

export default function FuturesPage() {
  return (
    <>
      <PageHeader title="Futures & Rollover" subtitle="合約、轉倉紀錄、保證金與到期提醒" />
      <Planned phase="P1-C" items={['期貨部位與名目曝險', '保證金占用與到期日', '轉倉紀錄與提醒']} />
    </>
  );
}
