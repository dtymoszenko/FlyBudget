import { useMemo } from 'react';
import { CURRENCY_CODES } from '../../utils/currencies';
import { currencyName } from '../../utils/currency';

/** Asked for most: shown first, after the ones already in use */
const COMMON = ['EUR', 'USD', 'GBP', 'CHF', 'PLN', 'SEK', 'NOK', 'DKK', 'CZK', 'CAD', 'AUD', 'JPY'];

interface Props {
  value: string;
  onChange: (currency: string) => void;
  /** Shown at the top: the budget's currency and the ones accounts already use */
  first?: string[];
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  className?: string;
}

/** A currency picker: "EUR · Euro", the ones in use and common ones first, then all by name */
export function CurrencySelect({
  value,
  onChange,
  first = [],
  disabled,
  id,
  'aria-label': ariaLabel = 'Currency',
  'aria-describedby': describedBy,
  className = '',
}: Props) {
  const groups = useMemo(() => {
    const top = [...new Set([...first, ...COMMON])].filter((c) => CURRENCY_CODES.includes(c));
    const rest = CURRENCY_CODES.filter((c) => !top.includes(c))
      .map((code) => ({ code, name: currencyName(code) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { top: top.map((code) => ({ code, name: currencyName(code) })), rest };
  }, [first]);

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      className={`block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60 ${className}`}
    >
      <optgroup label="Common">
        {groups.top.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} · {c.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="All currencies">
        {groups.rest.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} · {c.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
