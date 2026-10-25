import { afterEach, describe, expect, it, vi } from 'vitest';

// currency.ts reads the device's language once per module, so each language gets a fresh import
async function inLanguage(language: string) {
  vi.stubGlobal('navigator', { language });
  vi.resetModules();
  const { CURRENCY_CODES } = await import('./currencies');
  const { currencyAmountStyle, formatAmount } = await import('./currency');
  const prefs = { amountFormat: 'dot', symbolPosition: 'auto', currencySymbol: '$' } as const;
  return {
    CURRENCY_CODES,
    format: (cents: number, code: string) =>
      formatAmount(cents, currencyAmountStyle(code, prefs, null)),
  };
}

describe('currency symbols on devices in other languages', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts a space between a currency code and the amount (#151)', async () => {
    let { format } = await inLanguage('es-419');
    // formatAmount joins them with a no-break space
    expect(format(123_456, 'USD')).toBe('USD 1,234.56');
    expect(format(123_456, 'BRL')).toBe('R$ 1,234.56');
    ({ format } = await inLanguage('es-UY'));
    expect(format(123_456, 'USD')).toBe('US$1,234.56');
    ({ format } = await inLanguage('en-US'));
    expect(format(123_456, 'USD')).toBe('$1,234.56');
  });

  it('puts a space after a typed symbol made of letters when the budget has no currency', async () => {
    vi.resetModules();
    const { currencyAmountStyle, formatAmount } = await import('./currency');
    const prefs = { amountFormat: 'dot', symbolPosition: 'before', currencySymbol: 'CHF' } as const;
    expect(formatAmount(1250, currencyAmountStyle(null, prefs, null))).toBe('CHF 12.50');
    const dollar = { ...prefs, currencySymbol: '$' };
    expect(formatAmount(1250, currencyAmountStyle(null, dollar, null))).toBe('$12.50');
  });

  it.each(['es-419', 'es-UY', 'en-US', 'de-CH', 'fr-FR', 'pl-PL', 'ja-JP', 'ar-EG'])(
    'never writes a letter of the symbol right next to a digit in %s',
    async (language) => {
      const { CURRENCY_CODES, format } = await inLanguage(language);
      for (const code of CURRENCY_CODES) {
        expect(format(123_456, code)).not.toMatch(/\p{L}\d|\d\p{L}/u);
      }
    },
  );
});
