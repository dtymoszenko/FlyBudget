// Shows the app in the language of the Language preference (like applyTheme.ts for the theme).
import { setDefaultOptions } from 'date-fns';
import i18n from '.';
import { deviceLanguages, languageInfo, resolveLanguage } from './languages';
import { usePreferencesStore } from '../store/preferencesStore';

export function applyLanguage(code: string) {
  const language = languageInfo(code);
  void i18n.changeLanguage(language.code);
  // Month and day names follow the language. Weeks keep starting on Sunday in every language
  setDefaultOptions({ locale: language.dateLocale, weekStartsOn: 0 });
  if (typeof document !== 'undefined') document.documentElement.lang = language.code;
}

/** The language the preferences ask for on this device */
export const resolvedLanguage = (state = usePreferencesStore.getState()) =>
  resolveLanguage(state.language, deviceLanguages());

let applied: string | null = null;
const listeners = new Set<() => void>();

/** The language the app is shown in (LanguageRoot draws the app again when it changes) */
export const appliedLanguage = () => applied ?? resolvedLanguage();

export function onLanguageApplied(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Before the first render, and again when the preference changes or the device's languages do
 * (Automatic follows them). Nothing else changes the language, so a theme or sidebar change
 * never draws the app again.
 */
export function initLanguage() {
  const update = () => {
    const next = resolvedLanguage();
    if (next === applied) return;
    applyLanguage((applied = next));
    for (const listener of listeners) listener();
  };
  update();
  // Runs before React re-renders (this subscription comes first), so the new texts are ready
  usePreferencesStore.subscribe((state, before) => {
    if (state.language !== before.language) update();
  });
  if (typeof window !== 'undefined') window.addEventListener('languagechange', update);
}
