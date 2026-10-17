import { describe, expect, it } from 'vitest';
import { PREFERENCES_VERSION, migratePreferences } from './preferencesStore';

describe('migratePreferences', () => {
  it('keeps 1,234.56 with the symbol first for installs from before the amount format', () => {
    expect(migratePreferences({ currencySymbol: '€', theme: 'dark' }, 0)).toEqual({
      currencySymbol: '€',
      theme: 'dark',
      amountFormat: 'dot',
      symbolPosition: 'before',
    });
  });

  it('leaves preferences saved by this version alone', () => {
    const saved = { amountFormat: 'auto', symbolPosition: 'after', currencySymbol: '€' };
    expect(migratePreferences(saved, PREFERENCES_VERSION)).toEqual(saved);
  });

  it('copes with nothing usable saved', () => {
    expect(migratePreferences(null, 0)).toEqual({ amountFormat: 'dot', symbolPosition: 'before' });
  });
});
