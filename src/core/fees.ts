import type { Broker, FeeClass, FeeRule, Instrument } from './types';

export interface FeeEstimate {
  /** Commission after discount and minimum, in the instrument currency. */
  fee: number;
  tax: number;
  /** False when the institution has no rule for this instrument class. */
  known: boolean;
}

export function feeClassOf(instrument: Instrument): FeeClass {
  return instrument.type;
}

export function feeRuleFor(broker: Broker | undefined, instrument: Instrument): FeeRule | undefined {
  return broker?.fees?.[feeClassOf(instrument)];
}

/**
 * Estimate commission and tax for one trade from the institution's fee
 * rule. An estimate only: the amount actually charged is what the user
 * records on the transaction.
 */
export function estimateFees(
  broker: Broker | undefined,
  instrument: Instrument,
  side: 'buy' | 'sell',
  quantity: number,
  price: number,
): FeeEstimate {
  const rule = feeRuleFor(broker, instrument);
  if (!rule || !(quantity > 0) || !(price > 0)) return { fee: 0, tax: 0, known: Boolean(rule) };
  const value = quantity * price * instrument.multiplier;
  let commission = value * (rule.rate ?? 0) * (rule.discount ?? 1);
  if (rule.rate && rule.minFee !== undefined) commission = Math.max(commission, rule.minFee);
  const fee = commission + quantity * (rule.perUnit ?? 0);
  const tax = value * ((rule.taxRate ?? 0) + (side === 'sell' ? (rule.sellTaxRate ?? 0) : 0));
  return { fee, tax, known: true };
}

/**
 * Commission as a fraction of traded value for securities at this
 * institution, after discount. Undefined when no rule says.
 */
export function effectiveSecuritiesRate(broker: Broker | undefined): number | undefined {
  const rule = broker?.fees?.etf ?? broker?.fees?.stock;
  return rule?.rate === undefined ? undefined : rule.rate * (rule.discount ?? 1);
}
