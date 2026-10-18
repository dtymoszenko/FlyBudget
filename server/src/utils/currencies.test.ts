import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  CURRENCY_CODES,
  effectiveCurrency,
  isCurrencyCode,
  isForeign,
  minorUnits,
} from './currencies.js';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

describe('currencies', () => {
  it('is the same file as the client copy, and so is money.ts', () => {
    for (const file of ['currencies.ts', 'money.ts']) {
      expect(read(`../../../client/src/utils/${file}`)).toBe(read(`./${file}`));
    }
  });

  it('knows each code once, and the decimals of the ones without two', () => {
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
    expect(CURRENCY_CODES.every((c) => /^[A-Z]{3}$/.test(c))).toBe(true);
    expect([minorUnits('EUR'), minorUnits('JPY'), minorUnits('KWD'), minorUnits(null)]).toEqual([
      2, 0, 3, 2,
    ]);
    expect(isCurrencyCode('PLN')).toBe(true);
    expect(isCurrencyCode('pln')).toBe(false);
  });

  it("treats an account without a currency as in the budget's", () => {
    expect(effectiveCurrency(null, 'EUR')).toBe('EUR');
    expect(isForeign(null, 'EUR')).toBe(false);
    expect(isForeign('EUR', 'EUR')).toBe(false);
    expect(isForeign('USD', 'EUR')).toBe(true);
    expect(isForeign('USD', null)).toBe(false);
  });
});
