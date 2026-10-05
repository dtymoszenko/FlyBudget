import { decodeCsvBytes, generateImportId, normalizeDate, readImportAmount } from './csv';

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
 * The text of a CAMT file, in the encoding its XML declaration names (some banks still write
 * ISO-8859-1). A UTF-16 byte order mark wins, as in any XML reader; with neither it's UTF-8.
 */
export function decodeCamtBytes(bytes: ArrayBuffer): string {
  const head = new Uint8Array(bytes, 0, Math.min(200, bytes.byteLength));
  const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);
  if (utf16) return decodeCsvBytes(bytes, 'auto');
  const declared = new TextDecoder('ascii')
    .decode(head)
    .match(/^\s*<\?xml[^>]*encoding=["']([\w.:-]+)["']/i)?.[1];
  try {
    return new TextDecoder(declared ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes); // a label the browser doesn't know
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

/** `YYYY-MM-DD` from a `Dt` or `DtTm` (the bank's local time), if it's a real day */
function dateOf(el: Element | null): string | null {
  const value = text(find(el, 'Dt')) ?? text(find(el, 'DtTm'));
  const date = value?.slice(0, 10) ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? normalizeDate(date) || null : null;
}

/** Cents in an `Amt`, never negative (the indicator says which way the money went) */
const amountOf = (el: Element | null) => {
  const cents = readImportAmount(text(el) ?? undefined, 'dot');
  return cents === null ? null : Math.abs(cents);
};

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
  const cents = amountOf(amountEl);
  if (cents === null) return null;
  const indicator = text(find(details, 'CdtDbtInd'));
  const isDebit = indicator ? indicator === 'DBIT' : entryIsDebit;
  return isDebit ? -cents : cents;
}

interface Draft extends Omit<CamtTransaction, 'importedId'> {
  /** The bank's own reference, if it gave one */
  ref: string | null;
}

/** A reference that names one transaction: banks write NONREF or NOTPROVIDED when there's none */
function realRef(ref: string | null): string | null {
  return ref && !/^(NONREF|NOTPROVIDED)$/i.test(ref) ? ref : null;
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

/**
 * The transactions in one entry (`Ntry`), or null if it can't be imported. Zero amounts are
 * left out, as in a CSV import.
 */
function readEntry(entry: Element): Draft[] | null {
  // Version 2 to 7: <Sts>BOOK</Sts>; version 8 and later: <Sts><Cd>BOOK</Cd></Sts>
  const status = text(find(entry, 'Sts'));
  if (status && status !== 'BOOK') return null;

  const indicator = text(find(entry, 'CdtDbtInd'));
  if (indicator !== 'DBIT' && indicator !== 'CRDT') return null;
  const isDebit = indicator === 'DBIT';
  const cents = amountOf(find(entry, 'Amt'));
  const date = dateOf(find(entry, 'BookgDt')) ?? dateOf(find(entry, 'ValDt'));
  if (cents === null || !date) return null;
  if (cents === 0) return [];
  const amount = isDebit ? -cents : cents;

  const entryRef = realRef(text(find(entry, 'AcctSvcrRef')));
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
      // The parts' own references only if each has a different one: many banks repeat the
      // entry's reference on every part
      const partRefs = details.map((d) => realRef(text(find(d, 'Refs', 'AcctSvcrRef'))));
      const ownRefs =
        partRefs.every((r) => r && r !== entryRef) && new Set(partRefs).size === partRefs.length;
      const parts = details.map((d, i) =>
        draft(
          date,
          amounts[i]!,
          partyName(d, (amounts[i] ?? 0) < 0) ?? text(find(d, 'AddtlTxInf')),
          remittance(d),
          ownRefs ? partRefs[i] : entryRef ? `${entryRef}:${i + 1}` : null,
        ),
      );
      return parts.filter((p) => p.amount !== 0);
    }
    // The parts don't add up (or have no amounts): one transaction, as the account saw it
    return [draft(date, amount, entryInfo, `${details.length} payments`, entryRef)];
  }

  const only = details[0] ?? null;
  const payee = partyName(only, isDebit) ?? text(find(only, 'AddtlTxInf')) ?? entryInfo;
  const notes = remittance(only) ?? (entryInfo !== payee ? entryInfo : null);
  const ref = entryRef ?? realRef(text(find(only, 'Refs', 'AcctSvcrRef')));
  return [draft(date, amount, payee, notes, ref)];
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

  // Each statement's transactions, by account
  const byAccount = new Map<string | null, { statements: Draft[][]; skipped: number }>();
  const statementIds = new Set<string>();
  for (const statement of elements(root).filter((e) =>
    ['Stmt', 'Rpt', 'Ntfctn'].includes(e.localName),
  )) {
    const account = accountId(statement);
    // The same statement twice in one file: its entries are already in. Banks number
    // statements per account, so the number alone isn't enough.
    const id = text(find(statement, 'Id'));
    if (id) {
      const key = JSON.stringify([account, id]);
      if (statementIds.has(key)) continue;
      statementIds.add(key);
    }
    const group = byAccount.get(account) ?? { statements: [], skipped: 0 };
    byAccount.set(account, group);
    const drafts: Draft[] = [];
    for (const entry of findAll(statement, 'Ntry')) {
      const read = readEntry(entry);
      if (read) drafts.push(...read);
      else group.skipped++;
    }
    group.statements.push(drafts);
  }

  return [...byAccount].map(([account, { statements, skipped }]) => {
    // Ids already given, with the transaction they were given to (date and amount)
    const given = new Map<string, string>();
    const transactions: CamtTransaction[] = [];
    for (const drafts of statements) {
      // Identical transactions without a reference are numbered within their statement, so
      // the same one in an overlapping statement gets the same id and is left out
      const occurrences = new Map<string, number>();
      for (const d of drafts) {
        const what = `${d.date}|${d.amount}`;
        let importedId: string;
        if (d.ref) {
          importedId = `camt:${d.ref}`.slice(0, 500);
          // A bank that reuses a reference for another transaction: tell them apart
          const earlier = given.get(importedId);
          if (earlier !== undefined && earlier !== what) {
            importedId = `camt:${d.ref}|${what}`.slice(0, 500);
          }
        } else {
          // No reference: the same id a CSV row would get
          const key = generateImportId(d.date, d.amount, d.payeeName ?? '');
          const occurrence = (occurrences.get(key) ?? 0) + 1;
          occurrences.set(key, occurrence);
          importedId = generateImportId(d.date, d.amount, d.payeeName ?? '', occurrence);
        }
        // The same transaction again, from an overlapping statement
        if (given.has(importedId)) continue;
        given.set(importedId, what);
        const { ref: _, ...transaction } = d;
        transactions.push({ ...transaction, importedId });
      }
    }
    return { account, transactions, skipped };
  });
}
