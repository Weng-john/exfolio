import type { Instrument } from '@core/index';
import { Badge, Card, Empty } from '../../components/ui';
import { upsertRow } from '../../store';
import { addOneMonth, optionalNumber, type FuturesSeries } from './shared';

type EditableField = 'expiry' | 'initialMargin' | 'maintenanceMargin';

interface Props {
  series: FuturesSeries[];
  /** Every instrument, used to keep generated ids unique. */
  instruments: Instrument[];
  day: string;
}

function editInstrument(instrument: Instrument, field: EditableField, value: string) {
  const parsed = field === 'expiry' ? value || undefined : optionalNumber(value);
  upsertRow('instruments', { ...instrument, [field]: parsed });
}

export function ContractMonths({ series, instruments, day }: Props) {
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

  return (
    <Card title="合約月份管理">
      {!series.length ? (
        <Empty>尚未建立 futures series。</Empty>
      ) : (
        series.map((group) => (
          <div className="contract-series" key={group.seriesId}>
            <div className="card-head">
              <h2>{group.seriesId}</h2>
              <button onClick={() => addNextContract(group)}>新增下個月份</button>
            </div>
            <div className="table-wrap">
              <table className="futures-table">
                <thead>
                  <tr>
                    <th>商品</th>
                    <th>到期日</th>
                    <th>Initial Margin</th>
                    <th>Maintenance Margin</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {group.instruments.map((i) => (
                    <tr key={i.id}>
                      <td>
                        {i.symbol}
                        <span className="muted futures-sub">{i.id}</span>
                      </td>
                      <td>
                        <input
                          type="date"
                          value={i.expiry ?? ''}
                          onChange={(e) => editInstrument(i, 'expiry', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          value={i.initialMargin ?? ''}
                          onChange={(e) => editInstrument(i, 'initialMargin', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
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
        ))
      )}
    </Card>
  );
}
