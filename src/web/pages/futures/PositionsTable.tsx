import type { Account, FuturesPosition, Strategy } from '@core/index';
import { Badge, Card, Empty } from '../../components/ui';
import { fmtMoney, fmtNum, fmtPct, signClass } from '../../format';

/** Days before expiry at which a contract is flagged. */
const EXPIRY_WARN_DAYS = 7;

type Tone = 'ok' | 'info' | 'warn' | 'bad';

function expiryTone(daysToExpiry: number | undefined): Tone {
  if (daysToExpiry === undefined) return 'info';
  if (daysToExpiry < 0) return 'bad';
  return daysToExpiry <= EXPIRY_WARN_DAYS ? 'warn' : 'info';
}

interface Props {
  positions: FuturesPosition[];
  accounts: Account[];
  strategies: Strategy[];
  base: string;
  selectedKey?: string;
  onSelect: (position: FuturesPosition) => void;
}

export function PositionsTable({
  positions,
  accounts,
  strategies,
  base,
  selectedKey,
  onSelect,
}: Props) {
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  const bucketName = (bucket: string) =>
    bucket === 'core' ? 'Core' : (strategies.find((s) => s.id === bucket)?.name ?? bucket);

  return (
    <Card title="期貨部位">
      {!positions.length ? (
        <Empty>目前沒有未平倉期貨或永續合約。</Empty>
      ) : (
        <div className="table-wrap">
          <table className="futures-table">
            <thead>
              <tr>
                <th>商品 / 帳戶</th>
                <th>Series</th>
                <th className="num">口數</th>
                <th className="num">均價</th>
                <th className="num">現價</th>
                <th>到期</th>
                <th className="num">Notional</th>
                <th className="num">Exposure / NAV</th>
                <th className="num">保證金</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const expiringSoon =
                  p.daysToExpiry !== undefined && p.daysToExpiry <= EXPIRY_WARN_DAYS;
                const priceDoubtful = p.status === 'missing' || p.status === 'stale';
                return (
                  <tr
                    key={p.key}
                    className={`clickable ${selectedKey === p.key ? 'selected' : ''}`}
                    onClick={() => onSelect(p)}
                  >
                    <td>
                      {p.symbol}
                      <span className="muted futures-sub">
                        {accountName(p.accountId)} · {bucketName(p.bucket)}
                      </span>
                    </td>
                    <td>{p.seriesId}</td>
                    <td className={`num ${signClass(p.contracts)}`}>{fmtNum(p.contracts)}</td>
                    <td className="num">{fmtNum(p.averagePrice)}</td>
                    <td className="num">
                      {fmtNum(p.currentPrice)}{' '}
                      <Badge tone={priceDoubtful ? 'warn' : 'ok'}>{p.status}</Badge>
                    </td>
                    <td>
                      {p.expiry ? (
                        <>
                          <span className={expiringSoon ? 'warn' : ''}>{p.expiry}</span>{' '}
                          <Badge tone={expiryTone(p.daysToExpiry)}>
                            {p.daysToExpiry === undefined ? '—' : `${p.daysToExpiry} 天`}
                          </Badge>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={`num ${signClass(p.notionalBase)}`}>
                      {fmtMoney(p.notionalBase, base)}
                    </td>
                    <td className={`num ${signClass(p.exposureNav)}`}>{fmtPct(p.exposureNav)}</td>
                    <td className="num">
                      {p.marginSpecMissing ? (
                        <Badge tone="warn">缺規格</Badge>
                      ) : (
                        fmtMoney(p.initialMarginRequired, p.currency)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted futures-note">
        期貨不計市值；未實現損益進入帳戶權益。Margin 是現金占用，不是名目曝險，也不是負債。
      </p>
    </Card>
  );
}
