import { useState } from 'react';
import { PageHeader } from '../components/ui';
import { SegmentedControl } from '../components/Primitives';
import PositionsTab from './accounts/PositionsTab';
import CashTab from './accounts/CashTab';
import TransactionsTab from './accounts/TransactionsTab';
import StructureTab from './accounts/StructureTab';
import './accounts/accounts.css';

const TABS = [
  { id: 'positions', label: '持倉', view: PositionsTab },
  { id: 'cash', label: '現金', view: CashTab },
  { id: 'transactions', label: '交易', view: TransactionsTab },
  { id: 'structure', label: '帳戶與機構', view: StructureTab },
] as const;

export default function AccountsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('positions');
  const View = TABS.find((t) => t.id === tab)!.view;
  return (
    <>
      <PageHeader title="Accounts & Positions" subtitle="跨券商帳戶、持倉、交易、現金與匯率" />
      <SegmentedControl label="帳務檢視" items={TABS} value={tab} onChange={setTab}>
        <View />
      </SegmentedControl>
    </>
  );
}
