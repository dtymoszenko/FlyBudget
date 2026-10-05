import { generateImportId, readImportAmount } from './csv';

/**
 * ISO 20022 bank statements (CAMT.053, also the CAMT.052 report and CAMT.054 notification),
 * which most European banks offer next to CSV. Unlike CSV there is nothing to guess: amounts
 * use a decimal point, every entry says whether it is a credit or a debit, and dates are ISO.
 *
 * Compared with Actual Budget's importer this deliberately:
 * - imports only booked entries (`BOOK`): pending ones change or disappear later
 * - dates entries by when the bank booked them, so they land in the month the bank shows
 * - splits a batch into its payments only when their amounts add up to the entry, and gives
 *   each its own id, so importing an overlapping statement finds them as duplicates
 */

export interface CamtTransaction {
  date: string;
  /** Cents, negative for money out */
  amount: number;
  payeeName: string | null;
  notes: string | null;
  importedId: string;
}

export interface CamtStatement {
  /** The account's IBAN (or other id), if the file says */
  account: string | null;
  transactions: CamtTransaction[];
  /** Pending entries, and entries without a readable date or amount */
  skipped: number;
}

/** Whether a file looks like a CAMT statement (decided before parsing it) */
export function looksLikeCamt(text: string): boolean {
  return /<([\w-]+:)?(BkToCstmrStmt|BkToCstmrAcctRpt|BkToCstmrDbtCdtNtfctn)[\s>]/.test(
    text.slice(0, 4096),
  );
}

/**
 * The text of a CAMT file, in the encoding its XML declaration names (UTF-8 if none).
 * Some banks still write ISO-8859-1.
 */
export function decodeCamtBytes(bytes: ArrayBuffer): string {
  const head = new TextDecoder('ascii').decode(
    new Uint8Array(bytes, 0, Math.min(200, bytes.byteLength)),
  );
  const declared = head.match(/^\s*<\?xml[^>]*encoding=["']([\w.:-]+)["']/i)?.[1];
  try {
    return new TextDecoder(declared ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

const elements = (el: Element) =>
  Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1);

/** The first descendant reached by following these element names (ignoring namespaces) */
function find(el: Element | null | undefined, ...path: string[]): Element | null {
  let current: Element | null = el ?? null;
  for (const name of path) {
    if (!current) return null;
    current = elements(current).find((c) => c.localName === name) ?? null;
  }
  return current;
}

/** Every child with this name, following the path to its parent first */
function findAll(el: Element | null, ...path: string[]): Element[] {
  const parentPath = path.slice(0, -1);
  const name = path[path.length - 1];
  const parent = parentPath.length ? find(el, ...parentPath) : el;
  return parent ? elements(parent).filter((c) => c.localName === name) : [];
}

function text(el: Element | null): string | null {
  const value = el?.textContent?.replace(/\s+/g, ' ').trim();
  return value ? value : null;
}

/** All elements with this name anywhere under `root` (ignoring namespaces), in order */
function descendants(root: Element | Document, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', name));
}

/** `YYYY-MM-DD` from a `Dt` or `DtTm` (the bank's local time) */
function dateOf(el: Element | null): string | null {
  const value = text(find(el, 'Dt')) ?? text(find(el, 'DtTm'));
  const date = value?.slice(0, 10);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** The other party's name: who was paid for money out, who paid for money in */
function partyName(details: Element | null, isDebit: boolean): string | null {
  const parties = find(details, 'RltdPties');
  for (const role of isDebit ? ['Cdtr', 'UltmtCdtr'] : ['Dbtr', 'UltmtDbtr']) {
    // CAMT.053 up to version 7 has Cdtr/Nm, version 8 and later Cdtr/Pty/Nm
    const name = text(find(parties, role, 'Nm')) ?? text(find(parties, role, 'Pty', 'Nm'));
    if (name) return name;
  }
  return null;
}

function remittance(details: Element | null): string | null {
  const lines = findAll(details, 'RmtInf', 'Ustrd')
    .map(text)
    .filter((l): l is string => !!l);
  return lines.length ? lines.join(' ') : null;
}

/** A transaction's amount in cents, from the transaction amount the bank booked */
function detailAmount(details: Element, entryIsDebit: boolean): number | null {
  const amountEl =
    find(details, 'AmtDtls', 'TxAmt', 'Amt') ??
    find(details, 'Amt') ??
    find(details, 'AmtDtls', 'InstdAmt', 'Amt');
  const cents = readImportAmount(text(amountEl) ?? undefined, 'dot');
  if (cents === null) return null;
  const indicator = text(find(details, 'CdtDbtInd'));
  const isDebit = indicator ? indicator === 'DBIT' : entryIsDebit;
  return isDebit ? -cents : cents;
}

interface Draft extends Omit<CamtTransaction, 'importedId'> {
  /** The bank's own reference, if it gave one */
  ref: string | null;
}

const clip = (s: string | null, max: number) => (s ? s.slice(0, max) : null);

function draft(
  date: string,
  amount: number,
  payee: string | null,
  notes: string | null,
  ref: string | null,
): Draft {
  // The payee already says it (card payments often repeat it in the remittance line)
  const cleanNotes = payee && notes && payee.includes(notes) ? null : notes;
  return { date, amount, payeeName: clip(payee, 500), notes: clip(cleanNotes, 5000), ref };
}

/** The transactions in one entry (`Ntry`), or null if it can't be imported */
function readEntry(entry: Element): Draft[] | null {
  // Version 2 to 7: <Sts>BOOK</Sts>; version 8 and later: <Sts><Cd>BOOK</Cd></Sts>
  const status = text(find(entry, 'Sts'));
  if (status && status !== 'BOOK') return null;

  const indicator = text(find(entry, 'CdtDbtInd'));
  if (indicator !== 'DBIT' && indicator !== 'CRDT') return null;
  const isDebit = indicator === 'DBIT';
  const cents = readImportAmount(text(find(entry, 'Amt')) ?? undefined, 'dot');
  const date = dateOf(find(entry, 'BookgDt')) ?? dateOf(find(entry, 'ValDt'));
  if (cents === null || !date) return null;
  const amount = isDebit ? -cents : cents;

  const entryRef = text(find(entry, 'AcctSvcrRef'));
  const entryInfo = text(find(entry, 'AddtlNtryInf'));
  const details = findAll(entry, 'NtryDtls', 'TxDtls').concat(
    // Some banks repeat NtryDtls once per transaction instead of listing them in one
    findAll(entry, 'NtryDtls')
      .slice(1)
      .flatMap((d) => findAll(d, 'TxDtls')),
  );

  if (details.length > 1) {
    const amounts = details.map((d) => detailAmount(d, isDebit));
    const sum = amounts.reduce<number | null>(
      (s, a) => (s === null || a === null ? null : s + a),
      0,
    );
    if (sum === amount) {
      return details.map((d, i) =>
        draft(
          date,
          amounts[i]!,
          partyName(d, (amounts[i] ?? 0) < 0) ?? text(find(d, 'AddtlTxInf')),
          remittance(d),
          text(find(d, 'Refs', 'AcctSvcrRef')) ?? (entryRef ? `${entryRef}:${i + 1}` : null),
        ),
      );
    }
    // The parts don't add up (or have no amounts): one transaction, as the account saw it
    return [draft(date, amount, entryInfo, `${details.length} payments`, entryRef)];
  }

  const only = details[0] ?? null;
  const payee = partyName(only, isDebit) ?? text(find(only, 'AddtlTxInf')) ?? entryInfo;
  const notes = remittance(only) ?? (entryInfo !== payee ? entryInfo : null);
  return [draft(date, amount, payee, notes, entryRef ?? text(find(only, 'Refs', 'AcctSvcrRef')))];
}

function accountId(statement: Element): string | null {
  const id = find(statement, 'Acct', 'Id');
  return text(find(id, 'IBAN')) ?? text(find(id, 'Othr', 'Id'));
}

/**
 * The statements in a CAMT file, one per account (a file can hold several days, or several
 * accounts). Null if it isn't a CAMT file.
 */
export function parseCamt(xml: string): CamtStatement[] | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return null;
  }
  if (doc.getElementsByTagName('parsererror').length) return null;
  const root = ['BkToCstmrStmt', 'BkToCstmrAcctRpt', 'BkToCstmrDbtCdtNtfctn']
    .map((name) => descendants(doc, name)[0])
    .find(Boolean);
  if (!root) return null;

  const byAccount = new Map<string | null, { drafts: Draft[]; skipped: number }>();
  for (const statement of elements(root).filter((e) =>
    ['Stmt', 'Rpt', 'Ntfctn'].includes(e.localName),
  )) {
    const account = accountId(statement);
    const group = byAccount.get(account) ?? { drafts: [], skipped: 0 };
    byAccount.set(account, group);
    for (const entry of findAll(statement, 'Ntry')) {
      const drafts = readEntry(entry);
      if (drafts) group.drafts.push(...drafts);
      else group.skipped++;
    }
  }

  return [...byAccount].map(([account, { drafts, skipped }]) => {
    const seen = new Set<string>();
    const occurrences = new Map<string, number>();
    const transactions: CamtTransaction[] = [];
    for (const d of drafts) {
      let importedId: string;
      if (d.ref) {
        importedId = `camt:${d.ref}`.slice(0, 500);
        // The same entry in two overlapping statements of one file
        if (seen.has(importedId)) continue;
      } else {
        // No reference: the same id a CSV row would get
        const key = generateImportId(d.date, d.amount, d.payeeName ?? '');
        const occurrence = (occurrences.get(key) ?? 0) + 1;
        occurrences.set(key, occurrence);
        importedId = generateImportId(d.date, d.amount, d.payeeName ?? '', occurrence);
      }
      seen.add(importedId);
      const { ref: _, ...transaction } = d;
      transactions.push({ ...transaction, importedId });
    }
    return { account, transactions, skipped };
  });
}
