import type { Instrument } from '@core/index';
import { Accordion } from '../../components/Primitives';
import { Badge, Card, Empty } from '../../components/ui';
import { upsertRow } from '../../store';
import { addOneMonth, optionalNumber, type FuturesSeries } from './shared';

type EditableField = 'expiry' | 'initialMargin' | 'maintenanceMargin';

interface Props {
  series: FuturesSeries[];
  /** Series with an open position: shown first, the rest folded away. */
  heldSeries: Set<string>;
  /** Every instrument, used to keep generated ids unique. */
  instruments: Instrument[];
  day: string;
}

function editInstrument(instrument: Instrument, field: EditableField, value: string) {
  const parsed = field === 'expiry' ? value || undefined : optionalNumber(value);
  upsertRow('instruments', { ...instrument, [field]: parsed });
}

/** A series is known by its contract's name, not its internal id. */
const seriesName = (group: FuturesSeries) => {
  const first = group.instruments[0];
  return first
    ? `${first.name.replace(/\s+\d{4}-\d{2}$/, '')}（${first.symbol.replace(/-\d{6}$/, '')}）`
    : group.seriesId;
};

export function ContractMonths({ series, heldSeries, instruments, day }: Props) {
  /** Clone the series' first contract as the month after its latest expiry. */
  const addNextContract = (group: FuturesSeries) => {
    const template = group.instruments[0];
    if (!template) return;
    const latestExpiry = [...group.instruments].reverse().find((i) => i.expiry)?.expiry;
    const nextExpiry = addOneMonth(latestExpiry ?? day);
    const nextMonth = nextExpiry.slice(0, 7); // YYYY-MM
    let id = `${group.seriesId}_${nextMonth.replace('-', '')}`;
    if (instruments.some((i) => i.id === id)) id = `${id}_${instruments.length}`;
    upsertRow('instruments', {
      ...template,
      id,
      symbol: `${template.symbol}-${nextMonth.replace('-', '')}`,
      name: `${template.name} ${nextMonth}`,
      seriesId: group.seriesId,
      expiry: nextExpiry,
      active: true,
    });
  };

  const section = (group: FuturesSeries) => (
    <div className="contract-series" key={group.seriesId}>
      <div className="card-head">
        <h3>{seriesName(group)}</h3>
        <button onClick={() => addNextContract(group)}>新增下個月份</button>
      </div>
      <div
        className="table-wrap"
        role="region"
        aria-label={`${seriesName(group)} 合約月份（可左右捲動）`}
        tabIndex={0}
      >
        <table className="futures-table">
          <thead>
            <tr>
              <th>商品</th>
              <th>到期日</th>
              <th>原始保證金</th>
              <th>維持保證金</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {group.instruments.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.symbol}
                  {i.expiry && <span className="muted futures-sub">{i.expiry.slice(0, 7)}</span>}
                </td>
                <td>
                  <input
                    type="date"
                    aria-label={`${i.symbol} 到期日`}
                    value={i.expiry ?? ''}
                    onChange={(e) => editInstrument(i, 'expiry', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    aria-label={`${i.symbol} 原始保證金`}
                    value={i.initialMargin ?? ''}
                    onChange={(e) => editInstrument(i, 'initialMargin', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    aria-label={`${i.symbol} 維持保證金`}
                    value={i.maintenanceMargin ?? ''}
                    onChange={(e) => editInstrument(i, 'maintenanceMargin', e.target.value)}
                  />
                </td>
                <td>
                  {i.initialMargin === undefined || i.maintenanceMargin === undefined ? (
                    <Badge tone="warn">缺規格</Badge>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  const held = series.filter((g) => heldSeries.has(g.seriesId));
  const others = series.filter((g) => !heldSeries.has(g.seriesId));

  return (
    <Card title="合約月份管理">
      {!series.length ? (
        <Empty>尚未建立期貨系列。</Empty>
      ) : (
        <>
          {held.map(section)}
          {held.length === 0 && <p className="muted">目前沒有持有中的期貨系列。</p>}
          {others.length > 0 && (
            <Accordion
              title={`其他系列（${others.length}）`}
              open={held.length === 0 && others.length <= 2}
            >
              {others.map(section)}
            </Accordion>
          )}
        </>
      )}
    </Card>
  );
}
