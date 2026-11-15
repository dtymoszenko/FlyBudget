// A made-up language for development, never shipped (see languages.ts): English with every
// letter accented, longer, and in ⟦brackets⟧. Text still in plain English wasn't translated,
// and text that runs over or is cut off shows where a longer language won't fit.
import type { Locale } from 'date-fns';

export const PSEUDO_CODE = 'en-XA';

const PLAIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ACCENTED = [...'áƀçđéƒĝĥíĵķĺɱñóþǫŕšţúṽŵẋýž', ...'ÁƁÇĐÉƑĜĤÍĴĶĹṀÑÓÞǪŔŠŢÚṼŴẊÝŽ'];
// Made on first use, so a production build (where nothing uses it) leaves it all out
let accent: Map<string, string> | undefined;
const accented = (c: string) =>
  (accent ??= new Map([...PLAIN].map((p, i) => [p, ACCENTED[i]!]))).get(c) ?? c;

/** What translations must keep as they are: {{values}}, <tags>, </tags>, <tags/> and $t() */
export const TOKEN = /(\{\{[^}]*\}\}|<\/?[A-Za-z][A-Za-z0-9]*\s*\/?>|\$t\([^)]*\))/;

/**
 * Translations grow most in short text ("Add" is "Toevoegen" in Dutch): +100% up to 10
 * characters, +60% up to 30, +40% beyond. In short text the extra goes on the last word, as a
 * long compound word would; longer text gets more words instead, so it can still wrap.
 */
export function pseudoExtra(length: number): number {
  return Math.ceil(length * (length <= 10 ? 1 : length <= 30 ? 0.6 : 0.4));
}

/** One text in the pseudo-language: "Add {{name}}" becomes "⟦Áđđ {{name}}~~~~⟧" */
export function pseudo(text: string): string {
  if (!text) return text;
  let length = 0;
  const parts = text.split(TOKEN).map((part, i) => {
    if (i % 2 === 1) return part; // a token
    length += part.length;
    return part.replace(/[A-Za-z]/g, accented);
  });
  const extra = Array.from({ length: pseudoExtra(length) }, (_, i) =>
    length > 30 && i % 7 === 0 ? ' ' : '~',
  ).join('');
  return `⟦${parts.join('')}${extra}⟧`;
}

/** Every text of a translation file in the pseudo-language */
export function pseudoResources<T>(resources: T): T {
  if (typeof resources === 'string') return pseudo(resources) as T;
  if (resources && typeof resources === 'object') {
    return Object.fromEntries(
      Object.entries(resources).map(([key, value]) => [key, pseudoResources(value)]),
    ) as T;
  }
  return resources;
}

/** Month and day names in the pseudo-language too */
export function pseudoDateLocale(base: Locale): Locale {
  const { localize } = base;
  return {
    ...base,
    code: PSEUDO_CODE,
    localize: {
      ...localize,
      month: (month, options) => pseudo(localize.month(month, options)),
      day: (day, options) => pseudo(localize.day(day, options)),
    },
  };
}
