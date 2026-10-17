// Finds transfers hiding among ordinary transactions: the same amount leaving one account and
// arriving in another a few days apart (a credit card payment imported from both the checking
// account and the card, a move to savings). Pure: rows in, pairs out, no database or clock.

/** How far apart the two sides of a transfer may be dated (banks post them a few days apart) */
export const TRANSFER_MATCH_DAYS = 5;

const DAY_MS = 86_400_000;

export interface TransferCandidate {
  id: string;
  accountId: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** Integer cents: negative leaves the account, positive arrives */
  amount: number;
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

/** Whether these two could be the two sides of one transfer */
export function couldBeTransfer(
  a: TransferCandidate,
  b: TransferCandidate,
  maxDays = TRANSFER_MATCH_DAYS,
): boolean {
  return (
    a.amount !== 0 &&
    a.amount === -b.amount &&
    a.accountId !== b.accountId &&
    dayGap(a.date, b.date) <= maxDays
  );
}

function compareEdges(
  a: TransferMatch & { outDate: string },
  b: TransferMatch & { outDate: string },
): number {
  return (
    a.days - b.days ||
    a.outDate.localeCompare(b.outDate) ||
    a.outflowId.localeCompare(b.outflowId) ||
    a.inflowId.localeCompare(b.inflowId)
  );
}

/**
 * Pairs each outflow with an inflow of the same amount in another account, at most `maxDays`
 * apart. Every transaction is in at most one pair; closer dates win, and ties are broken by
 * date and id, so the result doesn't depend on the order of `candidates`. Pairs whose
 * `pairKey` is in `dismissed` are never suggested.
 */
export function findTransferMatches(
  candidates: readonly TransferCandidate[],
  dismissed: ReadonlySet<string> = new Set(),
  maxDays = TRANSFER_MATCH_DAYS,
): TransferMatch[] {
  // Inflows by amount, sorted by day, so each outflow only looks at the days around it
  const inflowsByAmount = new Map<number, { tx: TransferCandidate; day: number }[]>();
  for (const tx of candidates) {
    if (tx.amount <= 0) continue;
    const list = inflowsByAmount.get(tx.amount) ?? [];
    list.push({ tx, day: dayNumber(tx.date) });
    inflowsByAmount.set(tx.amount, list);
  }
  for (const list of inflowsByAmount.values()) list.sort((a, b) => a.day - b.day);

  const edges: (TransferMatch & { outDate: string })[] = [];
  for (const out of candidates) {
    if (out.amount >= 0) continue;
    const inflows = inflowsByAmount.get(-out.amount);
    if (!inflows) continue;
    const day = dayNumber(out.date);
    let lo = 0;
    let hi = inflows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (inflows[mid].day < day - maxDays) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < inflows.length && inflows[i].day <= day + maxDays; i++) {
      const inflow = inflows[i].tx;
      if (inflow.accountId === out.accountId) continue;
      if (dismissed.has(pairKey(out.id, inflow.id))) continue;
      edges.push({
        outflowId: out.id,
        inflowId: inflow.id,
        days: Math.abs(inflows[i].day - day),
        outDate: out.date,
      });
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
  for (const c of candidates) {
    if (c.id === tx.id || !couldBeTransfer(tx, c, maxDays)) continue;
    if (dismissed.has(pairKey(tx.id, c.id))) continue;
    const gap = dayGap(tx.date, c.date);
    const better =
      gap < bestGap ||
      (gap === bestGap &&
        best !== null &&
        (c.date.localeCompare(best.date) || c.id.localeCompare(best.id)) < 0);
    if (better) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}
