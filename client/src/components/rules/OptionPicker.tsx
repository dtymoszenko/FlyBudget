import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface PickerOption {
  id: string;
  label: string;
  /** Shown dimmed before the label, e.g. a category's group */
  group?: string;
}

type Props = {
  options: PickerOption[];
  placeholder?: string;
} & (
  | { multiple?: false; value: string; onChange: (id: string) => void }
  | { multiple: true; value: string[]; onChange: (ids: string[]) => void }
);

const buttonClass =
  'w-full flex items-center gap-2 text-left text-sm border border-border rounded-lg px-2 py-1.5 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-400 cursor-pointer';

/** Searchable dropdown for picking one or several payees, accounts or categories */
export function OptionPicker(props: Props) {
  const { options, placeholder = 'Select…' } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const selected = props.multiple ? props.value : props.value ? [props.value] : [];

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? options.filter((o) => `${o.group ?? ''} ${o.label}`.toLowerCase().includes(q))
      : options;
  }, [options, query]);

  function pick(id: string) {
    if (props.multiple) {
      props.onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
    } else {
      props.onChange(id);
      setOpen(false);
    }
  }

  const summary = selected.length
    ? selected.map((id) => byId.get(id)?.label ?? '(deleted)').join(', ')
    : null;

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setQuery('');
        }}
        className={buttonClass}
      >
        <span className={`flex-1 truncate ${summary ? '' : 'text-text-disabled'}`}>
          {summary ?? placeholder}
        </span>
        <ChevronDown size={13} className="shrink-0 text-text-tertiary" />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 min-w-56 bg-surface border border-border rounded-lg shadow-lg origin-top animate-menu-in">
          <div className="p-2 border-b border-border-light">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
              />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-full pl-7 pr-2 py-1 text-sm border border-border rounded-md bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-400"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.map((o) => {
              const isOn = selected.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => pick(o.id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-hover cursor-pointer ${isOn ? 'text-brand-700' : 'text-text'}`}
                >
                  {props.multiple && (
                    <span
                      className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${isOn ? 'bg-brand-600 border-brand-600 text-white' : 'border-border'}`}
                    >
                      {isOn && <Check size={10} />}
                    </span>
                  )}
                  <span className="truncate flex-1">
                    {o.group && <span className="text-text-tertiary">{o.group} → </span>}
                    {o.label}
                  </span>
                  {!props.multiple && isOn && (
                    <Check size={13} className="text-brand-600 shrink-0" />
                  )}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-sm text-text-tertiary text-center">No matches</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
