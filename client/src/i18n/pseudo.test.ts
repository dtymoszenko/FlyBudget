import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { format } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { TOKEN, pseudo, pseudoDateLocale, pseudoExtra, pseudoResources } from './pseudo';

const word = fc.string({ unit: fc.constantFrom(...'abcXYZ 1.,!?'), maxLength: 12 });
const token = fc.constantFrom('{{name}}', '{{count, number}}', '<link>', '</link>', '<brand/>');
// Text and tokens in any order, like a translation
const text = fc.array(fc.oneof(word, token), { maxLength: 6 }).map((parts) => parts.join(''));

const tokensOf = (s: string) => s.split(TOKEN).filter((_, i) => i % 2 === 1);
const textOf = (s: string) =>
  s
    .split(TOKEN)
    .filter((_, i) => i % 2 === 0)
    .join('');

describe('the pseudo-language (property-based)', () => {
  it('keeps every value and tag exactly, in order', () => {
    fc.assert(
      fc.property(text, (s) => {
        expect(tokensOf(pseudo(s))).toEqual(tokensOf(s));
      }),
    );
  });

  it('leaves no plain English letter outside them', () => {
    fc.assert(
      fc.property(text, (s) => {
        expect(textOf(pseudo(s))).not.toMatch(/[A-Za-z]/);
      }),
    );
  });

  it('wraps the text in brackets, made longer by pseudoExtra', () => {
    fc.assert(
      fc.property(text, (s) => {
        if (!s) return;
        const shown = pseudo(s);
        expect(shown.startsWith('⟦') && shown.endsWith('⟧')).toBe(true);
        const length = textOf(s).length;
        expect([...textOf(shown)].length).toBe(length + pseudoExtra(length) + 2);
      }),
    );
  });

  it('grows short text the most', () => {
    expect(pseudoExtra(3)).toBe(3);
    expect(pseudoExtra(20)).toBe(12);
    expect(pseudoExtra(100)).toBe(40);
    expect(pseudo('Add')).toBe('⟦Áđđ~~~⟧');
    expect(pseudo('')).toBe('');
  });

  it('turns every text of a file into the pseudo-language', () => {
    expect(pseudoResources({ a: 'Save', b: { c: 'Delete {{name}}' } })).toEqual({
      a: pseudo('Save'),
      b: { c: pseudo('Delete {{name}}') },
    });
  });

  it('has month and day names in it too', () => {
    const locale = pseudoDateLocale(enUS);
    const shown = format(new Date(2026, 0, 5), 'EEE, MMM d', { locale });
    expect(shown).toBe(`${pseudo('Mon')}, ${pseudo('Jan')} 5`);
  });
});
