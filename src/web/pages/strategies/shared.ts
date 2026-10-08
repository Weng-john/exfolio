import type { AppData, StrategyStatus } from '@core/index';

export const STATUS_LABEL: Record<StrategyStatus, string> = {
  active: '進行中',
  paused: '暫停',
  closed: '已結束',
};

export const STATUS_TONE: Record<StrategyStatus, 'ok' | 'warn' | 'info'> = {
  active: 'ok',
  paused: 'warn',
  closed: 'info',
};

export const FLOW_LABEL = {
  external_deposit: '外部入金',
  external_withdrawal: '外部出金',
  transfer_in: '內部撥入',
  transfer_out: '內部撥出',
} as const;

export function bucketName(data: AppData, bucket: string | undefined): string {
  if (!bucket || bucket === 'core') return '核心被動';
  return data.strategies.find((s) => s.id === bucket)?.name ?? bucket;
}

export function symbolOf(data: AppData, instrumentId: string | undefined): string {
  if (!instrumentId) return '';
  return data.instruments.find((i) => i.id === instrumentId)?.symbol ?? instrumentId;
}

export const today = () => new Date().toISOString().slice(0, 10);

export function toNumber(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}
