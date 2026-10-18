// Finds transfers hiding among ordinary transactions: the same amount leaving one account and
// arriving in another a few days apart (a credit card payment imported from both the checking
// account and the card, a move to savings). Pure: rows in, pairs out, no database or clock.

/** How far apart the two sides of a transfer may be dated (banks post them a few days apart) */
export const TRANSFER_MATCH_DAYS = 5;

/**
 * Between two currencies the amounts can't be equal: the sides match when their values in the
 * budget's currency are this close (the bank's rate and fees against the day's ECB rate)
 */
export const CROSS_CURRENCY_TOLERANCE = 0.03;

const DAY_MS = 86_400_000;

export interface TransferCandidate {
  id: string;
  accountId: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** Integer cents: negative leaves the account, positive arrives */
  amount: number;
  /** The account's currency; rows without one are all in the same currency */
  currency?: string | null;
  /** What it's worth in the budget's currency (null while its rate is missing) */
  value?: number | null;
}

export interface TransferMatch {
  outflowId: string;
  inflowId: string;
  /** Days between the two dates */
  days: number;
}

/** The order-independent key of a pair, as stored for dismissed suggestions */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

/** Whole days between two `YYYY-MM-DD` dates */
export function dayGap(a: string, b: string): number {
  return Math.abs(dayNumber(a) - dayNumber(b));
}

const sameCurrency = (a: TransferCandidate, b: TransferCandidate) =>
  (a.currency ?? null) === (b.currency ?? null);

/**
 * How far apart two sides in different currencies are, as a share of the outflow's value
 * (0 = exactly the same value), or null if they can't be compared (a rate is missing, or
 * both go the same way)
 */
export function valueGap(a: TransferCandidate, b: TransferCandidate): number | null {
  if (a.value == null || b.value == null || a.value === 0) return null;
  if (Math.sign(a.value) === Math.sign(b.value) || Math.sign(a.amount) === Math.sign(b.amount)) {
    return null;
  }
  return Math.abs(a.value + b.value) / Math.abs(a.value);
}

/** Whether these two could be the two sides of one transfer */
export function couldBeTransfer(
  a: TransferCandidate,
  b: TransferCandidate,
  maxDays = TRANSFER_MATCH_DAYS,
): boolean {
  if (a.amount === 0 || a.accountId === b.accountId || dayGap(a.date, b.date) > maxDays) {
    return false;
  }
  if (sameCurrency(a, b)) return a.amount === -b.amount;
  const gap = valueGap(a, b);
  return gap !== null && gap <= CROSS_CURRENCY_TOLERANCE;
}

type Edge = TransferMatch & { outDate: string; gap: number };

function compareEdges(a: Edge, b: Edge): number {
  return (
    a.days - b.days ||
    a.gap - b.gap ||
    a.outDate.localeCompare(b.outDate) ||
    a.outflowId.localeCompare(b.outflowId) ||
    a.inflowId.localeCompare(b.inflowId)
  );
}

/**
 * Pairs each outflow with an inflow of the same amount in another account, at most `maxDays`
 * apart (in another currency: the same value, within CROSS_CURRENCY_TOLERANCE). Every
 * transaction is in at most one pair; closer dates win, then closer values, and ties are
 * broken by date and id, so the result doesn't depend on the order of `candidates`. Pairs
 * whose `pairKey` is in `dismissed` are never suggested.
 */
export function findTransferMatches(
  candidates: readonly TransferCandidate[],
  dismissed: ReadonlySet<string> = new Set(),
  maxDays = TRANSFER_MATCH_DAYS,
): TransferMatch[] {
  // Inflows by currency and amount (by currency alone for comparing values across
  // currencies), sorted by day, so each outflow only looks at the days around it
  type Dated = { tx: TransferCandidate; day: number };
  const inflowsByAmount = new Map<string, Dated[]>();
  const inflowsByCurrency = new Map<string, Dated[]>();
  const add = (map: Map<string, Dated[]>, key: string, item: Dated) => {
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  };
  for (const tx of candidates) {
    if (tx.amount <= 0) continue;
    const item = { tx, day: dayNumber(tx.date) };
    add(inflowsByAmount, `${tx.currency ?? ''}|${tx.amount}`, item);
    if (tx.value != null) add(inflowsByCurrency, tx.currency ?? '', item);
  }
  for (const list of [...inflowsByAmount.values(), ...inflowsByCurrency.values()]) {
    list.sort((a, b) => a.day - b.day);
  }

  const edges: Edge[] = [];
  const consider = (out: TransferCandidate, day: number, inflows: Dated[]) => {
    let lo = 0;
    let hi = inflows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (inflows[mid].day < day - maxDays) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < inflows.length && inflows[i].day <= day + maxDays; i++) {
      const inflow = inflows[i].tx;
      if (inflow.accountId === out.accountId || !couldBeTransfer(out, inflow, maxDays)) continue;
      if (dismissed.has(pairKey(out.id, inflow.id))) continue;
      edges.push({
        outflowId: out.id,
        inflowId: inflow.id,
        days: Math.abs(inflows[i].day - day),
        outDate: out.date,
        gap: sameCurrency(out, inflow) ? 0 : valueGap(out, inflow)!,
      });
    }
  };
  for (const out of candidates) {
    if (out.amount >= 0) continue;
    const day = dayNumber(out.date);
    const same = inflowsByAmount.get(`${out.currency ?? ''}|${-out.amount}`);
    if (same) consider(out, day, same);
    if (out.value == null) continue;
    for (const [currency, inflows] of inflowsByCurrency) {
      if (currency !== (out.currency ?? '')) consider(out, day, inflows);
    }
  }

  edges.sort(compareEdges);
  const used = new Set<string>();
  const matches: TransferMatch[] = [];
  for (const { outflowId, inflowId, days } of edges) {
    if (used.has(outflowId) || used.has(inflowId)) continue;
    used.add(outflowId);
    used.add(inflowId);
    matches.push({ outflowId, inflowId, days });
  }
  return matches;
}

/**
 * The best other side for `tx` among `candidates` (closest date, then earliest, then id),
 * or null. Used when the user turns one transaction into a transfer to a chosen account.
 */
export function bestCounterpart(
  tx: TransferCandidate,
  candidates: readonly TransferCandidate[],
  dismissed: ReadonlySet<string> = new Set(),
  maxDays = TRANSFER_MATCH_DAYS,
): TransferCandidate | null {
  let best: TransferCandidate | null = null;
  let bestGap = Infinity;
  let bestValueGap = Infinity;
  for (const c of candidates) {
    if (c.id === tx.id || !couldBeTransfer(tx, c, maxDays)) continue;
    if (dismissed.has(pairKey(tx.id, c.id))) continue;
    const gap = dayGap(tx.date, c.date);
    const value = sameCurrency(tx, c) ? 0 : valueGap(tx, c)!;
    const better =
      gap < bestGap ||
      (gap === bestGap && value < bestValueGap) ||
      (gap === bestGap &&
        value === bestValueGap &&
        best !== null &&
        (c.date.localeCompare(best.date) || c.id.localeCompare(best.id)) < 0);
    if (better) {
      best = c;
      bestGap = gap;
      bestValueGap = value;
    }
  }
  return best;
}
