// all money is integer cents — convert at the UI edges only
import { useShallow } from 'zustand/react/shallow';
import {
  usePreferencesStore,
  type AmountFormat,
  type SymbolPosition,
} from '../store/preferencesStore';
import { amountChars, readImportAmount } from './csv';

/** How amounts are shown and typed on this device */
export interface AmountStyle {
  format: AmountFormat;
  position: SymbolPosition;
  symbol: string;
}

const SEPARATORS: Record<AmountFormat, { group: string; decimal: '.' | ',' }> = {
  dot: { group: ',', decimal: '.' },
  comma: { group: '.', decimal: ',' },
  space: { group: ' ', decimal: ',' }, // narrow no-break space, as in French
  apostrophe: { group: "'", decimal: '.' },
};

/** The decimal separator of a format: '.' or ',' */
export const decimalSeparator = (format: AmountFormat) => SEPARATORS[format].decimal;

/**
 * How a language writes amounts (`de-DE`: 1.234,56 €, `en-US`: $1,234.56), from the
 * browser's own formatting rules. An unknown language gets 1,234.56 with the symbol first.
 */
export function localeAmountStyle(
  locale: string | undefined,
): Pick<AmountStyle, 'format' | 'position'> {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
    }).formatToParts(-1234567.5);
    const decimal = parts.find((p) => p.type === 'decimal')?.value;
    const group = parts.find((p) => p.type === 'group')?.value ?? '';
    const format: AmountFormat =
      decimal === ','
        ? /\s/.test(group)
          ? 'space'
          : 'comma'
        : /['’]/.test(group)
          ? 'apostrophe'
          : 'dot';
    const currency = parts.findIndex((p) => p.type === 'currency');
    const integer = parts.findIndex((p) => p.type === 'integer');
    return { format, position: currency > integer ? 'after' : 'before' };
  } catch {
    return { format: 'dot', position: 'before' };
  }
}

// The device's language doesn't change while the app runs
let deviceStyle: Pick<AmountStyle, 'format' | 'position'> | undefined;
const device = () =>
  (deviceStyle ??= localeAmountStyle(
    typeof navigator === 'undefined' ? undefined : navigator.language,
  ));

type StylePreferences = {
  amountFormat: AmountFormat | 'auto';
  symbolPosition: SymbolPosition | 'auto';
  currencySymbol: string;
};

/** The preferences resolved: 'auto' becomes what the device's language uses */
export function amountStyle(prefs: StylePreferences = usePreferencesStore.getState()): AmountStyle {
  return {
    format: prefs.amountFormat === 'auto' ? device().format : prefs.amountFormat,
    position: prefs.symbolPosition === 'auto' ? device().position : prefs.symbolPosition,
    symbol: prefs.currencySymbol || '$',
  };
}

/** The amount style, re-rendering the component when the preferences change */
export function useAmountStyle(): AmountStyle {
  return amountStyle(
    usePreferencesStore(
      useShallow((s) => ({
        amountFormat: s.amountFormat,
        symbolPosition: s.symbolPosition,
        currencySymbol: s.currencySymbol,
      })),
    ),
  );
}

/** What an empty amount field shows: 0.00 or 0,00 */
export const amountPlaceholder = (style: AmountStyle = amountStyle()) =>
  `0${decimalSeparator(style.format)}00`;

/** An amount for an input field: "1234.56" or "1234,56", without grouping or sign */
export function amountToInput(cents: number, style: AmountStyle): string {
  if (cents === 0) return '';
  return (Math.abs(cents) / 100).toFixed(2).replace('.', decimalSeparator(style.format));
}

/**
 * Cents from what someone typed, or null if it isn't an amount ('' is 0). Exact, never
 * through floats. Which separator is the decimal one:
 * - with both `.` and `,`, the last one (1.234,56 and 1,234.56 both work in any format)
 * - one `.` or `,` with one or two digits after it (12.5, 12,5, 12,50 mean 12.50 for everyone)
 * - otherwise the format's (1.234 is 1234 with a decimal comma, 1.23 with a decimal point)
 *
 * The user's currency symbol is ignored wherever it is, and letters after the amount are
 * never read as debit/credit (12,50 S/ is a currency, not "S" for Soll). Reads
 * formatCurrency's output too.
 */
export function readTypedAmount(s: string, style: AmountStyle): number | null {
  let text = s;
  // Symbols with letters (kr, Fr, CHF, S/) are left to amountChars, which removes them with
  // a dot written after them (kr.): removing "kr" here would leave that dot behind
  if (style.symbol && !/[\d\p{L}]/u.test(style.symbol)) {
    text = text.split(style.symbol).join(' ');
  }
  // Separators the same way the reader sees them: currency words like kr. or Fr. removed
  const bare = amountChars(text).replace(/[()+-]/g, '');
  if (bare === '') return text.trim() === '' ? 0 : null;
  const lastDot = bare.lastIndexOf('.');
  const lastComma = bare.lastIndexOf(',');
  const decimal =
    lastDot !== -1 && lastComma !== -1
      ? lastDot > lastComma
        ? '.'
        : ','
      : /^\d*[.,]\d{1,2}$/.test(bare)
        ? bare.includes(',')
          ? ','
          : '.'
        : decimalSeparator(style.format);
  return readImportAmount(text, decimal === ',' ? 'comma' : 'dot', { directionWords: false });
}

/** Cents from what someone typed, 0 if it isn't an amount */
export const parseAmount = (s: string, style: AmountStyle): number =>
  readTypedAmount(s, style) ?? 0;

/** What an amount field says when it holds text that isn't an amount */
export const UNREADABLE_AMOUNT = "That isn't an amount. Type it like 12.50 or 12,50.";

/** Whether a field holds text that isn't an amount (an empty field is fine) */
export const isUnreadableAmount = (s: string, style: AmountStyle = amountStyle()): boolean =>
  readTypedAmount(s, style) === null;

const groupDigits = (whole: string, group: string) => whole.replace(/\B(?=(\d{3})+$)/g, group);

/** "-$1,234.56" or "-1.234,56 €": the symbol with a no-break space when it comes after */
function withSymbol(number: string, negative: boolean, style: AmountStyle): string {
  const sign = negative ? '-' : '';
  return style.position === 'after'
    ? `${sign}${number} ${style.symbol}`
    : `${sign}${style.symbol}${number}`;
}

/** An amount as this device writes it: "$1,234.56", "1.234,56 €"; whole amounts without cents */
export function formatAmount(cents: number, style: AmountStyle): string {
  const { group, decimal } = SEPARATORS[style.format];
  const abs = Math.abs(cents);
  let number = groupDigits(String(Math.floor(abs / 100)), group);
  if (abs % 100 !== 0) number += decimal + String(abs % 100).padStart(2, '0');
  return withSymbol(number, cents < 0, style);
}

/** Short axis label: "$950", "$12.5k", "-1,2M €". Thresholds sit where rounding would reach the next unit. */
export function formatAxisAmount(cents: number, style: AmountStyle): string {
  const oneDecimal = (n: number) =>
    String(Math.round(n * 10) / 10).replace('.', decimalSeparator(style.format));
  const dollars = Math.abs(cents) / 100;
  const number =
    dollars >= 999_950
      ? `${oneDecimal(dollars / 1_000_000)}M`
      : dollars >= 999.5
        ? `${oneDecimal(dollars / 1_000)}k`
        : String(Math.round(dollars));
  return withSymbol(number, cents < 0, style);
}

// The same, in this device's style. One argument each, so they can be passed as callbacks
// (Recharts' tickFormatter, Array.map) without a second argument being taken for a style.
export const centsToInput = (cents: number) => amountToInput(cents, amountStyle());
export const parseCents = (s: string) => parseAmount(s, amountStyle());
export const formatCurrency = (cents: number) => formatAmount(cents, amountStyle());
export const formatCentsAxis = (cents: number) => formatAxisAmount(cents, amountStyle());
