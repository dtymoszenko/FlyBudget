import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ADOPT_MAX_DAYS,
  consentValidUntil,
  decimalToCents,
  makeState,
  mapTransactions,
  matchExistingImports,
  matchReturningAccounts,
  MAX_CONSENT_DAYS,
  parseState,
  pickBalance,
  remittanceLines,
  signedCents,
  suggestAccountType,
  transactionRef,
  type ExistingRow,
  type KnownAccount,
  type ReturningAccount,
  type MappedTransaction,
} from './enableBankingTransactions.js';

const DAY = 24 * 60 * 60 * 1000;
const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * DAY).toISOString().slice(0, 10);

/** A decimal string for `cents`, written the way banks do: "12.3", "12.30", "+12.30" */
const amountText = (cents: number, decimals: 2 | 1 | 0 | 3, plus: boolean) => {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const body =
    decimals === 0 && frac === '00'
      ? String(whole)
      : decimals === 3
        ? `${whole}.${frac}0`
        : decimals === 1 && frac.endsWith('0')
          ? `${whole}.${frac[0]}`
          : `${whole}.${frac}`;
  return (cents < 0 ? '-' : plus ? '+' : '') + body;
};

const centsArb = fc.integer({ min: -10_000_000_00, max: 10_000_000_00 });

describe('amounts', () => {
  it('reads any amount back exactly, however it is written', () => {
    fc.assert(
      fc.property(
        centsArb,
        fc.constantFrom(0, 1, 2, 3) as fc.Arbitrary<0 | 1 | 2 | 3>,
        fc.boolean(),
        (cents, d, plus) => {
          expect(decimalToCents(amountText(cents, d, plus))).toBe(cents);
        },
      ),
    );
  });

  it('takes the sign from the credit/debit indicator, else from the amount', () => {
    fc.assert(
      fc.property(centsArb, (cents) => {
        const text = amountText(Math.abs(cents), 2, false);
        expect(signedCents(text, 'DBIT')).toBe(cents === 0 ? 0 : -Math.abs(cents));
        expect(signedCents(text, 'CRDT')).toBe(Math.abs(cents));
        expect(signedCents(amountText(cents, 2, false), null)).toBe(cents);
        // A bank that signs the amount too still gets the indicator's direction
        expect(signedCents(`-${text}`, 'CRDT')).toBe(Math.abs(cents));
      }),
    );
  });

  it.each(['', '1,50', '1.2.3', 'abc', '1e5', '12.'])('refuses %j', (text) => {
    expect(decimalToCents(text)).toBeNull();
  });
});

describe('references', () => {
  it('prefers the entry reference, then the transaction id', () => {
    expect(transactionRef({ entry_reference: 'A1', transaction_id: 'B2' })).toBe('A1');
    expect(transactionRef({ entry_reference: null, transaction_id: 'B2' })).toBe('B2');
    expect(transactionRef({ entry_reference: 'NOTPROVIDED', transaction_id: 'B2' })).toBe('B2');
  });

  it("doesn't trust a reference that only numbers the entries of a day", () => {
    expect(transactionRef({ entry_reference: '2026-10-17-3', transaction_id: 'X9' })).toBe('X9');
    expect(transactionRef({ entry_reference: '20261017_12', transaction_id: null })).toBeNull();
  });
});

describe('remittance', () => {
  it('drops SEPA reference lines and keeps the purpose', () => {
    expect(
      remittanceLines(['EREF+NOTPROVIDED', 'MREF+M-123', 'SVWZ+Rent October', 'ABWA+Jane Doe']),
    ).toEqual(['Rent October', 'Jane Doe']);
  });

  it('strips control characters', () => {
    expect(remittanceLines(['Coffee\u0000\nshop  '])).toEqual(['Coffee shop']);
  });
});

const txArb = fc.record({
  cents: fc.integer({ min: 1, max: 1_000_000_00 }),
  out: fc.boolean(),
  day: fc.integer({ min: 0, max: 400 }),
  ref: fc.option(fc.stringMatching(/^[A-Z0-9]{4,12}$/), { nil: null }),
  name: fc.option(fc.stringMatching(/^[A-Za-z ]{1,20}$/), { nil: null }),
  remittance: fc.array(fc.stringMatching(/^[A-Za-z0-9 ]{0,30}$/), { maxLength: 3 }),
});

type BankTx = typeof txArb extends fc.Arbitrary<infer T> ? T : never;
const toBank = (t: BankTx) => ({
  entry_reference: t.ref,
  booking_date: day(t.day),
  transaction_amount: { amount: amountText(t.cents, 2, false), currency: 'EUR' },
  credit_debit_indicator: t.out ? 'DBIT' : 'CRDT',
  status: 'BOOK',
  [t.out ? 'creditor' : 'debtor']: t.name ? { name: t.name } : null,
  remittance_information: t.remittance,
});

describe('mapTransactions', () => {
  it('maps every transaction, signed, with ids unique within a response and stable across responses', () => {
    fc.assert(
      fc.property(fc.array(txArb, { maxLength: 40 }), (generated) => {
        // A record repeated exactly (with a reference) counts once; see below
        const keys = new Set<string>();
        const txs = generated.filter((t) => {
          const key = JSON.stringify(toBank(t));
          if (!t.ref) return true;
          if (keys.has(key)) return false;
          keys.add(key);
          return true;
        });
        const raw = generated.map(toBank);
        const first = mapTransactions(raw, { mappingId: 'm1', currency: 'EUR' });
        const again = mapTransactions(raw, { mappingId: 'm1', currency: 'EUR' });
        expect(first.transactions).toHaveLength(txs.length);
        expect(first.transactions.map((t) => t.amount)).toEqual(
          txs.map((t) => (t.out ? -t.cents : t.cents)),
        );
        const ids = first.transactions.map((t) => t.importedId);
        expect(new Set(ids).size).toBe(ids.length);
        expect(again.transactions.map((t) => t.importedId)).toEqual(ids);
        for (const id of ids) expect(id.startsWith('eb:m1:')).toBe(true);
        for (const t of first.transactions) {
          expect(t.payeeName.length).toBeGreaterThan(0);
          expect(t.payeeName.length).toBeLessThanOrEqual(200);
        }
      }),
    );
  });

  it('counts a record the bank sent twice once, but keeps different ones that share a reference', () => {
    const tx = {
      entry_reference: 'R1',
      booking_date: '2026-04-01',
      transaction_amount: { amount: '3.00' },
      credit_debit_indicator: 'DBIT',
    };
    const { transactions } = mapTransactions(
      [tx, { ...tx }, { ...tx, transaction_amount: { amount: '4.00' } }],
      { mappingId: 'm' },
    );
    expect(transactions.map((t) => t.importedId)).toEqual(['eb:m:R1', 'eb:m:R1#2']);
  });

  it('takes the payee from the other party: the creditor for money out, the debtor for money in', () => {
    const { transactions } = mapTransactions(
      [
        {
          booking_date: '2026-03-02',
          transaction_amount: { amount: '5.00', currency: 'EUR' },
          credit_debit_indicator: 'DBIT',
          creditor: { name: 'Bakery' },
          debtor: { name: 'Me' },
        },
        {
          booking_date: '2026-03-02',
          transaction_amount: { amount: '900.00', currency: 'EUR' },
          credit_debit_indicator: 'CRDT',
          creditor: { name: 'Me' },
          debtor: { name: 'Employer' },
          remittance_information: ['Salary March'],
        },
        {
          booking_date: '2026-03-03',
          transaction_amount: { amount: '3.10', currency: 'EUR' },
          credit_debit_indicator: 'DBIT',
          remittance_information: ['CARD PAYMENT KIOSK'],
        },
      ],
      { mappingId: 'm' },
    );
    expect(transactions.map((t) => [t.payeeName, t.notes])).toEqual([
      ['Bakery', null],
      ['Employer', 'Salary March'],
      ['CARD PAYMENT KIOSK', null],
    ]);
  });

  it('skips and counts records it cannot use, without throwing', () => {
    fc.assert(
      fc.property(fc.array(fc.anything(), { maxLength: 20 }), (junk) => {
        const { transactions, skipped } = mapTransactions(junk, { mappingId: 'm' });
        expect(transactions.length + skipped.noDate + skipped.badAmount).toBeLessThanOrEqual(
          junk.length,
        );
      }),
    );
    const { transactions, skipped } = mapTransactions(
      [
        { transaction_amount: { amount: '1.00' }, credit_debit_indicator: 'DBIT' },
        { booking_date: '2026-02-30', transaction_amount: { amount: '1.00' } },
        { booking_date: '2026-02-03', transaction_amount: { amount: 'n/a' } },
        { booking_date: '2026-02-03', transaction_amount: { amount: '0.00' } },
        { booking_date: '2026-02-03', transaction_amount: { amount: '4.00', currency: 'USD' } },
        { booking_date: '2026-02-03', transaction_amount: { amount: '4.00' }, status: 'PDNG' },
        {
          booking_date: '2026-02-03T10:00:00',
          transaction_amount: { amount: '4.00', currency: 'eur' },
        },
      ],
      { mappingId: 'm', currency: 'EUR' },
    );
    expect(skipped).toEqual({ noDate: 2, badAmount: 2, otherCurrency: 1 });
    expect(transactions.map((t) => t.date)).toEqual(['2026-02-03']);
  });

  it('falls back to the value date, then the transaction date', () => {
    const { transactions } = mapTransactions(
      [
        {
          value_date: '2026-01-05',
          transaction_date: '2026-01-04',
          transaction_amount: { amount: '-1' },
        },
        { transaction_date: '2026-01-04', transaction_amount: { amount: '-1' } },
      ],
      { mappingId: 'm' },
    );
    expect(transactions.map((t) => t.date)).toEqual(['2026-01-05', '2026-01-04']);
  });
});

describe('pickBalance', () => {
  it('prefers a booked balance over an available one', () => {
    expect(
      pickBalance([
        { balance_type: 'CLAV', balance_amount: { amount: '1500.00' } },
        { balance_type: 'ITBD', balance_amount: { amount: '-250.10' } },
      ]),
    ).toBe(-25010);
    expect(pickBalance([{ balance_type: 'XYZ', balance_amount: { amount: '7' } }])).toBe(700);
    expect(pickBalance([{ nonsense: true }])).toBeNull();
    expect(pickBalance([])).toBeNull();
  });
});

describe('consentValidUntil', () => {
  it("never asks for longer than the bank allows, or than PSD2's 180 days", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2040-01-01'), noInvalidDate: true }),
        fc.option(fc.integer({ min: 0, max: 400 * 86_400 }), { nil: null }),
        (now, max) => {
          const until = consentValidUntil(now, max).getTime() - now.getTime();
          expect(until).toBeGreaterThan(0);
          expect(until).toBeLessThanOrEqual(MAX_CONSENT_DAYS * DAY);
          if (max && max * 1000 > 2 * 60 * 60 * 1000) expect(until).toBeLessThanOrEqual(max * 1000);
        },
      ),
    );
  });
});

describe('matchExistingImports', () => {
  const mapped = (date: string, amount: number, ref: string | null = null): MappedTransaction => ({
    importedId: `eb:m:${date}|${amount}|${ref}`,
    date,
    amount,
    payeeName: 'x',
    importedPayee: 'x',
    notes: null,
    ref,
  });

  it('uses each existing row at most once, only within the date window and for the same amount', () => {
    const amounts = fc.constantFrom(-500, -1200, 3000);
    fc.assert(
      fc.property(
        fc.array(fc.record({ day: fc.integer({ min: 0, max: 30 }), amount: amounts }), {
          maxLength: 15,
        }),
        fc.array(
          fc.record({
            day: fc.integer({ min: 0, max: 30 }),
            amount: amounts,
            source: fc.constantFrom(null, 'csv-id', 'eb:m:old', 'eb:other:x', 'plaid:p1'),
          }),
          { maxLength: 15 },
        ),
        fc.boolean(),
        (incoming, existingSpec, keepProviderRows) => {
          const txs = incoming.map((t) => mapped(day(t.day), t.amount));
          const existing: ExistingRow[] = existingSpec.map((e, i) => ({
            id: `row${i}`,
            date: day(e.day),
            amount: e.amount,
            importedId: e.source,
          }));
          const matches = matchExistingImports(txs, existing, { mappingId: 'm', keepProviderRows });
          const used = [...matches.values()];
          expect(new Set(used).size).toBe(used.length);
          for (const [i, id] of matches) {
            const row = existing.find((r) => r.id === id)!;
            expect(row.amount).toBe(txs[i].amount);
            // Never this mapping's own rows, nor another sync's while it still runs
            expect(row.importedId?.startsWith('eb:m:')).not.toBe(true);
            if (keepProviderRows) expect(row.importedId?.startsWith('plaid:')).not.toBe(true);
            const gap = Math.abs(Date.parse(row.date) - Date.parse(txs[i].date)) / DAY;
            expect(gap).toBeLessThanOrEqual(ADOPT_MAX_DAYS);
          }
        },
      ),
    );
  });

  it('matches a CAMT row with the same bank reference exactly, before any close-date match', () => {
    const existing: ExistingRow[] = [
      { id: 'near', date: '2026-05-02', amount: -900, importedId: null },
      { id: 'camt', date: '2026-05-02', amount: -900, importedId: 'camt:2026-05-02|-900|REF7' },
    ];
    const matches = matchExistingImports(
      [mapped('2026-05-02', -900), mapped('2026-05-02', -900, 'REF7')],
      existing,
      { mappingId: 'm' },
    );
    expect(matches.get(1)).toBe('camt');
    expect(matches.get(0)).toBe('near');
  });

  it("recognises an earlier connection's rows by the bank's id, whatever their date", () => {
    const tx = { ...mapped('2026-05-10', -900, 'R1'), importedId: 'eb:new:R1' };
    const existing: ExistingRow[] = [
      { id: 'close', date: '2026-05-10', amount: -900, importedId: null },
      { id: 'old', date: '2026-05-01', amount: -900, importedId: 'eb:old:R1' },
    ];
    expect(matchExistingImports([tx], existing, { mappingId: 'new' }).get(0)).toBe('old');
  });
});

describe('matchReturningAccounts', () => {
  const known = (id: string, extra: Partial<KnownAccount> = {}): KnownAccount => ({
    id,
    identificationHash: null,
    iban: null,
    name: id,
    currency: 'EUR',
    accountId: `acct-${id}`,
    ...extra,
  });
  const back = (uid: string, extra: Partial<ReturningAccount> = {}): ReturningAccount => ({
    uid,
    identificationHash: null,
    iban: null,
    name: uid,
    currency: 'EUR',
    ...extra,
  });

  it('finds accounts by hash, then IBAN, then name and currency', () => {
    const pairs = matchReturningAccounts(
      [known('a', { identificationHash: 'h1' }), known('b', { iban: 'FI1' }), known('c')],
      [back('u1', { identificationHash: 'h1' }), back('u2', { iban: 'FI1' }), back('c')],
    );
    expect(Object.fromEntries(pairs)).toEqual({ u1: 'a', u2: 'b', c: 'c' });
  });

  it('pairs the one missing account with the one new account when the bank changed its ids', () => {
    const pairs = matchReturningAccounts(
      [known('a', { identificationHash: 'h1' }), known('b', { identificationHash: 'old' })],
      [
        back('u1', { identificationHash: 'h1' }),
        back('u2', { identificationHash: 'new', name: 'Renamed' }),
      ],
    );
    expect(Object.fromEntries(pairs)).toEqual({ u1: 'a', u2: 'b' });
    // Not when it's ambiguous, or the currency differs
    expect(
      matchReturningAccounts([known('b')], [back('x', { name: 'X' }), back('y', { name: 'Y' })])
        .size,
    ).toBe(0);
    expect(
      matchReturningAccounts([known('b')], [back('x', { name: 'X', currency: 'SEK' })]).size,
    ).toBe(0);
  });

  it('pairs each account at most once', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            h: fc.constantFrom('h1', 'h2', null),
            iban: fc.constantFrom('A', 'B', null),
          }),
          { maxLength: 6 },
        ),
        fc.array(
          fc.record({
            h: fc.constantFrom('h1', 'h2', null),
            iban: fc.constantFrom('A', 'B', null),
          }),
          { maxLength: 6 },
        ),
        (k, r) => {
          const pairs = matchReturningAccounts(
            k.map((x, i) => known(`k${i}`, { identificationHash: x.h, iban: x.iban })),
            r.map((x, i) => back(`r${i}`, { identificationHash: x.h, iban: x.iban })),
          );
          const ids = [...pairs.values()];
          expect(new Set(ids).size).toBe(ids.length);
        },
      ),
    );
  });
});

describe('state', () => {
  it('round-trips the port for the relay page, and refuses anything else', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65_535 }),
        fc.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        (port, random) => {
          expect(parseState(makeState(port, random))).toEqual({ port, random });
        },
      ),
    );
    for (const bad of [
      '',
      'fb1.0.' + 'a'.repeat(43),
      'fb1.70000.' + 'a'.repeat(43),
      'fb1.80.short',
      'x.80.' + 'a'.repeat(43),
    ]) {
      expect(parseState(bad)).toBeNull();
    }
  });
});

describe('suggestAccountType', () => {
  it('maps ISO cash account types', () => {
    expect(suggestAccountType('CACC')).toBe('checking');
    expect(suggestAccountType('SVGS')).toBe('savings');
    expect(suggestAccountType('CARD')).toBe('credit');
    expect(suggestAccountType(null)).toBe('checking');
  });
});
