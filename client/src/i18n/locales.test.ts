import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import { LANGUAGES } from './languages';

// Every translation has every English text, in the plural forms its own language needs, with
// the same {{values}} and <tags>, and nothing left empty

type Texts = Map<string, string>;
const flat = (o: object, prefix = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'string' ? [[prefix + k, v] as [string, string]] : flat(v, `${prefix}${k}.`),
  );

const CARDINAL = /_(zero|one|two|few|many|other)$/;
const ORDINAL = /_ordinal_(zero|one|two|few|many|other)$/;

/** {{values}} and <tags> in a text, without the count (a language may leave it out of "one") */
const tokens = (text: string) =>
  [...text.matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}|<\/?([A-Za-z][A-Za-z0-9]*)\s*\/?>/g)]
    .map((m) => m[0].replace(/\s+/g, ''))
    .filter((t) => !/^\{\{count[,}]/.test(t))
    .sort();

/** The keys a language must have, each with the English text it translates */
function expectedKeys(code: string, english: Texts): Texts {
  const cardinal = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
  const ordinal = new Intl.PluralRules(code, { type: 'ordinal' }).resolvedOptions()
    .pluralCategories;
  const keys: Texts = new Map();
  for (const [key, text] of english) {
    if (ORDINAL.test(key)) {
      const base = key.replace(ORDINAL, '');
      for (const c of ordinal)
        keys.set(`${base}_ordinal_${c}`, english.get(`${base}_ordinal_other`)!);
    } else if (CARDINAL.test(key)) {
      const base = key.replace(CARDINAL, '');
      for (const c of cardinal) keys.set(`${base}_${c}`, english.get(`${base}_other`)!);
    } else {
      keys.set(key, text);
    }
  }
  return keys;
}

const english: Texts = new Map(flat(en));
const translations = LANGUAGES.filter((l) => l.code !== 'en');

describe('translations', () => {
  it('start from English, which has every text', () => {
    expect(english.size).toBeGreaterThan(0);
    for (const [key, text] of english) expect(text.trim(), key).not.toBe('');
  });

  for (const language of translations) {
    describe(language.name, () => {
      const texts: Texts = new Map(flat(language.resources));
      const expected = expectedKeys(language.code, english);

      it('has every text, and nothing English doesn’t', () => {
        expect([...expected.keys()].filter((k) => !texts.has(k))).toEqual([]);
        expect([...texts.keys()].filter((k) => !expected.has(k))).toEqual([]);
      });

      it('keeps the {{values}} and <tags> of each text', () => {
        const differ = [...expected]
          .filter(([key]) => texts.has(key))
          .filter(([key, source]) => tokens(texts.get(key)!).join() !== tokens(source).join())
          .map(([key]) => key);
        expect(differ).toEqual([]);
      });

      it('leaves no text empty or with spaces at its ends', () => {
        const bad = [...texts].filter(([, t]) => !t.trim() || t !== t.trim()).map(([k]) => k);
        expect(bad).toEqual([]);
      });
    });
  }
});
