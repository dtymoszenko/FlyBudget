import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import en from './locales/en.json';
import i18n, { t } from '.';
import { PSEUDO_CODE, pseudo } from './pseudo';

afterEach(() => {
  void i18n.changeLanguage('en');
  vi.restoreAllMocks();
});

describe('translations', () => {
  it('are English as soon as the module is loaded', () => {
    expect(i18n.language).toBe('en');
    expect(t('settings.preferences.language.title')).toBe('Language');
  });

  it('switch language at once (every language is bundled)', () => {
    void i18n.changeLanguage(PSEUDO_CODE);
    expect(i18n.language).toBe(PSEUDO_CODE);
    expect(t('settings.preferences.language.title')).toBe(pseudo('Language'));
  });

  it('fall back to English for a text a language doesn’t have yet, quietly', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    i18n.addResourceBundle('xx', 'translation', { settings: { preferences: {} } });
    void i18n.changeLanguage('xx');
    expect(t('settings.preferences.language.title')).toBe('Language');
    expect(error).not.toHaveBeenCalled();
  });

  it('report a key English doesn’t have', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // @ts-expect-error: not a key, which is the point
    t('settings.notAKey');
    expect(error).toHaveBeenCalledWith('Missing translation: settings.notAKey');
  });

  it('report a value the text needs that wasn’t passed', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(t('settings.preferences.language.automatic', {} as { language: string })).toBe(
      'Automatic ()',
    );
    expect(error).toHaveBeenCalledOnce();
  });

  it('write counts as the device writes numbers, singular for one', () => {
    fc.assert(
      fc.property(fc.nat({ max: 10_000_000 }), (count) => {
        expect(t('goals.group.count', { count })).toBe(
          count === 1 ? '1 goal' : `${count.toLocaleString()} goals`,
        );
      }),
    );
  });
});

/** Every English text without values or tags, by key */
const flat = (o: object, prefix = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'string' ? [[prefix + k, v] as [string, string]] : flat(v, `${prefix}${k}.`),
  );
const plainTexts = flat(en).filter(
  ([key, text]) => !/[{<]/.test(text) && !/_(one|other|two|few|zero|many)$/.test(key),
);

describe('every text', () => {
  it('is the English in en.json, whichever languages were shown before', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...plainTexts),
        fc.array(fc.constantFrom('en', PSEUDO_CODE)),
        ([key, text], switches) => {
          for (const language of switches) void i18n.changeLanguage(language);
          const shown = i18n.t(key as never);
          expect(shown).toBe(i18n.language === PSEUDO_CODE ? pseudo(text) : text);
        },
      ),
    );
  });
});
