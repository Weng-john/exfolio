import type { SeriesHistory } from '@core/index';
import { Card, Empty } from '../../components/ui';
import { fmtMoney, signClass } from '../../format';

export function RolloverHistory({ histories }: { histories: SeriesHistory[] }) {
  const rolled = histories.filter((h) => h.rollovers.length);
  return (
    <Card title="轉倉歷史">
      {!rolled.length ? (
        <Empty>尚未記錄轉倉。</Empty>
      ) : (
        rolled.map((h) => (
          <div className="history-row" key={h.seriesId}>
            <strong>{h.seriesId}</strong>
            <span>
              累積轉倉成本{' '}
              <b className={signClass(h.cumulativeRollCost)}>
                {fmtMoney(h.cumulativeRollCost, h.baseCurrency)}
              </b>
            </span>
            <span>已實現損益 {fmtMoney(h.cumulativeRealizedPnl, h.baseCurrency)}</span>
            <span>費用 {fmtMoney(h.cumulativeFees, h.baseCurrency)}</span>
            <span>{h.rollovers.length} 次</span>
          </div>
        ))
      )}
    </Card>
  );
}
