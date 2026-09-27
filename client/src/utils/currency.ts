// all money is integer cents — convert at the UI edges only
import { usePreferencesStore } from '../store/preferencesStore';

export function centsToInput(cents: number): string {
  return cents === 0 ? '' : (Math.abs(cents) / 100).toFixed(2);
}

export function parseCents(s: string): number {
  const cents = Math.round(parseFloat(s) * 100);
  // NaN, Infinity (e.g. "1e400"), and amounts too large to store exactly are invalid
  return Number.isSafeInteger(cents) ? cents : 0;
}

function getCurrencySymbol(): string {
  return usePreferencesStore.getState().currencySymbol || '$';
}

export function formatCurrency(cents: number): string {
  const sym = getCurrencySymbol();
  const abs = Math.abs(cents);
  const formatted = (abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: abs % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return cents < 0 ? `-${sym}${formatted}` : `${sym}${formatted}`;
}

export function formatCentsAxis(cents: number): string {
  const sym = getCurrencySymbol();
  const abs = Math.abs(cents);
  if (abs >= 100_000_00) return `${sym}${(cents / 100_000_00).toFixed(0)}M`;
  if (abs >= 1_000_00) return `${sym}${(cents / 1_000_00).toFixed(0)}k`;
  return `${sym}${(cents / 100).toFixed(0)}`;
}
