import { PageHeader, Planned } from '../components/ui';

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings & Integrations" subtitle="商品登錄、報價來源、CSV / API 同步、通知與安全設定" />
      <Planned phase="P0-A" items={['商品登錄（Instrument Registry）', '報價來源與匯率', '後端連線與資料備份']} />
    </>
  );
}
