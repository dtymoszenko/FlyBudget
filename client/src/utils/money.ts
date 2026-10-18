// Exact money math for amounts in minor units (cents, yen, fils) and exchange rates.
// The same file is at client/src/utils/money.ts and server/src/utils/money.ts: keep them
// identical (currencies.test.ts checks). No imports, so it works in both.
//
// Rates are fractions of BigInts, never floats: 1.0812 is 10812/10000, so converting,
// inverting and going through a third currency never loses a digit before the one rounding.

/** An exchange rate: one unit of the base currency is `num / den` units of the quote currency */
export interface Rate {
  num: bigint;
  den: bigint;
}

const RATE_RE = /^(\d{1,12})(?:\.(\d{1,12}))?$/;

/** A rate from its decimal text ("1.0812"), or null if it isn't a positive decimal */
export function parseRate(text: string): Rate | null {
  const m = RATE_RE.exec(text.trim());
  if (!m) return null;
  const frac = m[2] ?? '';
  const num = BigInt(m[1] + frac);
  if (num === 0n) return null;
  return reduce({ num, den: 10n ** BigInt(frac.length) });
}

const gcd = (a: bigint, b: bigint): bigint => {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
};

function reduce(rate: Rate): Rate {
  const d = gcd(rate.num, rate.den);
  return { num: rate.num / d, den: rate.den / d };
}

export const ONE: Rate = { num: 1n, den: 1n };

/** The rate the other way round: USD→EUR from EUR→USD */
export const invertRate = (rate: Rate): Rate => ({ num: rate.den, den: rate.num });

/** Two rates one after the other: (A→B) then (B→C) is A→C */
export const chainRates = (a: Rate, b: Rate): Rate =>
  reduce({ num: a.num * b.num, den: a.den * b.den });

/** n / d rounded to the nearest integer, halves away from zero (d > 0) */
function divRound(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  if (2n * (r < 0n ? -r : r) >= d) return n < 0n ? q - 1n : q + 1n;
  return q;
}

/**
 * An amount converted to another currency: `amount` in minor units of a currency with
 * `fromMinor` decimals, to minor units of one with `toMinor` decimals. Rounded once, halves
 * away from zero, so -x converts to exactly minus what x does.
 */
export function convertMinor(
  amount: number,
  fromMinor: number,
  toMinor: number,
  rate: Rate,
): number {
  const n = BigInt(amount) * rate.num * 10n ** BigInt(toMinor);
  const d = rate.den * 10n ** BigInt(fromMinor);
  const result = Number(divRound(n, d));
  if (!Number.isSafeInteger(result)) throw new RangeError('Converted amount is out of range');
  return result;
}

/**
 * The rate two amounts imply (both in minor units): what was sent and what arrived in a
 * transfer. Null when either is zero.
 */
export function impliedRate(
  from: number,
  fromMinor: number,
  to: number,
  toMinor: number,
): Rate | null {
  if (from === 0 || to === 0) return null;
  const num = BigInt(Math.abs(to)) * 10n ** BigInt(fromMinor);
  const den = BigInt(Math.abs(from)) * 10n ** BigInt(toMinor);
  return reduce({ num, den });
}

/** A rate as decimal text, with at most `digits` decimals ("1.0812") */
export function formatRate(rate: Rate, digits = 6): string {
  const scaled = divRound(rate.num * 10n ** BigInt(digits), rate.den);
  const s = scaled.toString().padStart(digits + 1, '0');
  const whole = s.slice(0, s.length - digits);
  const frac = s.slice(s.length - digits).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d*))?$/;

/**
 * Minor units from a decimal amount as banks send it ("-12.34", "1500", "0.125"), exact.
 * Digits past the currency's decimals round halves away from zero. Null if it isn't a
 * decimal or doesn't fit in a safe integer.
 */
export function decimalToMinor(text: string, minor: number): number | null {
  const m = DECIMAL_RE.exec(text.trim());
  if (!m) return null;
  const frac = m[3] ?? '';
  const kept = BigInt(m[2] + frac.slice(0, minor).padEnd(minor, '0'));
  const rounded = Number(frac[minor] ?? '0') >= 5 ? kept + 1n : kept;
  const value = Number(rounded);
  if (!Number.isSafeInteger(value)) return null;
  return m[1] && value !== 0 ? -value : value;
}

/** A minor-units amount as plain decimal text: 1234 with 2 decimals is "12.34", with 0 "1234" */
export function minorToDecimal(amount: number, minor: number): string {
  const abs = Math.abs(amount)
    .toString()
    .padStart(minor + 1, '0');
  const whole = abs.slice(0, abs.length - minor);
  const frac = abs.slice(abs.length - minor);
  return `${amount < 0 ? '-' : ''}${whole}${minor > 0 ? `.${frac}` : ''}`;
}

/**
 * `total` split in proportion to `weights` (signed, like split parts), adding up to exactly
 * `total`: each part is rounded down and the leftover units go to the largest remainders.
 * For the main-currency value of a transaction's split parts. Weights adding up to zero
 * split it evenly.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  let w = weights.map((x) => BigInt(x));
  let sum = w.reduce((a, b) => a + b, 0n);
  if (sum === 0n) {
    w = w.map(() => 1n);
    sum = BigInt(w.length);
  }
  const t = BigInt(total);
  if (sum < 0n) {
    w = w.map((x) => -x);
    sum = -sum;
  }
  const floorDiv = (n: bigint, d: bigint) => {
    const q = n / d;
    return n % d !== 0n && n < 0n ? q - 1n : q;
  };
  const shares = w.map((x) => floorDiv(t * x, sum));
  let left = t - shares.reduce((a, b) => a + b, 0n);
  const order = w
    .map((x, i) => ({ i, rem: t * x - shares[i] * sum }))
    .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  for (const { i } of order) {
    if (left <= 0n) break;
    shares[i] += 1n;
    left -= 1n;
  }
  return shares.map((s) => Number(s));
}
