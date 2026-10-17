import { useEffect, useId, useRef, useState } from 'react';
import {
  UNREADABLE_AMOUNT,
  amountPlaceholder,
  amountToInput,
  formatAmount,
  readTypedAmount,
  useAmountStyle,
} from '../../utils/currency';
import { useReportAmountValidity } from './amountValidity';

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
  // Whether what's in the field now is an amount: checked as it's typed, so a form can't be
  // submitted (and a dialog keeps Save disabled) while it isn't, even before the field is left
  const [readable, setReadable] = useState(true);
  useReportAmountValidity(readable);
  const style = useAmountStyle();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // The dialog set an amount itself (reopened, reset, a suggestion picked): it replaces text
  // that couldn't be read, unless that text is being typed right now
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (!focused) {
      setInvalid(false);
      setReadable(true);
    }
  }
  useEffect(() => {
    if (readable) inputRef.current?.setCustomValidity('');
  }, [readable]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const text = e.target.value;
    setRaw(text);
    const ok = readTypedAmount(text, style) !== null;
    setReadable(ok);
    // The browser then refuses to submit a form holding this field, and says why
    e.target.setCustomValidity(ok ? '' : UNREADABLE_AMOUNT);
  }

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
        ref={inputRef}
        // Text, not number: a number field won't take a decimal comma (12,50)
        type="text"
        inputMode="decimal"
        value={shown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
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
