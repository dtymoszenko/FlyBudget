import { useEffect, useMemo, useRef, useState } from 'react';
import { CreditCard, Plus } from 'lucide-react';
import { usePayees, useCreatePayee } from '../../hooks/usePayees';
import { payeeColor } from '../../utils/transactionColors';
import { usePreferencesStore } from '../../store/preferencesStore';

export const selectorInputClass =
  'block w-full rounded-md border border-border px-3 py-2 text-sm text-text bg-surface placeholder-text-disabled focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600';

export interface MerchantValue {
  id: string | null;
  name: string;
}

interface Props {
  value: MerchantValue;
  onChange: (value: MerchantValue) => void;
  placeholder?: string;
}

/**
 * Merchant (payee) selector from the Add transaction workflow: searchable list sorted
 * by transaction count, merchant icons, and "Create new merchant". Free text that
 * isn't confirmed (picked or created) is cleared on blur.
 */
export function MerchantSelect({ value, onChange, placeholder = 'Search merchants...' }: Props) {
  const showMerchantIcons = usePreferencesStore((s) => s.showMerchantIcons);
  const { data: payees = [] } = usePayees();
  const createPayee = useCreatePayee();
  const [query, setQuery] = useState(value.name);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Sync the input when a confirmed merchant is set from outside (e.g. editing).
  // Unconfirmed typing clears value.id, so don't sync then or the input would wipe itself.
  useEffect(() => { if (value.id) setQuery(value.name); }, [value.id, value.name]);

  const sortedPayees = useMemo(
    () => [...payees].sort((a, b) => b.transactionCount - a.transactionCount),
    [payees],
  );
  const filtered = query
    ? sortedPayees.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : sortedPayees.slice(0, 8);
  const exactMatch = payees.find((p) => p.name.toLowerCase() === query.trim().toLowerCase());

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        if (!value.id) setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [value.id]);

  function select(id: string, name: string) {
    onChange({ id, name });
    setQuery(name);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (value.id || value.name) onChange({ id: null, name: '' });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={selectorInputClass}
      />
      {open && (filtered.length > 0 || query) && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto origin-top animate-menu-in">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); select(p.id, p.name); }}
              className="w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-hover cursor-pointer"
            >
              {showMerchantIcons && (
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                  style={{ backgroundColor: payeeColor(p.name) }}
                >
                  {p.name.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="truncate flex-1">{p.name}</span>
              <span className="flex items-center gap-1 text-xs text-text-tertiary shrink-0">
                <CreditCard size={11} />
                {p.transactionCount}
              </span>
            </button>
          ))}
          {query.trim() && !exactMatch && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                createPayee.mutate(
                  { name: query.trim() },
                  { onSuccess: (created) => select(created.id, created.name) },
                );
              }}
              className="w-full text-left px-3 py-2.5 text-sm text-brand-600 font-medium flex items-center gap-1.5 hover:bg-surface-alt cursor-pointer border-t border-border-light"
            >
              <Plus size={14} />
              Create new merchant: &ldquo;{query.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
