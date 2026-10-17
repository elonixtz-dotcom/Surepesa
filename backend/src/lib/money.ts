/**
 * Money helpers. Amounts are always integers in minor units (bigint) inside the system.
 * Decimal strings only exist at the API boundary.
 */

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

/** "1500.5" with 2 minor units -> 150050n. Rejects negatives, exponents and excess precision. */
export function toMinorUnits(amount: string, minorUnits: number): bigint {
  const match = DECIMAL_RE.exec(amount.trim());
  if (!match) throw new RangeError(`Invalid amount: "${amount}"`);
  const whole = match[1]!;
  const frac = match[2] ?? '';
  if (frac.length > minorUnits) {
    throw new RangeError(`Amount "${amount}" has more than ${minorUnits} decimal places`);
  }
  return BigInt(whole + frac.padEnd(minorUnits, '0'));
}

/** 150050n with 2 minor units -> "1500.50". */
export function fromMinorUnits(minor: bigint, minorUnits: number): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(minorUnits + 1, '0');
  const whole = digits.slice(0, digits.length - minorUnits);
  const frac = digits.slice(digits.length - minorUnits);
  return `${negative ? '-' : ''}${whole}${minorUnits > 0 ? `.${frac}` : ''}`;
}

/** 150050n, "TZS", 2 -> "TZS 1,500.50" */
export function formatMoney(minor: bigint, currency: string, minorUnits: number): string {
  const [whole, frac] = fromMinorUnits(minor, minorUnits).split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${grouped}${frac !== undefined ? `.${frac}` : ''}`;
}

/** Percentage fee in basis points, rounded half-up to the nearest minor unit. */
export function basisPoints(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps) + 5_000n) / 10_000n;
}
