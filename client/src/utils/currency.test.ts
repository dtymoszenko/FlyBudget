import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  amountPlaceholder,
  amountStyle,
  currencyConvention,
  amountToInput,
  formatAmount,
  formatAxisAmount,
  localeAmountStyle,
  isUnreadableAmount,
  parseAmount,
  type AmountStyle,
} from './currency';
import type { AmountFormat } from '../store/preferencesStore';

// Up to ±$10 billion, far beyond any real balance but still exact in a double
const arbCents = fc.integer({ min: -10_000_000_000_00, max: 10_000_000_000_00 });

const FORMATS: AmountFormat[] = ['dot', 'comma', 'space', 'apostrophe'];
const US: AmountStyle = { format: 'dot', position: 'before', symbol: '$' };

const arbStyle = fc.record<AmountStyle>({
  format: fc.constantFrom(...FORMATS),
  position: fc.constantFrom('before', 'after'),
  // S/, D, C and H are also debit/credit words in bank files: typed amounts must not read them so
  symbol: fc.constantFrom(
    '$',
    '€',
    '£',
    'kr',
    'kr.',
    'CHF',
    'zł',
    'Kč',
    'Fr.',
    'S/',
    'D',
    'C',
    'H',
    'R$',
  ),
});

// Undo formatCurrency's formatting by hand (not with parseCents) to get cents back
const unformat = (s: string, style: AmountStyle) => {
  const negative = s.startsWith('-');
  const decimal = style.format === 'dot' || style.format === 'apostrophe' ? '.' : ',';
  const number = s.replace(style.symbol, '').replace(/[^\d.,]/g, '');
  const [whole, fraction = '00'] = number.split(decimal);
  const cents = Number(whole.replace(/[.,]/g, '')) * 100 + Number(fraction);
  return negative ? -cents : cents;
};

describe('currency helpers (property-based)', () => {
  it('parseAmount(amountToInput(c)) gives back the absolute amount, in every format', () => {
    fc.assert(
      fc.property(arbCents, arbStyle, (cents, style) => {
        expect(parseAmount(amountToInput(cents, style), style)).toBe(Math.abs(cents));
      }),
    );
  });

  it('parseCents reads what formatCurrency writes, in every format', () => {
    fc.assert(
      fc.property(arbCents, arbStyle, (cents, style) => {
        expect(parseAmount(formatAmount(cents, style), style)).toBe(cents);
      }),
    );
  });

  it('reads a decimal point or comma with one or two digits after it the same in any format', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 99_999_999_999 }), // the server takes up to 100 billion
        fc.nat({ max: 99 }),
        fc.constantFrom('.', ','),
        fc.boolean(),
        arbStyle,
        (dollars, cc, sep, short, style) => {
          // 12.50 or 12,50, and 12.5 when the cents are a round ten
          const cents = String(cc).padStart(2, '0');
          const s = `${dollars}${sep}${short && cents.endsWith('0') ? cents[0] : cents}`;
          expect(parseAmount(s, style)).toBe(dollars * 100 + cc);
        },
      ),
    );
  });

  it('reads three digits after one separator as the format says', () => {
    const comma: AmountStyle = { ...US, format: 'comma' };
    expect(parseAmount('1.234', comma)).toBe(123_400);
    expect(parseAmount('1.234', US)).toBe(123);
    expect(parseAmount('1,234', US)).toBe(123_400);
    expect(parseAmount('1.234,56', comma)).toBe(123_456);
    expect(parseAmount('1 234,56', { ...US, format: 'space' })).toBe(123_456);
    expect(parseAmount("1'234.56", { ...US, format: 'apostrophe' })).toBe(123_456);
    expect(parseAmount('-12,50', comma)).toBe(-1250);
  });

  it('reads an amount with both separators by the last one, in any format', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }),
        fc.integer({ min: 0, max: 999 }),
        fc.nat({ max: 99 }),
        arbStyle,
        (thousands, units, cc, style) => {
          const groups = `${thousands}${String(units).padStart(3, '0')}`;
          const cents = Number(groups) * 100 + cc;
          const fraction = String(cc).padStart(2, '0');
          const [t, u] = [String(thousands), String(units).padStart(3, '0')];
          expect(parseAmount(`${t}.${u},${fraction}`, style)).toBe(cents);
          expect(parseAmount(`${t},${u}.${fraction}`, style)).toBe(cents);
        },
      ),
    );
  });

  it('never reads a symbol after the amount as a debit or credit, and ignores a dotted symbol', () => {
    const comma: AmountStyle = { format: 'comma', position: 'after', symbol: 'kr.' };
    expect(parseAmount('12.50 kr.', comma)).toBe(1250);
    expect(parseAmount('12,50 kr.', comma)).toBe(1250);
    // The symbol without its dot: the dot typed after it isn't a separator either
    expect(parseAmount('12,50 kr.', { ...comma, symbol: 'kr' })).toBe(1250);
    expect(parseAmount('Fr. 12.50', { ...US, symbol: 'Fr' })).toBe(1250);
    expect(
      parseAmount('CHF 1’234.50', { format: 'apostrophe', position: 'before', symbol: 'CHF' }),
    ).toBe(123_450);
    for (const symbol of ['S/', 'D', 'C', 'H', 'S', 's']) {
      const style: AmountStyle = { format: 'comma', position: 'after', symbol };
      expect(parseAmount(`12,50 ${symbol}`, style)).toBe(1250);
      expect(parseAmount(`-12,50 ${symbol}`, style)).toBe(-1250);
    }
    // Typed amounts ignore DR/CR too: the sign is what was typed
    expect(parseAmount('45.00 DR', US)).toBe(4500);
  });

  it('tells text that is no amount apart from an empty field', () => {
    for (const ok of ['', '  ', '0', '12', '12,50', '-3', '$1,234.56', '1.234,56 €']) {
      expect(isUnreadableAmount(ok, US)).toBe(false);
    }
    for (const bad of ['abc', '-', '.', '12.5.0', '1,2,3.4.5', '1.2.3,4,5']) {
      expect(isUnreadableAmount(bad, US)).toBe(true);
    }
  });

  it('takes amounts up to the server limit of 100 billion', () => {
    expect(parseAmount('100000000000.00', US)).toBe(10_000_000_000_000);
    expect(parseAmount('100000000000.01', US)).toBe(0);
  });

  it('always returns a finite integer, and 0 for text that is no amount', () => {
    fc.assert(
      fc.property(
        // Arbitrary text plus number-like strings, including exponents such as "1e400"
        fc.oneof(
          fc.string(),
          fc.double().map(String),
          fc.double().map((d) => d.toExponential()),
        ),
        arbStyle,
        (s, style) => {
          expect(Number.isSafeInteger(parseAmount(s, style))).toBe(true);
        },
      ),
    );
    for (const junk of ['', 'abc', '.', ',', '-', '1.2.3,4,5'])
      expect(parseAmount(junk, US)).toBe(0);
  });

  it('formatCurrency writes each format, with 0 or 2 decimals', () => {
    fc.assert(
      fc.property(arbCents, arbStyle, (cents, style) => {
        const s = formatAmount(cents, style);
        expect(unformat(s, style)).toBe(cents);
        expect(s.startsWith('-')).toBe(cents < 0);
        if (style.position === 'after') expect(s.endsWith(` ${style.symbol}`)).toBe(true);
        else expect(s.replace('-', '').startsWith(style.symbol)).toBe(true);
      }),
    );
    expect(formatAmount(-123_456, US)).toBe('-$1,234.56');
    expect(formatAmount(-123_456, { format: 'comma', position: 'after', symbol: '€' })).toBe(
      '-1.234,56 €',
    );
    expect(formatAmount(123_400, { format: 'space', position: 'after', symbol: '€' })).toBe(
      '1 234 €',
    );
    expect(formatAmount(123_456, { format: 'apostrophe', position: 'before', symbol: 'CHF' })).toBe(
      "CHF1'234.56",
    );
  });

  it('uses the preferences when no style is given', () => {
    expect(
      amountStyle({ amountFormat: 'comma', symbolPosition: 'after', currencySymbol: '' }),
    ).toEqual({ format: 'comma', position: 'after', symbol: '$', space: false });
  });
});

describe('localeAmountStyle', () => {
  it.each([
    ['en-US', 'dot', 'before'],
    ['de-DE', 'comma', 'after'],
    ['fr-FR', 'space', 'after'],
    ['de-CH', 'apostrophe', 'before'],
    ['nl-NL', 'comma', 'before'],
    ['not a language!', 'dot', 'before'],
  ])('%s', (locale, format, position) => {
    expect(localeAmountStyle(locale)).toEqual({ format, position });
  });
});

// Undo formatCentsAxis's "-$1.5M" formatting to get dollars back
const unformatAxis = (s: string) => {
  const m = /^(-?)\$(\d+(?:\.\d)?)([kM]?)$/.exec(s);
  if (!m) throw new Error(`unexpected axis label ${s}`);
  const scale = m[3] === 'M' ? 1_000_000 : m[3] === 'k' ? 1_000 : 1;
  return (m[1] ? -1 : 1) * Number(m[2]) * scale;
};

describe('formatCentsAxis (property-based)', () => {
  it('reads back within rounding of the real amount, with the right sign', () => {
    fc.assert(
      fc.property(arbCents, (cents) => {
        const s = formatAxisAmount(cents, US);
        const dollars = cents / 100;
        const back = unformatAxis(s);
        // One decimal of k/M is at most 5% off; whole dollars at most $0.50
        expect(Math.abs(back - dollars)).toBeLessThanOrEqual(
          Math.max(0.5, Math.abs(dollars) * 0.05) + 1e-6,
        );
        if (Math.abs(dollars) >= 0.5) expect(s.startsWith('-')).toBe(cents < 0);
      }),
    );
  });

  it('labels whole thousands and millions exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999 }), fc.integer({ min: 1, max: 5000 }), (k, m) => {
        expect(formatAxisAmount(k * 1_000_00, US)).toBe(`$${k}k`);
        expect(formatAxisAmount(m * 1_000_000_00, US)).toBe(`$${m}M`);
        expect(formatAxisAmount(-k * 1_000_00, US)).toBe(`-$${k}k`);
      }),
    );
  });

  it('writes the decimal comma and the symbol after where the format says', () => {
    const style: AmountStyle = { format: 'comma', position: 'after', symbol: '€' };
    expect(formatAxisAmount(1_250_000, style)).toBe('12,5k €');
    expect(formatAxisAmount(-150_000_000, style)).toBe('-1,5M €');
  });

  it('gives each distinct nice tick a distinct label', () => {
    // Axis ticks are multiples of a step like 25k or 50k; labels must never repeat
    const ticks = [0, 35_000, 70_000, 100_000, 135_000, 250_000, 1_000_000, 1_500_000];
    const labels = ticks.map((d) => formatAxisAmount(d * 100, US));
    expect(new Set(labels).size).toBe(ticks.length);
  });
});

describe('amounts in other currencies', () => {
  const arbMinorStyle = arbStyle.chain((style) =>
    fc.record({
      style: fc.constant(style),
      minor: fc.constantFrom(0, 2, 3),
      space: fc.boolean(),
    }),
  );

  it('formats and reads back every amount, with 0, 2 or 3 decimals and the symbol on either side', () => {
    fc.assert(
      fc.property(arbCents, arbMinorStyle, (cents, { style, minor, space }) => {
        const s: AmountStyle = { ...style, minor, space };
        expect(parseAmount(formatAmount(cents, s), s)).toBe(cents);
        expect(parseAmount(amountToInput(cents, s), s)).toBe(Math.abs(cents));
      }),
    );
  });

  it('writes each currency its own way', () => {
    const pln: AmountStyle = { format: 'space', position: 'after', symbol: 'zł', minor: 2 };
    expect(formatAmount(-123_456, pln)).toBe('-1 234,56 zł');
    const chf: AmountStyle = {
      format: 'apostrophe',
      position: 'before',
      symbol: 'CHF',
      space: true,
    };
    expect(formatAmount(1250, chf)).toBe('CHF 12.50');
    const yen: AmountStyle = { format: 'dot', position: 'before', symbol: '¥', minor: 0 };
    expect(formatAmount(1_500, yen)).toBe('¥1,500');
    expect(amountPlaceholder(yen)).toBe('0');
    const kwd: AmountStyle = { format: 'dot', position: 'after', symbol: 'KWD', minor: 3 };
    expect(formatAmount(12_345, kwd)).toBe('12.345 KWD');
    expect(amountPlaceholder(kwd)).toBe('0.000');
    expect(parseAmount('12.345', kwd)).toBe(12_345);
  });

  it("doesn't read decimals a currency doesn't have, and reads its grouping", () => {
    const yen: AmountStyle = { format: 'dot', position: 'before', symbol: '¥', minor: 0 };
    expect(isUnreadableAmount('12.5', yen)).toBe(true);
    expect(parseAmount('1.234', yen)).toBe(1_234);
    expect(parseAmount('1,234', yen)).toBe(1_234);
    expect(parseAmount('1.234.567', yen)).toBe(1_234_567);
    expect(parseAmount('¥1,500', yen)).toBe(1_500);
  });

  it("puts each currency's symbol where its country does", () => {
    expect(currencyConvention('PLN')).toEqual({ position: 'after', space: true });
    expect(currencyConvention('USD')).toEqual({ position: 'before', space: false });
    expect(currencyConvention('BRL')).toEqual({ position: 'before', space: true });
    expect(currencyConvention('SEK').position).toBe('after');
  });
});
