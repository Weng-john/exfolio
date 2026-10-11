import { useState } from 'react';
import { PageHeader } from '../components/ui';
import { IS_PUBLIC } from '../edition';
import InstrumentsTab from './settings/InstrumentsTab';
import IndicesTab from './settings/IndicesTab';
import QuotesTab from './settings/QuotesTab';
import AlertsTab from './settings/AlertsTab';
import BackendTab from './settings/BackendTab';
import ExchangeTab from './settings/ExchangeTab';
import './settings/settings.css';

const ALL_TABS = [
  { id: 'instruments', label: '商品登錄', Body: InstrumentsTab },
  { id: 'indices', label: '標的指數', Body: IndicesTab },
  { id: 'quotes', label: '報價與匯率', Body: QuotesTab },
  { id: 'alerts', label: '提醒門檻', Body: AlertsTab },
  { id: 'exchange', label: '交易所同步', Body: ExchangeTab, needsBackend: true },
  { id: 'backend', label: '後端與資料', Body: BackendTab },
] as const;

// Exchange sync keeps API keys on a backend, which the public edition does not have.
const TABS = ALL_TABS.filter((t) => !(IS_PUBLIC && 'needsBackend' in t));

export default function SettingsPage() {
  const [tab, setTab] = useState<(typeof ALL_TABS)[number]['id']>('instruments');
  const Body = TABS.find((t) => t.id === tab)!.Body;
  return (
    <>
      <PageHeader
        title="Settings & Integrations"
        subtitle="商品登錄、報價來源、提醒門檻、交易所唯讀同步、後端連線與資料備份"
      />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Body />
    </>
  );
}
