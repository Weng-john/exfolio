import type { AccountType, PriceStatus, TxType } from '@core/index';

export const TX_LABELS: Record<TxType, string> = {
  buy: '買進',
  sell: '賣出',
  deposit: '入金',
  withdraw: '出金',
  transfer: '轉帳',
  dividend: '股息',
  fee: '費用',
  interest: '利息',
  loan_draw: '貸款撥款',
  loan_repay: '貸款還款',
  funding_fee: '資金費率',
  adjust: '餘額調整',
};

/** One-line cash / accounting effect of each type, shown under the type picker. */
export const TX_HINTS: Record<TxType, string> = {
  buy: '現金減少「數量 × 價格 + 手續費 + 稅」（期貨只結算損益，不動用本金）。幣別為商品幣別，不需填金額。',
  sell: '現金增加「數量 × 價格 − 手續費 − 稅」，並以 FIFO 計算已實現損益。數量填正數即可。',
  deposit: '外部資金進入：現金增加，累計投入資本增加。',
  withdraw: '資金流出到外部：現金減少，累計投入資本減少。',
  transfer: '內部移動（不是損益）：來源帳戶現金減少，轉入帳戶增加；跨幣別請填轉入幣別與轉入金額。',
  dividend: '現金增加（股息 − 手續費/稅），記入該商品的股息。',
  fee: '現金減少，記為費用。',
  interest: '非貸款的融資成本（如保證金利息）：現金減少，記為資金成本。',
  loan_draw: '借入資金：現金增加，同時增加貸款餘額（負債）。',
  loan_repay:
    '本金降低貸款餘額、利息記為資金成本。資金來源「外部」：現金不動，視為投入資本（NAV 上升）；「投資組合」：從帳戶現金扣款。',
  funding_fee: '永續合約資金費率。正數 = 支付（現金減少），負數 = 收到。',
  adjust: '對帳用的現金調整，可正可負（正數增加現金）。',
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  securities: '證券',
  futures: '期貨',
  crypto: '加密資產',
  bank: '銀行',
};

export const PRICE_STATUS_LABELS: Record<PriceStatus, string> = {
  realtime: '即時',
  delayed: '延遲',
  manual: '手動',
  stale: '過期',
  missing: '無報價',
};

export const PRICE_STATUS_TONES: Record<PriceStatus, 'ok' | 'warn' | 'bad' | 'info'> = {
  realtime: 'ok',
  delayed: 'info',
  manual: 'info',
  stale: 'warn',
  missing: 'bad',
};
