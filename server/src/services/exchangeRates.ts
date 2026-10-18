// Finding the exchange rate for a day: pure, so the same lookup runs on any device and in
// tests. The database side (loading rows, fetching ECB rates) is in currencyService.ts and
// rateFetchService.ts.
import { ONE, chainRates, invertRate, parseRate, type Rate } from '../utils/money.js';

export type RateSource = 'ecb' | 'manual';

/** One stored rate: on `date`, one `base` was `rate` `quote` */
export interface StoredRate {
  date: string;
  base: string;
  quote: string;
  rate: string;
  source: RateSource | string;
}

/** A rate found for a day, and where it came from */
export interface FoundRate {
  rate: Rate;
  /** The day of the rate used: the asked day or the closest earlier one */
  date: string;
  source: string;
  /** How it was found: the pair itself, its inverse, or through euro rates */
  via: 'same' | 'direct' | 'inverse' | 'eur';
}

/** Rates older than this aren't used: a missing rate is shown, never an old guess */
export const RATE_MAX_AGE_DAYS = 31;

/** The currency ECB reference rates are quoted against */
export const ECB_BASE = 'EUR';

interface Entry {
  date: string;
  rate: Rate;
  source: string;
}

const dayNumber = (iso: string) =>
  Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

export interface RateBook {
  /** The rate from one currency to another on a day (or the closest earlier day), or null */
  find(from: string, to: string, date: string): FoundRate | null;
}

/**
 * An index over stored rates for quick lookups (net worth asks for one per account per
 * month). For each pair it keeps one rate per day: a manual one over the ECB's.
 */
export function buildRateBook(rows: StoredRate[], maxAgeDays = RATE_MAX_AGE_DAYS): RateBook {
  const pairs = new Map<string, Entry[]>();
  for (const row of rows) {
    const rate = parseRate(row.rate);
    if (!rate || row.base === row.quote) continue;
    const key = `${row.base}:${row.quote}`;
    let list = pairs.get(key);
    if (!list) pairs.set(key, (list = []));
    list.push({ date: row.date, rate, source: row.source });
  }
  for (const [key, list] of pairs) {
    list.sort((a, b) =>
      a.date !== b.date
        ? a.date < b.date
          ? -1
          : 1
        : (a.source === 'manual' ? 1 : 0) - (b.source === 'manual' ? 1 : 0),
    );
    // One per day, the last of each day (manual sorts after the ECB's)
    const daily: Entry[] = [];
    for (const e of list) {
      if (daily.length && daily[daily.length - 1].date === e.date) daily[daily.length - 1] = e;
      else daily.push(e);
    }
    pairs.set(key, daily);
  }

  /** The latest entry for a pair on or before the day, within the age limit */
  const latest = (base: string, quote: string, date: string): Entry | null => {
    const list = pairs.get(`${base}:${quote}`);
    if (!list) return null;
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].date <= date) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found === -1) return null;
    const entry = list[found];
    return dayNumber(date) - dayNumber(entry.date) > maxAgeDays ? null : entry;
  };

  /** Either way round: the pair's own rate or its inverse, the newest (the pair's own on a tie) */
  const either = (from: string, to: string, date: string): FoundRate | null => {
    const direct = latest(from, to, date);
    const inverse = latest(to, from, date);
    if (direct && (!inverse || direct.date >= inverse.date)) {
      return { rate: direct.rate, date: direct.date, source: direct.source, via: 'direct' };
    }
    if (inverse) {
      return {
        rate: invertRate(inverse.rate),
        date: inverse.date,
        source: inverse.source,
        via: 'inverse',
      };
    }
    return null;
  };

  return {
    find(from, to, date) {
      if (from === to) return { rate: ONE, date, source: 'same', via: 'same' };
      const own = either(from, to, date);
      if (from === ECB_BASE || to === ECB_BASE) return own;
      // Through the euro: from→EUR→to, as old as its older half
      const a = either(from, ECB_BASE, date);
      const b = a && either(ECB_BASE, to, date);
      const through: FoundRate | null =
        a && b
          ? {
              rate: chainRates(a.rate, b.rate),
              date: a.date < b.date ? a.date : b.date,
              source: a.source === 'manual' || b.source === 'manual' ? 'manual' : a.source,
              via: 'eur',
            }
          : null;
      if (own && (!through || own.date >= through.date)) return own;
      return through;
    },
  };
}
