// Translations (react-i18next). The texts are in locales/*.json, English is the fallback, and
// every language is bundled: nothing is fetched, so offline, the desktop app and the demo work
// the same. Components use `useTranslation()`; other code imports `t` from here, and calls it
// while rendering, never when a module loads (the language isn't known yet then).
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { FALLBACK_LANGUAGE, availableLanguages } from './languages';

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(
    availableLanguages().map((l) => [l.code, { translation: l.resources }]),
  ),
  lng: FALLBACK_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  initAsync: false,
  // "" in a translation means not translated yet: English shows instead
  returnEmptyString: false,
  // React escapes what it renders
  interpolation: { escapeValue: false },
  // Mistakes in the code show in the console (and fail the e2e tests): a key English doesn't
  // have, or a value the text needs that wasn't passed
  saveMissing: true,
  missingKeyHandler: (_languages, _namespace, key) => console.error(`Missing translation: ${key}`),
  missingInterpolationHandler: (text, value: string[]) => {
    console.error(`Missing value ${value[0]} for "${text}"`);
    return '';
  },
  react: { useSuspense: false },
});

// {{count, number}}: counts written as the device writes numbers, as toLocaleString() did
i18n.services.formatter?.add('number', (value: unknown) =>
  typeof value === 'number' ? value.toLocaleString() : String(value),
);

export default i18n;
export { t } from 'i18next';
