import type { Transaction } from '@core/index';
import { Badge } from './ui';

export const FUNDING_ESTIMATE_TAGS = [
  'funding-date-inferred',
  'funding-amount-inferred',
  'funding-fx-estimated',
];

export function FundingNotice({ transactions }: { transactions: Transaction[] }) {
  const estimates = transactions.filter(
    (tx) =>
      (tx.type === 'deposit' || tx.type === 'withdraw') &&
      FUNDING_ESTIMATE_TAGS.some((tag) => tx.tags?.includes(tag)),
  );
  if (!estimates.length) return null;
  return (
    <div className="notice warn" role="status">
      有 {estimates.length} 筆外部資金流包含日期、金額或匯率估計，累積投入、損益與 TWR／XIRR
      也會受影響。可在交易頁依銀行流水修正，並標記為已核對。
      {estimates.some((tx) => tx.tags?.includes('funding-fx-estimated')) &&
        ' 部分非本位幣投入使用目前匯率暫估，尚未取得實際入金匯率。'}
    </div>
  );
}

export function FundingBadges({ transaction: tx }: { transaction: Transaction }) {
  if (tx.type !== 'deposit' && tx.type !== 'withdraw') return null;
  const date = tx.tags?.includes('funding-date-inferred');
  const amount = tx.tags?.includes('funding-amount-inferred');
  const fx = tx.tags?.includes('funding-fx-estimated');
  if (!date && !amount && !fx) return null;
  return (
    <div>
      {(date || amount) && (
        <Badge tone="warn">
          {date && amount ? '日期／金額推估' : date ? '日期推估' : '金額推估'}
        </Badge>
      )}
      {fx && <Badge tone="warn">匯率暫估</Badge>}
    </div>
  );
}
