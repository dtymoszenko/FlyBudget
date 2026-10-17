import { useId, useState } from 'react';
import {
  UNREADABLE_AMOUNT,
  amountPlaceholder,
  amountToInput,
  formatAmount,
  readTypedAmount,
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
  // Text that isn't an amount stays in the field, marked, instead of quietly becoming 0
  const [invalid, setInvalid] = useState(false);
  const style = useAmountStyle();
  const hintId = useId();

  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    const initial = invalid ? raw : (value < 0 ? '-' : '') + amountToInput(value, style);
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
    const cents = readTypedAmount(raw, style);
    setInvalid(cents === null);
    if (cents === null) return; // the amount it had stays until the text is fixed
    onChange(allowNegative ? cents : Math.abs(cents));
  }

  const shown = focused || invalid ? raw : value === 0 ? '' : formatAmount(value, style);
  return (
    <>
      <input
        // Text, not number: a number field won't take a decimal comma (12,50)
        type="text"
        inputMode="decimal"
        value={shown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={placeholder ?? amountPlaceholder(style)}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? hintId : undefined}
        className={`block w-full rounded-md border px-3 py-2 text-sm text-text placeholder-text-disabled focus:outline-none focus:ring-1 ${
          invalid
            ? 'border-negative focus:border-negative focus:ring-negative'
            : 'border-border focus:border-brand-600 focus:ring-brand-600'
        } ${className}`}
      />
      {invalid && (
        <p id={hintId} role="alert" className="mt-1 basis-full text-xs text-negative">
          {UNREADABLE_AMOUNT}
        </p>
      )}
    </>
  );
}
