// all money is integer minor units (cents; yen and dinars have 0 and 3 decimals) — convert
// at the UI edges only
import { useShallow } from 'zustand/react/shallow';
import {
  usePreferencesStore,
  type AmountFormat,
  type CurrencyDisplay,
  type SymbolPosition,
} from '../store/preferencesStore';
import { useCurrencyStore } from '../store/currencyStore';
import { CURRENCY_CODES, minorUnits } from './currencies';
import { amountChars, readImportAmount } from './csv';

/** How amounts are shown and typed on this device */
export interface AmountStyle {
  format: AmountFormat;
  position: SymbolPosition;
  symbol: string;
  /** Decimals of the currency's amounts: 2 (cents) unless given */
  minor?: number;
  /** A space between a symbol written first and the number ("CHF 12.50", "R$ 12,50") */
  space?: boolean;
}

const decimalsOf = (style: AmountStyle) => style.minor ?? 2;

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
const deviceLocale = () => (typeof navigator === 'undefined' ? undefined : navigator.language);
let deviceStyle: Pick<AmountStyle, 'format' | 'position'> | undefined;
const device = () => (deviceStyle ??= localeAmountStyle(deviceLocale()));

// Bidirectional marks Arabic and Hebrew formats put around numbers and symbols
const BIDI = /[‎‏؜]/g;

/** Countries that pay in euros: their own way of writing euro amounts wins on their devices */
const EURO_REGIONS = new Set(
  'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK BG'.split(' '),
);
/** Where currencies whose code isn't a country are written */
const HOME_LOCALES: Record<string, string> = {
  EUR: 'de-DE',
  XAF: 'fr-CM',
  XOF: 'fr-SN',
  XPF: 'fr-PF',
  XCD: 'en-AG',
  XCG: 'nl-CW',
  ANG: 'nl-CW',
};

const regionOf = (locale: string | undefined) => {
  try {
    return locale ? new Intl.Locale(locale).maximize().region : undefined;
  } catch {
    return undefined;
  }
};

/** The language a currency's amounts are written in: the device's at home, else its country's */
function homeLocale(currency: string): string | undefined {
  const region = regionOf(deviceLocale());
  if (region && (currency === 'EUR' ? EURO_REGIONS.has(region) : currency.startsWith(region))) {
    return deviceLocale();
  }
  if (HOME_LOCALES[currency]) return HOME_LOCALES[currency];
  try {
    return new Intl.Locale('und', { region: currency.slice(0, 2) }).maximize().baseName;
  } catch {
    return undefined;
  }
}

const conventions = new Map<string, Pick<AmountStyle, 'position' | 'space'>>();

/**
 * Which side of the number a currency's symbol goes, and whether a space separates them, as
 * that currency's own country writes it (zł after: 12,50 zł; $ before: $12.50; CHF before
 * with a space). Only the side and space are used: separators follow the Amount format.
 */
export function currencyConvention(currency: string): Pick<AmountStyle, 'position' | 'space'> {
  let found = conventions.get(currency);
  if (found) return found;
  try {
    const parts = new Intl.NumberFormat(homeLocale(currency), {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(1234.5);
    const sym = parts.findIndex((p) => p.type === 'currency');
    const num = parts.findIndex((p) => p.type === 'integer');
    const between = parts
      .slice(Math.min(sym, num) + 1, Math.max(sym, num))
      .filter((p) => p.type === 'literal')
      .map((p) => p.value.replace(BIDI, ''))
      .join('');
    found = { position: sym > num ? 'after' : 'before', space: /\s/.test(between) };
  } catch {
    found = { position: 'before', space: false };
  }
  conventions.set(currency, found);
  return found;
}

let narrowCounts: Map<string, number> | undefined;
const symbols = new Map<string, string>();

const symbolIn = (currency: string, display: 'narrowSymbol' | 'symbol') => {
  try {
    return (
      new Intl.NumberFormat(deviceLocale(), {
        style: 'currency',
        currency,
        currencyDisplay: display,
      })
        .formatToParts(1)
        .find((p) => p.type === 'currency')
        ?.value.replace(BIDI, '')
        .trim() ?? currency
    );
  } catch {
    return currency;
  }
};

/**
 * A currency's symbol in the device's language: the short one (zł, €, ₹) unless other
 * currencies share it ($, kr, £), then the one that tells them apart (US$ / CA$, SEK)
 */
export function currencySymbol(currency: string): string {
  let found = symbols.get(currency);
  if (found) return found;
  if (!narrowCounts) {
    narrowCounts = new Map();
    for (const code of CURRENCY_CODES) {
      const s = symbolIn(code, 'narrowSymbol');
      narrowCounts.set(s, (narrowCounts.get(s) ?? 0) + 1);
    }
  }
  const narrow = symbolIn(currency, 'narrowSymbol');
  found = (narrowCounts.get(narrow) ?? 0) > 1 ? symbolIn(currency, 'symbol') : narrow;
  symbols.set(currency, found);
  return found;
}

/** A currency's name in the device's language ("Polish zloty"), or its code */
export function currencyName(currency: string): string {
  try {
    return new Intl.DisplayNames(deviceLocale(), { type: 'currency' }).of(currency) ?? currency;
  } catch {
    return currency;
  }
}

type StylePreferences = {
  amountFormat: AmountFormat | 'auto';
  symbolPosition: SymbolPosition | 'auto';
  currencySymbol: string;
  currencyStyles?: Record<string, CurrencyDisplay>;
};

const SYMBOL_PREFERENCES = (s: StylePreferences) => ({
  amountFormat: s.amountFormat,
  symbolPosition: s.symbolPosition,
  currencySymbol: s.currencySymbol,
  currencyStyles: s.currencyStyles,
});

/**
 * How amounts in a currency are written on this device: separators from the Amount format,
 * the symbol and its side from the currency's own convention (or what was chosen for it), and
 * its decimals. Without a currency (a budget that hasn't chosen one), the symbol preference.
 * The budget currency's side is the Symbol position preference, when it isn't Automatic.
 */
export function currencyAmountStyle(
  currency: string | null | undefined,
  prefs: StylePreferences = usePreferencesStore.getState(),
  budgetCurrency: string | null = useCurrencyStore.getState().budgetCurrency,
): AmountStyle {
  const format = prefs.amountFormat === 'auto' ? device().format : prefs.amountFormat;
  const code = currency ?? budgetCurrency;
  if (!code) {
    const symbol = prefs.currencySymbol || '$';
    return {
      format,
      position: prefs.symbolPosition === 'auto' ? device().position : prefs.symbolPosition,
      symbol,
      space: /\p{L}$/u.test(symbol),
    };
  }
  const own = prefs.currencyStyles?.[code];
  const convention = currencyConvention(code);
  const chosen =
    own?.position ??
    (code === budgetCurrency && prefs.symbolPosition !== 'auto' ? prefs.symbolPosition : null);
  const position = chosen ?? convention.position;
  const symbol = own?.symbol || currencySymbol(code);
  return {
    format,
    position,
    symbol,
    minor: minorUnits(code),
    // A space after letters (CHF 12, USD 12), else its own convention's spacing (R$ 12) unless
    // the side or symbol was chosen by hand
    space:
      /\p{L}$/u.test(symbol) ||
      (position === convention.position && !own?.symbol && convention.space),
  };
}

/** The preferences resolved for the budget's currency: 'auto' becomes what the device or currency uses */
export function amountStyle(prefs: StylePreferences = usePreferencesStore.getState()): AmountStyle {
  return currencyAmountStyle(null, prefs);
}

/** The amount style, re-rendering the component when the preferences change */
export function useAmountStyle(currency?: string | null): AmountStyle {
  const prefs = usePreferencesStore(useShallow(SYMBOL_PREFERENCES));
  const budget = useCurrencyStore((s) => s.budgetCurrency);
  return currencyAmountStyle(currency ?? null, prefs, budget);
}

/** What an empty amount field shows: 0.00, 0,00, 0 (yen) or 0.000 (dinars) */
export const amountPlaceholder = (style: AmountStyle = amountStyle()) =>
  decimalsOf(style) ? `0${decimalSeparator(style.format)}${'0'.repeat(decimalsOf(style))}` : '0';

/** An amount for an input field: "1234.56" or "1234,56", without grouping or sign */
export function amountToInput(cents: number, style: AmountStyle): string {
  if (cents === 0) return '';
  const minor = decimalsOf(style);
  const abs = String(Math.abs(cents)).padStart(minor + 1, '0');
  if (!minor) return abs;
  return `${abs.slice(0, -minor)}${decimalSeparator(style.format)}${abs.slice(-minor)}`;
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
  // Stripped of the symbol so a currency written with a slash (S/) isn't a division
  const expression = style.symbol ? s.split(style.symbol).join(' ') : s;
  if (/[+*/]|\d\s*-/.test(expression.replace(/^\s*[+-]/, ''))) {
    return evaluateTypedAmount(expression, style);
  }
  return readPlainAmount(s, style);
}

/**
 * An amount with arithmetic typed into it: 12.50+3*2, 120/3, 45-12.50. The operands are
 * amounts (in the format's separators), * and / go before + and -, left to right. A sign at
 * the start belongs to the first amount. Exact: fractions of BigInts, rounded once at the end
 * (halves away from zero). Null when any part isn't an amount, or on dividing by zero. Every
 * operand is an amount in the currency's decimals, so 1000*1.5 can't be read in yen, nor
 * 0.005*2 in dollars.
 * shortcut: no parentheses (rejected, not read as accounting negatives), add them if asked
 */
function evaluateTypedAmount(s: string, style: AmountStyle): number | null {
  const unit = BigInt(10 ** decimalsOf(style));
  // "12.50 - 3": a minus after a digit subtracts; at the start (or after another operator) it
  // is the next amount's sign
  const tokens = s.trim().match(/^[+-]?[^+*/-]+|[+*/-]|[^+*/-]+/g) ?? [];
  if (tokens.length % 2 === 0) return null; // an operator at the end
  // Running value as a fraction of cents: n / d, d > 0
  const sums: { n: bigint; d: bigint }[] = [];
  let op = '+';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (i % 2 === 1) {
      if (!/^[+*/-]$/.test(token)) return null;
      op = token;
      continue;
    }
    // A blank operand (12* -3, 12+$*3) would read as 0
    if (token.trim() === '' || /^[+*/-]$/.test(token) || /[()]/.test(token)) return null;
    // Exact operands too: 0.005*2 would otherwise round 0.005 to a cent first
    const cents = readPlainAmount(token, style, true);
    if (cents === null) return null;
    const c = BigInt(cents);
    const last = sums[sums.length - 1]!;
    if (op === '*') sums[sums.length - 1] = { n: last.n * c, d: last.d * unit };
    else if (op === '/') {
      if (c === 0n) return null;
      const sign = c < 0n ? -1n : 1n;
      sums[sums.length - 1] = { n: last.n * unit * sign, d: last.d * c * sign };
    } else sums.push({ n: op === '-' ? -c : c, d: 1n });
  }
  const total = sums.reduce((a, b) => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d }));
  const abs = total.n < 0n ? -total.n : total.n;
  const rounded = abs / total.d + (2n * (abs % total.d) >= total.d ? 1n : 0n);
  if (rounded > 10_000_000_000_000n) return null; // the server's limit
  return Number(total.n < 0n ? -rounded : rounded);
}

/** `exact`: refuse more decimals than the currency has, instead of rounding them */
function readPlainAmount(
  s: string,
  style: AmountStyle,
  exact = decimalsOf(style) === 0,
): number | null {
  let text = s;
  // Symbols with letters (kr, Fr, CHF, S/) are left to amountChars, which removes them with
  // a dot written after them (kr.): removing "kr" here would leave that dot behind
  if (style.symbol && !/[\d\p{L}]/u.test(style.symbol)) {
    text = text.split(style.symbol).join(' ');
  }
  // Separators the same way the reader sees them: currency words like kr. or Fr. removed
  const bare = amountChars(text).replace(/[()+-]/g, '');
  if (bare === '') return text.trim() === '' ? 0 : null;
  const minor = decimalsOf(style);
  const lastDot = bare.lastIndexOf('.');
  const lastComma = bare.lastIndexOf(',');
  // One separator with fewer than three digits after it is a decimal one, in a currency with
  // decimals (with three, 1.234 and 1,234 are a thousand and more, except with 3 decimals)
  const shortTail = minor === 3 ? /^\d*[.,]\d{1,3}$/ : /^\d*[.,]\d{1,2}$/;
  // Without decimals, 1.234 and 1,234 can only be grouping: a thousand and more yen
  const grouped = minor === 0 && /^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.exec(bare);
  const decimal = grouped
    ? grouped[1] === '.'
      ? ','
      : '.'
    : lastDot !== -1 && lastComma !== -1
      ? lastDot > lastComma
        ? '.'
        : ','
      : shortTail.test(bare)
        ? bare.includes(',')
          ? ','
          : '.'
        : decimalSeparator(style.format);
  // A currency without decimals has no 12.5 (yen): that isn't rounded away, it's unreadable.
  // With decimals, extra digits round as they always have (1.234 is 1.23)
  return readImportAmount(text, decimal === ',' ? 'comma' : 'dot', {
    directionWords: false,
    minor,
    exact,
  });
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

/** "-$1,234.56", "-CHF 12.50" or "-1.234,56 €": the symbol with a no-break space between them */
function withSymbol(number: string, negative: boolean, style: AmountStyle): string {
  const sign = negative ? '-' : '';
  return style.position === 'after'
    ? `${sign}${number} ${style.symbol}`
    : `${sign}${style.symbol}${style.space ? ' ' : ''}${number}`;
}

/** An amount as this device writes it: "$1,234.56", "1.234,56 €"; whole amounts without cents */
export function formatAmount(cents: number, style: AmountStyle): string {
  const { group, decimal } = SEPARATORS[style.format];
  const unit = 10 ** decimalsOf(style);
  const abs = Math.abs(cents);
  let number = groupDigits(String(Math.floor(abs / unit)), group);
  if (abs % unit !== 0) number += decimal + String(abs % unit).padStart(decimalsOf(style), '0');
  return withSymbol(number, cents < 0, style);
}

/** Short axis label: "$950", "$12.5k", "-1,2M €". Thresholds sit where rounding would reach the next unit. */
export function formatAxisAmount(cents: number, style: AmountStyle): string {
  const oneDecimal = (n: number) =>
    String(Math.round(n * 10) / 10).replace('.', decimalSeparator(style.format));
  const dollars = Math.abs(cents) / 10 ** decimalsOf(style);
  const number =
    dollars >= 999_950
      ? `${oneDecimal(dollars / 1_000_000)}M`
      : dollars >= 999.5
        ? `${oneDecimal(dollars / 1_000)}k`
        : String(Math.round(dollars));
  return withSymbol(number, cents < 0, style);
}

// The same, in this device's style and the budget's currency. One argument each, so they can
// be passed as callbacks (Recharts' tickFormatter, Array.map) without a second argument being
// taken for a style. Amounts of one account use formatMoney with its currency.
export const centsToInput = (cents: number) => amountToInput(cents, amountStyle());
export const parseCents = (s: string) => parseAmount(s, amountStyle());
export const formatCurrency = (cents: number) => formatAmount(cents, amountStyle());
export const formatCentsAxis = (cents: number) => formatAxisAmount(cents, amountStyle());

/** An amount in a currency (an account's own): "12,50 zł", "¥1,500"; null = the budget's */
export const formatMoney = (amount: number, currency: string | null | undefined) =>
  formatAmount(amount, currencyAmountStyle(currency));

/** Symbols people typed as their currency before FlyBudget knew currencies */
const SYMBOL_CURRENCIES: Record<string, string> = {
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  '₩': 'KRW',
  '₽': 'RUB',
  '₺': 'TRY',
  '₴': 'UAH',
  '₪': 'ILS',
  '฿': 'THB',
  '₫': 'VND',
  '₱': 'PHP',
  '₦': 'NGN',
  zł: 'PLN',
  Kč: 'CZK',
  Ft: 'HUF',
  lei: 'RON',
  CHF: 'CHF',
  Fr: 'CHF',
  'Fr.': 'CHF',
  R$: 'BRL',
  A$: 'AUD',
  C$: 'CAD',
  NZ$: 'NZD',
  R: 'ZAR',
};
/** Where a $ or kr means which currency */
const REGION_CURRENCIES: Record<string, string> = {
  US: 'USD',
  CA: 'CAD',
  AU: 'AUD',
  NZ: 'NZD',
  MX: 'MXN',
  SG: 'SGD',
  HK: 'HKD',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  IS: 'ISK',
  GB: 'GBP',
  CH: 'CHF',
  JP: 'JPY',
  IN: 'INR',
  PL: 'PLN',
  CZ: 'CZK',
  BR: 'BRL',
};

/**
 * The currency someone most likely means: from the symbol they chose before currencies
 * existed, else the device's country (a euro country means EUR), else US dollars
 */
export function guessCurrency(
  symbol: string | null | undefined,
  locale: string | undefined = deviceLocale(),
): string {
  const region = regionOf(locale);
  const fromSymbol = symbol ? SYMBOL_CURRENCIES[symbol.trim()] : undefined;
  if (fromSymbol) return fromSymbol;
  if (region && EURO_REGIONS.has(region) && symbol?.trim() !== '$') return 'EUR';
  return (region && REGION_CURRENCIES[region]) || 'USD';
}
