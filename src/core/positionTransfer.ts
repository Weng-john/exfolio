/** Move long security lots between accounts, retaining dates, costs and journal metadata. */
export function transferLots<T extends { date: string; quantity: number }>(
  source: T[],
  destination: T[],
  quantity: number,
): boolean {
  if (
    source === destination ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    source.some((lot) => lot.quantity < 0) ||
    destination.some((lot) => lot.quantity < 0) ||
    source.reduce((sum, lot) => sum + lot.quantity, 0) + 1e-9 < quantity
  )
    return false;
  let remaining = quantity;
  while (remaining > 1e-9 && source.length) {
    const lot = source[0];
    const moved = Math.min(remaining, lot.quantity);
    destination.push({ ...lot, quantity: moved });
    lot.quantity -= moved;
    remaining -= moved;
    if (lot.quantity <= 1e-9) source.shift();
  }
  destination.sort((a, b) => a.date.localeCompare(b.date));
  return true;
}
