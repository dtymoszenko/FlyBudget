import { useState } from 'react';
import {
  amountPlaceholder,
  amountToInput,
  formatAmount,
  parseAmount,
  useAmountStyle,
} from '../../utils/currency';

interface Props {
  value: number;
  onChange: (cents: number) => void;
  placeholder?: string;
  className?: string;
  allowNegative?: boolean;
  'aria-label'?: string;
}

export function CurrencyInput({
  value,
  onChange,
  placeholder,
  className = '',
  allowNegative = false,
  'aria-label': ariaLabel,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState('');
  const style = useAmountStyle();

  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    const initial = (value < 0 ? '-' : '') + amountToInput(value, style);
    setFocused(true);
    setRaw(initial);
    // Select the amount once it's shown for editing, so typing replaces it. Only if nothing
    // was typed in the meantime, or the first keystroke would be selected and overwritten.
    const input = e.currentTarget;
    if (initial) {
      requestAnimationFrame(() => {
        if (document.activeElement === input && input.value === initial) input.select();
      });
    }
  }

  function handleBlur() {
    setFocused(false);
    const cents = parseAmount(raw, style);
    onChange(allowNegative ? cents : Math.abs(cents));
  }

  return (
    <input
      // Text, not number: a number field won't take a decimal comma (12,50)
      type="text"
      inputMode="decimal"
      value={focused ? raw : value === 0 ? '' : formatAmount(value, style)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={(e) => setRaw(e.target.value)}
      placeholder={placeholder ?? amountPlaceholder(style)}
      aria-label={ariaLabel}
      className={`block w-full rounded-md border border-border px-3 py-2 text-sm text-text placeholder-text-disabled focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 ${className}`}
    />
  );
}
