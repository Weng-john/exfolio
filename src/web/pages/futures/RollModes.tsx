import type { Notification } from '@core/index';
import { Badge, Card, Empty } from '../../components/ui';

const LEVEL_TONE = { info: 'info', warn: 'warn', bad: 'bad' } as const;

/** Notification categories that belong on the futures page. */
const FUTURES_CATEGORIES = ['futures-expiry', 'futures-margin'];

export function futuresNotifications(notifications: Notification[]): Notification[] {
  return notifications.filter((n) => FUTURES_CATEGORIES.includes(n.category));
}

export function RollModes({ notifications }: { notifications: Notification[] }) {
  return (
    <Card title="轉倉模式與通知">
      <div className="roll-modes">
        <div>
          <Badge tone="ok">A · 提醒</Badge>
          <p>到期前提醒，由使用者自行在券商交易。</p>
        </div>
        <div>
          <Badge tone="ok">B · 半自動</Badge>
          <p>計算口數與價差，使用者確認後才記錄成交；本頁不送單。</p>
        </div>
        <div>
          <Badge tone="warn">C · 全自動</Badge>
          <p>尚未實作；需要持續運行、具安全控管的交易後端。</p>
        </div>
      </div>
      {!notifications.length ? (
        <Empty>目前沒有期貨到期或保證金通知。</Empty>
      ) : (
        <div className="notification-list">
          {notifications.map((n) => (
            <div key={n.id}>
              <Badge tone={LEVEL_TONE[n.level]}>{n.level}</Badge>
              <span>
                <strong>{n.title}</strong> · {n.detail}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
