import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREFERENCES_VERSION, migratePreferences } from './preferencesStore';

/** The store as it loads from this storage (a fresh module each time) */
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

describe('migratePreferences', () => {
  it('keeps 1,234.56 with the symbol first for installs from before the amount format', () => {
    expect(migratePreferences({ currencySymbol: '€', theme: 'dark' }, 0)).toEqual({
      currencySymbol: '€',
      theme: 'dark',
      amountFormat: 'dot',
      symbolPosition: 'before',
      language: 'en',
    });
  });

  it('keeps English for installs from before the language setting', () => {
    expect(migratePreferences({ amountFormat: 'auto', theme: 'dark' }, 1)).toEqual({
      amountFormat: 'auto',
      theme: 'dark',
      language: 'en',
    });
  });

  it('leaves preferences saved by this version alone', () => {
    const saved = { amountFormat: 'auto', symbolPosition: 'after', currencySymbol: '€' };
    expect(migratePreferences(saved, PREFERENCES_VERSION)).toEqual(saved);
  });

  it('copes with nothing usable saved', () => {
    expect(migratePreferences(null, 0)).toEqual({
      amountFormat: 'dot',
      symbolPosition: 'before',
      language: 'en',
    });
  });
});

describe('payeeSort', () => {
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

describe('language', () => {
  it('follows the device on a new install', async () => {
    expect((await loadStore(new Map())).getState().language).toBe('auto');
  });

  it('stays English on an install saved before the setting existed', async () => {
    const items = new Map([
      ['budget-preferences', JSON.stringify({ state: { theme: 'dark' }, version: 1 })],
    ]);
    const store = await loadStore(items);
    expect(store.getState()).toMatchObject({ theme: 'dark', language: 'en' });
  });

  it('remembers the chosen language', async () => {
    const items = new Map<string, string>();
    (await loadStore(items)).getState().setLanguage('en');
    expect((await loadStore(items)).getState().language).toBe('en');
  });
});
