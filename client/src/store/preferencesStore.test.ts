import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('payeeSort', () => {
  async function loadStore(items: Map<string, string>) {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    });
    vi.resetModules();
    const { usePreferencesStore } = await import('./preferencesStore');
    return usePreferencesStore;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('starts at Name A–Z for installs saved before the payee sort existed', async () => {
    const items = new Map([
      [
        'budget-preferences',
        JSON.stringify({ state: { theme: 'dark' }, version: PREFERENCES_VERSION }),
      ],
    ]);
    const store = await loadStore(items);
    expect(store.getState().theme).toBe('dark');
    expect(store.getState().payeeSort).toEqual({ key: 'name', dir: 'asc' });
  });

  it('remembers the chosen sort', async () => {
    const items = new Map<string, string>();
    (await loadStore(items)).getState().setPayeeSort({ key: 'transactions', dir: 'desc' });
    expect((await loadStore(items)).getState().payeeSort).toEqual({
      key: 'transactions',
      dir: 'desc',
    });
  });
});
