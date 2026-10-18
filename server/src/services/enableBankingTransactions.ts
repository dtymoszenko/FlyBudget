import { z } from 'zod';
import { isRealDate } from '../utils/validation.js';
import type { AccountType } from '../utils/accountTypes.js';

// Turning Enable Banking (PSD2) account data into FlyBudget transactions. Pure: no database,
// no clock, so the same rules can be tested exhaustively and re-run anywhere.
//
// Bank data is untrusted. Every transaction is validated on its own: one the bank sent
// without a date or with an unreadable amount is skipped and counted, never fatal (a single
// bad record used to stop a whole sync in other apps).
//
// The fields follow ISO 20022 like a CAMT statement (client/src/utils/camt.ts), and are read
// the same way: booking date first, the other party as payee (the creditor for money out,
// the debtor for money in), the remittance lines as notes.

/** Unsigned (or signed) decimal amount, as Enable Banking sends it: "12.34" */
const decimal = z.union([z.string(), z.number()]).transform((v) => String(v).trim());

const party = z
  .object({ name: z.string().max(1_000).nullish() })
  .passthrough()
  .nullish();

export const ebTransactionSchema = z
  .object({
    entry_reference: z.string().max(1_000).nullish(),
    transaction_id: z.string().max(1_000).nullish(),
    booking_date: z.string().max(40).nullish(),
    value_date: z.string().max(40).nullish(),
    transaction_date: z.string().max(40).nullish(),
    transaction_amount: z.object({
      amount: decimal,
      currency: z.string().max(10).nullish(),
    }),
    credit_debit_indicator: z.string().max(10).nullish(),
    status: z.string().max(10).nullish(),
    creditor: party,
    debtor: party,
    remittance_information: z.array(z.string().max(10_000)).max(100).nullish(),
    bank_transaction_code: z
      .object({ description: z.string().max(1_000).nullish() })
      .passthrough()
      .nullish(),
    note: z.string().max(10_000).nullish(),
  })
  .passthrough();

export type EbTransaction = z.infer<typeof ebTransactionSchema>;

export interface MappedTransaction {
  importedId: string;
  date: string;
  /** Integer cents, negative for money out */
  amount: number;
  payeeName: string;
  /** The bank's own text for the other party, kept for rules */
  importedPayee: string;
  notes: string | null;
  /** The bank's reference for the transaction, if it gave a usable one */
  ref: string | null;
}

export interface SkippedCounts {
  /** No booking, value or transaction date that is a real date */
  noDate: number;
  /** Amount missing, unreadable or zero */
  badAmount: number;
  /** In another currency than the account (FlyBudget has one currency for now) */
  otherCurrency: number;
}

export const emptySkipped = (): SkippedCounts => ({ noDate: 0, badAmount: 0, otherCurrency: 0 });

export const ENABLE_BANKING_ID_PREFIX = 'eb:';

const AMOUNT_RE = /^[+-]?\d{1,15}(\.\d{1,8})?$/;

/** Exact conversion of a decimal string to integer cents, rounding half away from zero. */
export function decimalToCents(value: string): number | null {
  if (!AMOUNT_RE.test(value)) return null;
  const negative = value.startsWith('-');
  const [whole, frac = ''] = value.replace(/^[+-]/, '').split('.');
  let cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (Number(frac[2] ?? '0') >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return negative && cents !== 0 ? -cents : cents;
}

/** Signed cents: DBIT is money out, CRDT money in; without an indicator the bank's sign stands. */
export function signedCents(amount: string, indicator: string | null | undefined): number | null {
  const cents = decimalToCents(amount);
  if (cents === null) return null;
  if (indicator === 'DBIT') return cents === 0 ? 0 : -Math.abs(cents);
  if (indicator === 'CRDT') return Math.abs(cents);
  return cents;
}

/** Control characters become spaces, runs of whitespace one space. */
export function cleanText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// SEPA structured remittance (mostly German banks): "EREF+…" lines are references, not
// something a person wrote, while "SVWZ+…" is the purpose and "ABWA+…" another name.
const REFERENCE_LINE = /^(EREF|KREF|MREF|CRED|DEBT|IBAN|BIC|COAM|OAMT)\+/i;
const TEXT_PREFIX = /^(SVWZ|ABWA|ABWE)\+/i;
const NO_REFERENCE = /^(NONREF|NOTPROVIDED|NOT PROVIDED)$/i;

/** The remittance lines worth reading: SEPA reference lines dropped, prefixes stripped. */
export function remittanceLines(lines: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of lines ?? []) {
    const line = cleanText(raw);
    if (!line || REFERENCE_LINE.test(line) || NO_REFERENCE.test(line)) continue;
    const text = cleanText(line.replace(TEXT_PREFIX, ''));
    if (text) out.push(text);
  }
  return out;
}

// Some banks number entries within a day ("2026-10-17-3") instead of giving each a stable
// id: inserting one shifts the rest, so such a reference can't identify a transaction.
const POSITIONAL_REF = /^\d{4}-?\d{2}-?\d{2}[-_.]\d{1,6}$/;

/** The bank's reference for a transaction: the entry reference, else the transaction id. */
export function transactionRef(tx: Pick<EbTransaction, 'entry_reference' | 'transaction_id'>) {
  for (const candidate of [tx.entry_reference, tx.transaction_id]) {
    const ref = cleanText(candidate);
    if (ref && !NO_REFERENCE.test(ref) && !POSITIONAL_REF.test(ref)) return ref.slice(0, 300);
  }
  return null;
}

function transactionDate(tx: EbTransaction): string | null {
  for (const candidate of [tx.booking_date, tx.value_date, tx.transaction_date]) {
    // Some banks send a timestamp; the day is what counts
    const day = candidate?.slice(0, 10);
    if (day && isRealDate(day)) return day;
  }
  return null;
}

const clip = (value: string, max: number) => value.slice(0, max);

/**
 * Maps one page (or several) of a bank account's transactions. Ids are stable: the same
 * transaction gets the same id in every sync, and different ones never share an id within
 * a response (repeats get "#2", "#3", like CAMT imports). A record sent twice with the same
 * reference (some banks repeat pages) counts once.
 *
 * `mappingId` is FlyBudget's id for the bank account, not the bank's `uid`, which changes
 * whenever the user reconnects.
 */
export function mapTransactions(
  raw: readonly unknown[],
  opts: { mappingId: string; currency?: string | null },
): { transactions: MappedTransaction[]; skipped: SkippedCounts } {
  const skipped = emptySkipped();
  const transactions: MappedTransaction[] = [];
  const seen = new Map<string, number>();
  /** Records already mapped, by their bank reference and content */
  const repeats = new Set<string>();
  const accountCurrency = opts.currency?.toUpperCase() || null;

  for (const item of raw) {
    const parsed = ebTransactionSchema.safeParse(item);
    if (!parsed.success) {
      skipped.badAmount++;
      continue;
    }
    const tx = parsed.data;
    // Only booked transactions are asked for; a bank that sends others anyway is ignored
    if (tx.status && tx.status.toUpperCase() !== 'BOOK') continue;

    const date = transactionDate(tx);
    if (!date) {
      skipped.noDate++;
      continue;
    }
    const amount = signedCents(tx.transaction_amount.amount, tx.credit_debit_indicator);
    if (amount === null || amount === 0) {
      skipped.badAmount++;
      continue;
    }
    const currency = tx.transaction_amount.currency?.toUpperCase() || null;
    if (accountCurrency && currency && currency !== accountCurrency) {
      skipped.otherCurrency++;
      continue;
    }

    const lines = remittanceLines(tx.remittance_information);
    const outflow =
      tx.credit_debit_indicator === 'DBIT' || (tx.credit_debit_indicator !== 'CRDT' && amount < 0);
    const counterparty = clip(cleanText((outflow ? tx.creditor : tx.debtor)?.name), 200);
    const payeeName =
      counterparty ||
      clip(lines[0] ?? '', 200) ||
      clip(cleanText(tx.bank_transaction_code?.description), 200) ||
      clip(cleanText(tx.note), 200) ||
      'Unknown';
    const joined = clip(lines.join(' '), 5_000);
    // The payee already says it (card payments often repeat it in the remittance line)
    const notes = joined && !payeeName.includes(joined) ? joined : null;

    const ref = transactionRef(tx);
    // The same record twice (a bank repeating a page) is one transaction. Two different ones
    // with the same reference stay apart, numbered below
    if (ref) {
      const key = `${ref}\u0000${JSON.stringify(item)}`;
      if (repeats.has(key)) continue;
      repeats.add(key);
    }
    const base = ref
      ? `${ENABLE_BANKING_ID_PREFIX}${opts.mappingId}:${ref}`
      : `${ENABLE_BANKING_ID_PREFIX}${opts.mappingId}:h:${date}|${amount}|${payeeName.toLowerCase()}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    const suffix = occurrence > 1 ? `#${occurrence}` : '';

    transactions.push({
      importedId: clip(base, 500 - suffix.length) + suffix,
      date,
      amount,
      payeeName,
      importedPayee: counterparty || payeeName,
      notes,
      ref,
    });
  }
  return { transactions, skipped };
}

// Booked balances first: only booked transactions are imported, so the starting balance
// worked out from them must be a booked one too. Available balances (which include a
// credit line or pending card payments) are a last resort.
const BALANCE_PREFERENCE = ['ITBD', 'CLBD', 'OPBD', 'XPCD', 'INFO', 'OTHR', 'ITAV', 'CLAV'];

const balanceSchema = z
  .object({
    balance_amount: z.object({
      amount: decimal,
      currency: z.string().max(10).nullish(),
    }),
    balance_type: z.string().max(10).nullish(),
    reference_date: z.string().max(40).nullish(),
  })
  .passthrough();

/** The balance to match, in signed cents, or null when the bank gave none that's readable. */
export function pickBalance(raw: readonly unknown[]): number | null {
  const balances = raw
    .map((b) => balanceSchema.safeParse(b))
    .flatMap((r) => (r.success ? [r.data] : []))
    .map((b) => ({
      type: b.balance_type?.toUpperCase() ?? '',
      cents: decimalToCents(b.balance_amount.amount),
    }))
    .filter((b): b is { type: string; cents: number } => b.cents !== null);
  if (!balances.length) return null;
  const rank = (type: string) => {
    const i = BALANCE_PREFERENCE.indexOf(type);
    return i === -1 ? BALANCE_PREFERENCE.length : i;
  };
  return balances.reduce((best, b) => (rank(b.type) < rank(best.type) ? b : best)).cents;
}

/** FlyBudget account type for the bank's ISO 20022 cash account type. */
export function suggestAccountType(cashAccountType: string | null | undefined): AccountType {
  switch (cashAccountType?.toUpperCase()) {
    case 'SVGS':
    case 'MOMA':
    case 'ONDP':
      return 'savings';
    case 'CARD':
      return 'credit';
    case 'LOAN':
      return 'loan';
    case 'MGLD':
      return 'mortgage';
    case 'CASH':
      return 'cash';
    default:
      return 'checking';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** PSD2 lets banks give access for at most 180 days before the user confirms again */
export const MAX_CONSENT_DAYS = 180;
/** When the bank doesn't say, ask for 90 days, which every bank accepts */
export const DEFAULT_CONSENT_DAYS = 90;

/**
 * When to ask the bank's access to end: as long as the bank allows (at most 180 days),
 * an hour short so clock differences can't push it past the bank's limit.
 */
export function consentValidUntil(now: Date, maximumConsentSeconds?: number | null): Date {
  const maxMs =
    maximumConsentSeconds && maximumConsentSeconds > 0
      ? Math.min(maximumConsentSeconds * 1000, MAX_CONSENT_DAYS * DAY_MS)
      : DEFAULT_CONSENT_DAYS * DAY_MS;
  return new Date(now.getTime() + Math.max(maxMs - 60 * 60 * 1000, 60 * 60 * 1000));
}

export interface ExistingRow {
  id: string;
  date: string;
  amount: number;
  importedId: string | null;
}

const dayNumber = (date: string) =>
  Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY_MS;

/** How far apart (in days) a bank transaction and one already in FlyBudget may be dated */
export const ADOPT_MAX_DAYS = 3;

/** Ids other bank syncs give their transactions (they find their rows by them) */
const PROVIDER_ID = /^(plaid|simplefin):/;

/** What identifies a transaction within a bank account: its id minus the mapping prefix */
const ENABLE_BANKING_KEY = /^eb:[^:]+:(.+)$/;

/**
 * Pairs incoming bank transactions with ones already in the account that came from
 * somewhere else, so linking an account with history doesn't import everything twice:
 * a CSV or CAMT file, typed in by hand, the other side of a transfer, or an earlier Enable
 * Banking connection to the same bank (disconnected and added again).
 *
 * Exact matches come first: a CAMT row with the same bank reference (banks often use the
 * same one in both), or a row of an earlier connection with the same bank id. Otherwise a
 * row matches with the same amount dated at most `ADOPT_MAX_DAYS` apart, the closest first.
 * Each existing row is used at most once. Rows this mapping imported itself are never
 * candidates (they are found by id), and neither are rows another bank sync (Plaid,
 * SimpleFIN) still keeps up to date when `keepProviderRows` is set: changing their id would
 * make that sync import them again.
 *
 * Returns incoming index → existing row id.
 */
export function matchExistingImports(
  incoming: readonly MappedTransaction[],
  existing: readonly ExistingRow[],
  opts: { mappingId: string; keepProviderRows?: boolean },
): Map<number, string> {
  const own = `${ENABLE_BANKING_ID_PREFIX}${opts.mappingId}:`;
  const candidates = existing.filter(
    (row) =>
      !row.importedId?.startsWith(own) &&
      !(opts.keepProviderRows && row.importedId && PROVIDER_ID.test(row.importedId)),
  );
  const used = new Set<string>();
  const matches = new Map<number, string>();

  // Exact matches first, so a fuzzy match can't take a row a later exact one needs
  const byKey = new Map<string, ExistingRow>();
  for (const row of candidates) {
    if (!row.importedId) continue;
    const key = ENABLE_BANKING_KEY.exec(row.importedId)?.[1] ?? row.importedId;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  incoming.forEach((tx, i) => {
    const keys = [tx.importedId.slice(own.length)];
    if (tx.ref) keys.push(`camt:${tx.date}|${tx.amount}|${tx.ref.slice(0, 400)}`);
    for (const key of keys) {
      const row = byKey.get(key);
      if (row && !used.has(row.id)) {
        used.add(row.id);
        matches.set(i, row.id);
        return;
      }
    }
  });

  incoming.forEach((tx, i) => {
    if (matches.has(i)) return;
    const day = dayNumber(tx.date);
    let best: { row: ExistingRow; distance: number } | null = null;
    for (const row of candidates) {
      if (used.has(row.id) || row.amount !== tx.amount) continue;
      const distance = Math.abs(dayNumber(row.date) - day);
      if (distance > ADOPT_MAX_DAYS) continue;
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance && row.id < best.row.id)
      ) {
        best = { row, distance };
      }
    }
    if (best) {
      used.add(best.row.id);
      matches.set(i, best.row.id);
    }
  });
  return matches;
}

export interface KnownAccount {
  id: string;
  identificationHash: string | null;
  iban: string | null;
  name: string;
  currency: string | null;
  accountId: string | null;
}

export interface ReturningAccount {
  uid: string;
  identificationHash: string | null;
  iban: string | null;
  name: string;
  currency: string | null;
}

/**
 * After a new bank login, which of the bank's accounts are the ones FlyBudget already
 * knows (their ids change with every session). By identification hash, then IBAN, then the
 * same name and currency; and if exactly one linked account is still missing and exactly
 * one new account (in the same currency) is left, they are the same, since banks sometimes
 * change their identification after a new consent. Each is paired at most once.
 *
 * Returns returning uid → known mapping id.
 */
export function matchReturningAccounts(
  known: readonly KnownAccount[],
  returning: readonly ReturningAccount[],
): Map<string, string> {
  const pairs = new Map<string, string>();
  const claimed = new Set<string>();
  const passes: ((k: KnownAccount, r: ReturningAccount) => boolean)[] = [
    (k, r) => !!r.identificationHash && k.identificationHash === r.identificationHash,
    (k, r) => !!r.iban && k.iban === r.iban,
    (k, r) => k.name === r.name && k.currency === r.currency,
  ];
  for (const same of passes) {
    for (const r of returning) {
      if (pairs.has(r.uid)) continue;
      const k = known.find((k) => !claimed.has(k.id) && same(k, r));
      if (k) {
        pairs.set(r.uid, k.id);
        claimed.add(k.id);
      }
    }
  }
  const missing = known.filter((k) => !claimed.has(k.id) && k.accountId);
  const left = returning.filter((r) => !pairs.has(r.uid));
  if (
    missing.length === 1 &&
    left.length === 1 &&
    (!missing[0].currency || !left[0].currency || missing[0].currency === left[0].currency)
  ) {
    pairs.set(left[0].uid, missing[0].id);
  }
  return pairs;
}

// The OAuth `state` sent to the bank and back. The desktop app and `npm run dev` get the
// bank's redirect through a static page on flybudget.org, which forwards it to this
// computer: the port tells it where (website/static/bank-callback/relay.js reads it).
const STATE_RE = /^fb1\.(\d{1,5})\.([A-Za-z0-9_-]{32,128})$/;

export function makeState(port: number, random: string): string {
  return `fb1.${port}.${random}`;
}

export function parseState(state: string): { port: number; random: string } | null {
  const match = STATE_RE.exec(state);
  if (!match) return null;
  const port = Number(match[1]);
  return port >= 1 && port <= 65_535 ? { port, random: match[2] } : null;
}
