import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  availableLanguages,
  resolveLanguage,
  type Language,
  type LanguagePreference,
} from './languages';
import { PSEUDO_CODE } from './pseudo';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// A second language (English texts under another code), so the device's languages matter
const english = availableLanguages().find((l) => l.code === 'en')!;
const LANGUAGES: readonly Language[] = [
  ...availableLanguages(),
  { ...english, code: 'nl', name: 'Nederlands' },
];

/** The app's language module with a fresh preferences store, on a device in `languages` */
async function load(languages: string[]) {
  vi.doMock('./languages', async (importOriginal) => {
    const real = await importOriginal<typeof import('./languages')>();
    return {
      ...real,
      availableLanguages: () => LANGUAGES,
      languageInfo: (code: string) => LANGUAGES.find((l) => l.code === code) ?? english,
      resolveLanguage: (preference: LanguagePreference, device: readonly string[]) =>
        real.resolveLanguage(preference, device, LANGUAGES),
    };
  });
  const items = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  });
  const device = { languages, language: languages[0] };
  vi.stubGlobal('navigator', device);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { documentElement: { lang: '' } });
  const { initLanguage, appliedLanguage, onLanguageApplied } = await import('./applyLanguage');
  const { usePreferencesStore } = await import('../store/preferencesStore');
  initLanguage();
  const changes = vi.fn();
  onLanguageApplied(changes);
  return { appliedLanguage, changes, device, store: usePreferencesStore };
}

const devices = fc.constantFrom<string[]>(
  ['en-US'],
  ['de-DE', 'en'],
  ['nl-NL'],
  ['fr'],
  ['en-GB', 'nl'],
);
const step = fc.oneof(
  fc.record({
    kind: fc.constant('language' as const),
    language: fc.constantFrom('auto', 'en', 'nl', PSEUDO_CODE) as fc.Arbitrary<LanguagePreference>,
  }),
  fc.record({ kind: fc.constant('theme' as const), theme: fc.constantFrom('light', 'dark') }),
  // The device's languages change; `announce`: the browser fires languagechange
  fc.record({ kind: fc.constant('device' as const), languages: devices, announce: fc.boolean() }),
);

describe('the language the app is shown in', () => {
  it('follows the preference and announced device changes, nothing else', async () => {
    await fc.assert(
      fc.asyncProperty(devices, fc.array(step, { maxLength: 12 }), async (start, steps) => {
        vi.resetModules();
        const { appliedLanguage, changes, device, store } = await load(start);
        // What the app should show: the preference with the device's languages as last announced
        let preference: LanguagePreference = 'auto';
        let announced = start;
        let expected = resolveLanguage(preference, announced, LANGUAGES);
        let expectedChanges = 0;
        expect(appliedLanguage()).toBe(expected);

        for (const s of steps) {
          // Choosing another language looks at the device's languages again; the same one doesn't
          if (s.kind === 'language' && s.language !== preference) announced = device.languages;
          if (s.kind === 'language') {
            preference = s.language;
            store.getState().setLanguage(s.language);
          } else if (s.kind === 'theme') {
            store.getState().setTheme(s.theme as 'light' | 'dark');
          } else {
            device.languages = s.languages;
            if (s.announce) {
              announced = s.languages;
              window.dispatchEvent(new Event('languagechange'));
            }
          }
          const next = resolveLanguage(preference, announced, LANGUAGES);
          if (next !== expected) expectedChanges++;
          expected = next;
          expect(appliedLanguage()).toBe(expected);
          expect(document.documentElement.lang).toBe(expected);
          expect(changes).toHaveBeenCalledTimes(expectedChanges);
        }
      }),
      { numRuns: 60 },
    );
  });

  it("doesn't change (or draw the app again) when another setting does", async () => {
    const { appliedLanguage, changes, store } = await load(['en-US']);
    store.getState().setTheme('dark');
    store.getState().setSidebarMode('auto-hide');
    expect(appliedLanguage()).toBe('en');
    expect(changes).not.toHaveBeenCalled();
  });
});
