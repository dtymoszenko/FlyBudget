// The languages FlyBudget can be shown in, and which one a device gets.
import type { Locale } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import en from './locales/en.json';
import { PSEUDO_CODE, pseudoDateLocale, pseudoResources } from './pseudo';

export interface Language {
  /** BCP 47: for i18next, <html lang> and Intl */
  code: string;
  /** In the language itself, never translated: "English", "Nederlands" */
  name: string;
  /** Month and day names, for date-fns */
  dateLocale: Locale;
  resources: object;
  /** Complete: offered in Settings and chosen by Automatic */
  listed: boolean;
}

export const FALLBACK_LANGUAGE = 'en';

export const LANGUAGES = [
  { code: 'en', name: 'English', dateLocale: enUS, resources: en, listed: true },
] as const satisfies readonly Language[];

export type LanguageCode = (typeof LANGUAGES)[number]['code'];
/** The Language preference: 'auto' follows the device */
export type LanguagePreference = 'auto' | LanguageCode | typeof PSEUDO_CODE;

// The pseudo-language (pseudo.ts) exists in development and in builds made to check
// translations (VITE_I18N_PSEUDO=1). Elsewhere this is false at build time, so it's left out.
const PSEUDO_ENABLED = import.meta.env.DEV || import.meta.env.VITE_I18N_PSEUDO === '1';

let available: readonly Language[] | undefined;

/** The languages this build can show: the listed ones, and the pseudo-language when enabled */
export function availableLanguages(): readonly Language[] {
  if (!available) {
    const listed: Language[] = LANGUAGES.filter((l) => l.listed);
    available = PSEUDO_ENABLED
      ? [
          ...listed,
          {
            code: PSEUDO_CODE,
            name: 'Pseudo (en-XA)',
            dateLocale: pseudoDateLocale(enUS),
            resources: pseudoResources(en),
            listed: false,
          },
        ]
      : listed;
  }
  return available;
}

/** The device's languages, most preferred first */
export function deviceLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

/** "nl" for "nl-BE"; undefined for something that isn't a language tag */
function baseLanguage(tag: string): string | undefined {
  try {
    return new Intl.Locale(tag).language;
  } catch {
    return undefined;
  }
}

/**
 * The language to show: the one chosen, if this build has it; for Automatic, the first of
 * the device's languages that's listed; otherwise English.
 */
export function resolveLanguage(
  preference: string | undefined,
  device: readonly string[],
  languages: readonly Language[] = availableLanguages(),
): string {
  if (preference && preference !== 'auto') {
    return languages.some((l) => l.code === preference) ? preference : FALLBACK_LANGUAGE;
  }
  for (const tag of device) {
    const base = baseLanguage(tag);
    const match = languages.find((l) => l.listed && l.code === base);
    if (match) return match.code;
  }
  return FALLBACK_LANGUAGE;
}

/** A language this build has, English if it doesn't */
export function languageInfo(code: string): Language {
  return availableLanguages().find((l) => l.code === code) ?? LANGUAGES[0];
}
