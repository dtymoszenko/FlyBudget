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

// Made once: toLocaleString builds a new formatter on every call, and charts format thousands
const wholeDollars = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const withCents = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(cents: number): string {
  const sym = getCurrencySymbol();
  const abs = Math.abs(cents);
  const formatted = (abs % 100 === 0 ? wholeDollars : withCents).format(abs / 100);
  return cents < 0 ? `-${sym}${formatted}` : `${sym}${formatted}`;
}

const oneDecimal = (n: number) => String(Math.round(n * 10) / 10);

/** Short axis label: "$950", "$12.5k", "-$1.2M". Thresholds sit where rounding would reach the next unit. */
export function formatCentsAxis(cents: number): string {
  const sym = getCurrencySymbol();
  const sign = cents < 0 ? '-' : '';
  const dollars = Math.abs(cents) / 100;
  if (dollars >= 999_950) return `${sign}${sym}${oneDecimal(dollars / 1_000_000)}M`;
  if (dollars >= 999.5) return `${sign}${sym}${oneDecimal(dollars / 1_000)}k`;
  return `${sign}${sym}${Math.round(dollars)}`;
}
