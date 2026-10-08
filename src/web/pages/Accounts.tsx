import { PageHeader, Planned } from '../components/ui';

export default function AccountsPage() {
  return (
    <>
      <PageHeader title="Accounts & Positions" subtitle="跨券商帳戶、持倉、交易、現金與匯率" />
      <Planned phase="P0-A" items={['券商與帳戶', '持倉與現金', '交易紀錄與 CSV 匯入']} />
    </>
  );
}
