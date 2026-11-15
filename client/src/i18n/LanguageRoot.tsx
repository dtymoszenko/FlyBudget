import { Fragment, useSyncExternalStore, type ReactNode } from 'react';
import { appliedLanguage, onLanguageApplied } from './applyLanguage';

/**
 * Draws the app again from scratch when the language changes, so no text (a memoized chart
 * label, a helper's sentence) stays in the old one. Data stays cached; only what's on screen
 * starts over, which is fine for a change made in Settings.
 */
export function LanguageRoot({ children }: { children: ReactNode }) {
  const language = useSyncExternalStore(onLanguageApplied, appliedLanguage);
  return <Fragment key={language}>{children}</Fragment>;
}
