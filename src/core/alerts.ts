import type { Valuation } from './valuation';
import { getSettings, type AppData } from './types';

export type AlertLevel = 'info' | 'warn' | 'bad';

export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
  detail: string;
}

/**
 * Portfolio-level alerts. They inform only: no threshold here blocks a
 * trade or caps leverage.
 */
export function portfolioAlerts(data: AppData, v: Valuation): Alert[] {
  const { alerts: t } = getSettings(data);
  const alerts: Alert[] = [];
  const x = (n: number) => `${n.toFixed(2)}×`;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  if (v.nav <= 0 && (v.positions.length > 0 || v.cash.length > 0)) {
    alerts.push({
      id: 'nav',
      level: 'bad',
      title: 'NAV 不為正',
      detail: '負債已超過資產，槓桿與權重比率無法計算。',
    });
  }
  if (
    t.grossLeverage !== undefined &&
    v.grossLeverage !== undefined &&
    v.grossLeverage > t.grossLeverage
  ) {
    alerts.push({
      id: 'gross-leverage',
      level: 'warn',
      title: 'Gross 槓桿高於提醒門檻',
      detail: `目前 ${x(v.grossLeverage)}，門檻 ${x(t.grossLeverage)}。`,
    });
  }
  if (t.debtToNav !== undefined && v.debtToNav !== undefined && v.debtToNav > t.debtToNav) {
    alerts.push({
      id: 'debt-to-nav',
      level: 'warn',
      title: '負債 / NAV 高於提醒門檻',
      detail: `目前 ${pct(v.debtToNav)}，門檻 ${pct(t.debtToNav)}。`,
    });
  }

  const overdrawn = v.cash.filter((c) => c.value < 0);
  if (overdrawn.length) {
    alerts.push({
      id: 'overdrawn',
      level: 'warn',
      title: '有帳戶現金為負',
      detail: `${overdrawn.length} 個帳戶幣別餘額為負，已計入負債。請確認是否漏記入金或借款。`,
    });
  }

  const held = v.positions.filter((p) => p.quantity !== 0);
  const missing = held.filter((p) => p.priceStatus === 'missing');
  if (missing.length) {
    alerts.push({
      id: 'missing-price',
      level: 'bad',
      title: '持倉缺少報價',
      detail: `${[...new Set(missing.map((p) => p.instrument.symbol))].join('、')} 以成本價估值，NAV 與曝險可能失真。`,
    });
  }
  const stale = held.filter((p) => p.priceStatus === 'stale');
  if (stale.length) {
    alerts.push({
      id: 'stale-price',
      level: 'warn',
      title: '報價已過期',
      detail: `${[...new Set(stale.map((p) => p.instrument.symbol))].join('、')} 的報價超過 ${t.staleQuoteMinutes} 分鐘未更新。`,
    });
  }
  const noFx = v.warnings.filter((w) => w.includes('匯率'));
  if (noFx.length) {
    alerts.push({ id: 'missing-fx', level: 'bad', title: '缺少匯率', detail: noFx.join('；') });
  }
  return alerts;
}
