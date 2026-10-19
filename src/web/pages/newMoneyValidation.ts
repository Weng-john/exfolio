/** Parse a numeric field without silently accepting a prefix or Infinity. */
export function parseFiniteAmount(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Parse the funding amount without silently accepting a negative value. */
export function parseNonNegativeAmount(raw: string): number | undefined {
  const value = parseFiniteAmount(raw);
  return value !== undefined && value >= 0 ? value : undefined;
}
