import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { decodeCamtBytes, looksLikeCamt, parseCamt } from './camt';

// The app uses the browser's DOMParser; tests run in Node, which has none
beforeAll(() => {
  globalThis.DOMParser = XmlDomParser as unknown as typeof DOMParser;
});

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const money = (cents: number) =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

interface Part {
  cents: number;
  name: string;
  memo: string | null;
  ref: string | null;
}

interface Entry {
  cents: number; // always positive, like the file
  debit: boolean;
  booked: boolean;
  bookingDate: string;
  valueDate: string;
  ref: string | null;
  parts: Part[]; // 0 or 1: a plain entry; more: a batch
  partsAddUp: boolean;
}

/** Writes entries as a bank would, in the old (v2) or new (v8) layout of CAMT.053 */
function camtFile(entries: Entry[], { v8 = false, iban = 'DE89370400440532013000' } = {}) {
  const party = (name: string) =>
    v8 ? `<Pty><Nm>${esc(name)}</Nm></Pty>` : `<Nm>${esc(name)}</Nm>`;
  const details = (e: Entry, p: Part) => `
        <TxDtls>
          ${p.ref ? `<Refs><AcctSvcrRef>${esc(p.ref)}</AcctSvcrRef></Refs>` : ''}
          <AmtDtls><TxAmt><Amt Ccy="EUR">${money(p.cents)}</Amt></TxAmt></AmtDtls>
          <RltdPties>
            <Dbtr>${party(e.debit ? 'Account Holder' : p.name)}</Dbtr>
            <Cdtr>${party(e.debit ? p.name : 'Account Holder')}</Cdtr>
          </RltdPties>
          ${p.memo ? `<RmtInf><Ustrd>${esc(p.memo)}</Ustrd></RmtInf>` : ''}
        </TxDtls>`;
  const status = (booked: boolean) => {
    const code = booked ? 'BOOK' : 'PDNG';
    return v8 ? `<Sts><Cd>${code}</Cd></Sts>` : `<Sts>${code}</Sts>`;
  };
  const ns = v8
    ? 'urn:iso:std:iso:20022:tech:xsd:camt.053.001.08'
    : 'urn:iso:std:iso:20022:tech:xsd:camt.053.001.02';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="${ns}">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>1</MsgId></GrpHdr>
    <Stmt>
      <Id>S1</Id>
      <Acct><Id><IBAN>${iban}</IBAN></Id></Acct>
      ${entries
        .map(
          (e) => `
      <Ntry>
        ${e.ref ? `<AcctSvcrRef>${esc(e.ref)}</AcctSvcrRef>` : ''}
        <Amt Ccy="EUR">${money(e.cents)}</Amt>
        <CdtDbtInd>${e.debit ? 'DBIT' : 'CRDT'}</CdtDbtInd>
        ${status(e.booked)}
        <BookgDt><Dt>${e.bookingDate}</Dt></BookgDt>
        <ValDt><Dt>${e.valueDate}</Dt></ValDt>
        <NtryDtls>${e.parts.map((p) => details(e, p)).join('')}</NtryDtls>
      </Ntry>`,
        )
        .join('')}
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
}

const day = fc
  .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-12-31T00:00:00Z') })
  .filter((d) => !isNaN(d.getTime()))
  .map((d) => d.toISOString().slice(0, 10));
const text = fc
  .string({ unit: fc.constantFrom('a', 'B', ' ', '&', '<', 'ü', '1'), minLength: 1, maxLength: 20 })
  // XML readers collapse runs of spaces, and so do we
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter((s) => s !== '');
// Short references collide often, as when a bank reuses one; NONREF means there is none
const ref = fc.option(fc.oneof(fc.stringMatching(/^[A-Z0-9]{1,3}$/), fc.constant('NONREF')), {
  nil: null,
});
const realRef = (r: string | null) => (r === 'NONREF' ? null : r);
const part = fc.record<Part>({
  cents: fc.integer({ min: 1, max: 10_000_000 }),
  name: text,
  memo: fc.option(text, { nil: null }),
  ref,
});

const entry = fc
  .record({
    debit: fc.boolean(),
    booked: fc.boolean(),
    bookingDate: day,
    valueDate: day,
    ref,
    parts: fc.array(part, { maxLength: 4 }),
    partsAddUp: fc.boolean(),
    single: fc.integer({ min: 1, max: 10_000_000 }),
  })
  .map(({ parts, partsAddUp, single, ...e }): Entry => {
    const sum = parts.reduce((s, p) => s + p.cents, 0);
    const cents =
      parts.length > 1
        ? partsAddUp
          ? sum
          : sum + 1
        : parts.length === 1
          ? parts[0].cents
          : single;
    return { ...e, parts, partsAddUp: parts.length > 1 && partsAddUp, cents };
  });

/** What the importer should make of an entry */
function expected(e: Entry) {
  const sign = e.debit ? -1 : 1;
  if (e.parts.length > 1 && e.partsAddUp) {
    return e.parts.map((p) => ({ date: e.bookingDate, amount: sign * p.cents, payeeName: p.name }));
  }
  return [
    {
      date: e.bookingDate,
      amount: sign * e.cents,
      payeeName: e.parts.length === 1 ? e.parts[0].name : null,
    },
  ];
}

describe('parseCamt (property-based)', () => {
  it('imports booked entries only, signed, on their booking date, from either layout', () => {
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 15 }), fc.boolean(), (entries, v8) => {
        const statements = parseCamt(camtFile(entries, { v8 }));
        expect(statements).toHaveLength(1);
        const [statement] = statements!;
        expect(statement.account).toBe('DE89370400440532013000');
        expect(statement.skipped).toBe(entries.filter((e) => !e.booked).length);

        // Within one statement every booked transaction is real, whatever the references say
        const wanted = entries.filter((e) => e.booked).flatMap(expected);
        expect(
          statement.transactions.map(({ date, amount, payeeName }) => ({
            date,
            amount,
            payeeName,
          })),
        ).toEqual(wanted);
        // Every transaction can be told apart from the others when importing again
        const ids = statement.transactions.map((t) => t.importedId);
        expect(new Set(ids).size).toBe(ids.length);
      }),
    );
  });

  it('adds nothing for a statement repeated (or overlapping) in the same file', () => {
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 10 }), (entries) => {
        const once = parseCamt(camtFile(entries))![0];
        // The same entries again under another statement number, as daily files overlap
        const file = camtFile(entries);
        const twice = file.replace(
          /<Stmt>([\s\S]*)<\/Stmt>/,
          (_, body: string) =>
            `<Stmt>${body}</Stmt><Stmt>${body.replace('<Id>S1</Id>', '<Id>S2</Id>')}</Stmt>`,
        );
        const [statement] = parseCamt(twice)!;
        expect(statement.transactions).toEqual(once.transactions);
      }),
    );
  });

  it('gives each transaction the same id whatever else the file holds', () => {
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 8 }), fc.array(entry, { maxLength: 8 }), (a, b) => {
        // A statement read on its own, and after another one in the same file
        const alone = parseCamt(camtFile(b))![0].transactions;
        const both = camtFile([...a, ...b]);
        const ids = new Set(parseCamt(both)![0].transactions.map((t) => t.importedId));
        // Transactions from b with a reference keep their id (or are found in a as the same)
        for (const t of alone)
          if (t.importedId.startsWith('camt:')) expect(ids.has(t.importedId)).toBe(true);
      }),
    );
  });

  it('gives the same ids to the same statement read twice, so a re-import finds duplicates', () => {
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 10 }), (entries) => {
        const ids = () => parseCamt(camtFile(entries))![0].transactions.map((t) => t.importedId);
        expect(ids()).toEqual(ids());
      }),
    );
  });

  it('keeps two identical payments in one statement, even with a shared reference', () => {
    const card = `<Ntry><AcctSvcrRef>CARD</AcctSvcrRef><Amt>3.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2025-01-02</Dt></BookgDt></Ntry>`;
    const [statement] = parseCamt(
      `<Document><BkToCstmrStmt><Stmt>${card}${card}</Stmt></BkToCstmrStmt></Document>`,
    )!;
    expect(statement.transactions.map((t) => t.importedId)).toEqual([
      'camt:2025-01-02|-350|CARD',
      'camt:2025-01-02|-350|CARD#2',
    ]);
  });

  it('keeps ids within the server limit for very long texts', () => {
    const long = 'x'.repeat(480);
    const [statement] = parseCamt(
      `<Document><BkToCstmrStmt><Stmt><Ntry><AcctSvcrRef>NONREF</AcctSvcrRef><Amt>1.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2025-01-02</Dt></BookgDt><AddtlNtryInf>${long}</AddtlNtryInf></Ntry></Stmt></BkToCstmrStmt></Document>`,
    )!;
    expect(statement.transactions[0].importedId.length).toBeLessThanOrEqual(500);
  });

  it('tells apart transactions that share a reference on different days, across files', () => {
    // References that restart every day: R1 today is another transaction than R1 tomorrow
    const file = (day: string) =>
      `<Document><BkToCstmrStmt><Stmt><Ntry><AcctSvcrRef>R1</AcctSvcrRef><Amt>5.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>${day}</Dt></BookgDt></Ntry></Stmt></BkToCstmrStmt></Document>`;
    const id = (day: string) => parseCamt(file(day))![0].transactions[0].importedId;
    expect(id('2025-01-02')).not.toBe(id('2025-01-03'));
    expect(id('2025-01-02')).toBe(id('2025-01-02'));
  });

  it('keeps statements of different accounts that share a number', () => {
    const stmt = (iban: string, amount: string) =>
      `<Stmt><Id>1</Id><Acct><Id><IBAN>${iban}</IBAN></Id></Acct><Ntry><Amt>${amount}</Amt>` +
      `<CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2025-01-02</Dt></BookgDt></Ntry></Stmt>`;
    const statements = parseCamt(
      `<Document><BkToCstmrStmt>${stmt('NL91ABNA0417164300', '1.00')}${stmt('DE89370400440532013000', '2.00')}</BkToCstmrStmt></Document>`,
    )!;
    expect(statements.map((s) => [s.account, s.transactions[0].amount])).toEqual([
      ['NL91ABNA0417164300', -100],
      ['DE89370400440532013000', -200],
    ]);
  });

  it('keeps every payment of a batch whose parts repeat the entry reference or say NONREF', () => {
    const part = (amount: string, name: string, ref: string) =>
      `<TxDtls><Refs><AcctSvcrRef>${ref}</AcctSvcrRef></Refs>` +
      `<AmtDtls><TxAmt><Amt>${amount}</Amt></TxAmt></AmtDtls>` +
      `<RltdPties><Cdtr><Nm>${name}</Nm></Cdtr></RltdPties></TxDtls>`;
    const batch = (ref: string, partRef: string) =>
      `<Ntry><AcctSvcrRef>${ref}</AcctSvcrRef><Amt>30.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>` +
      `<BookgDt><Dt>2025-01-02</Dt></BookgDt><NtryDtls>` +
      `${part('10.00', 'Anna', partRef)}${part('20.00', 'Ben', partRef)}</NtryDtls></Ntry>`;
    const [statement] = parseCamt(
      `<Document><BkToCstmrStmt><Stmt>${batch('B1', 'B1')}${batch('NONREF', 'NONREF')}</Stmt></BkToCstmrStmt></Document>`,
    )!;
    expect(statement.transactions.map((t) => [t.payeeName, t.amount, t.importedId])).toEqual([
      ['Anna', -1000, 'camt:2025-01-02|-1000|B1:1'],
      ['Ben', -2000, 'camt:2025-01-02|-2000|B1:2'],
      ['Anna', -1000, '2025-01-02|-1000|anna'],
      ['Ben', -2000, '2025-01-02|-2000|ben'],
    ]);
  });

  it('imports an entry without a reference once, when overlapping statements both have it', () => {
    const coffee = `<Ntry><Amt>3.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2025-01-02</Dt></BookgDt><AddtlNtryInf>Cafe</AddtlNtryInf></Ntry>`;
    // Two coffees that day in the first statement; the second statement repeats one of them
    const [statement] = parseCamt(
      `<Document><BkToCstmrStmt><Stmt><Id>A</Id>${coffee}${coffee}</Stmt><Stmt><Id>B</Id>${coffee}</Stmt></BkToCstmrStmt></Document>`,
    )!;
    expect(statement.transactions).toHaveLength(2);
  });

  it('keeps one transaction per statement account', () => {
    const file = camtFile([]).replace(
      /<Stmt>[\s\S]*<\/Stmt>/,
      ['NL91ABNA0417164300', 'DE89370400440532013000']
        .map((iban) => `<Stmt><Acct><Id><IBAN>${iban}</IBAN></Id></Acct></Stmt>`)
        .join(''),
    );
    expect(parseCamt(file)!.map((s) => s.account)).toEqual([
      'NL91ABNA0417164300',
      'DE89370400440532013000',
    ]);
  });
});

describe('parseCamt', () => {
  it('reads a typical German statement entry', () => {
    const [statement] = parseCamt(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt><Stmt>
    <Acct><Id><IBAN>DE02120300000000202051</IBAN></Id></Acct>
    <Ntry>
      <Amt Ccy="EUR">12.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
      <BookgDt><Dt>2025-01-15</Dt></BookgDt><ValDt><Dt>2025-01-16</Dt></ValDt>
      <AcctSvcrRef>2025011512345</AcctSvcrRef>
      <AddtlNtryInf>KARTENZAHLUNG</AddtlNtryInf>
      <NtryDtls><TxDtls>
        <RltdPties><Cdtr><Nm>Bäckerei Müller</Nm></Cdtr></RltdPties>
        <RmtInf><Ustrd>Brötchen</Ustrd><Ustrd>Filiale 12</Ustrd></RmtInf>
      </TxDtls></NtryDtls>
    </Ntry>
    <Ntry>
      <Amt Ccy="EUR">99.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>PDNG</Sts>
      <BookgDt><Dt>2025-01-17</Dt></BookgDt>
    </Ntry>
  </Stmt></BkToCstmrStmt>
</Document>`)!;
    expect(statement).toEqual({
      account: 'DE02120300000000202051',
      skipped: 1,
      transactions: [
        {
          date: '2025-01-15',
          amount: -1250,
          payeeName: 'Bäckerei Müller',
          notes: 'Brötchen Filiale 12',
          importedId: 'camt:2025-01-15|-1250|2025011512345',
        },
      ],
    });
  });

  it('falls back to the entry text when there are no details, and to CSV-style ids', () => {
    const [statement] = parseCamt(`<Document><BkToCstmrStmt><Stmt>
      <Ntry><Amt>40.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><DtTm>2025-03-01T09:30:00+01:00</DtTm></BookgDt>
        <AddtlNtryInf>Gutschrift</AddtlNtryInf></Ntry>
    </Stmt></BkToCstmrStmt></Document>`)!;
    expect(statement.account).toBeNull();
    expect(statement.transactions).toEqual([
      {
        date: '2025-03-01',
        amount: 4000,
        payeeName: 'Gutschrift',
        notes: null,
        importedId: '2025-03-01|4000|gutschrift',
      },
    ]);
  });

  it('rejects impossible dates, leaves out zero amounts, and reads each statement once', () => {
    const entry = (amount: string, day: string) =>
      `<Ntry><Amt>${amount}</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>${day}</Dt></BookgDt></Ntry>`;
    const stmt = `<Stmt><Id>2025-001</Id>${entry('5.00', '2025-02-28')}${entry('0.00', '2025-02-28')}${entry('7.00', '2025-02-30')}</Stmt>`;
    // The same statement twice, as when daily files are joined
    const [statement] = parseCamt(
      `<Document><BkToCstmrStmt>${stmt}${stmt}</BkToCstmrStmt></Document>`,
    )!;
    expect(statement.transactions.map((t) => [t.date, t.amount])).toEqual([['2025-02-28', -500]]);
    expect(statement.skipped).toBe(1); // February 30
  });

  it('refuses files that are not CAMT statements', () => {
    expect(parseCamt('<html><body>hi</body></html>')).toBeNull();
    expect(parseCamt('not xml at all <<<')).toBeNull();
  });

  it('recognizes CAMT files before parsing them', () => {
    expect(looksLikeCamt('<?xml version="1.0"?><Document><BkToCstmrStmt>')).toBe(true);
    expect(looksLikeCamt('<Document><ns2:BkToCstmrAcctRpt>')).toBe(true);
    expect(looksLikeCamt('Date,Amount\n2025-01-01,5')).toBe(false);
  });

  it('follows a UTF-16 byte order mark over the declaration', () => {
    const xml = '﻿<?xml version="1.0" encoding="UTF-16"?><Nm>Łódź</Nm>';
    const le = new Uint8Array(xml.length * 2);
    [...xml].forEach((ch, i) => {
      le[2 * i] = ch.charCodeAt(0) & 0xff;
      le[2 * i + 1] = ch.charCodeAt(0) >> 8;
    });
    expect(decodeCamtBytes(le.buffer)).toContain('Łódź');
  });

  it('decodes the encoding the XML declaration names', () => {
    const xml = '<?xml version="1.0" encoding="ISO-8859-1"?><Nm>Müller</Nm>';
    const latin1 = Uint8Array.from(xml, (ch) => ch.charCodeAt(0)).buffer; // ü is one byte
    expect(decodeCamtBytes(latin1)).toContain('Müller');
  });
});
