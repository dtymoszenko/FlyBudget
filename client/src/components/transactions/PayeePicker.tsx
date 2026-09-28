import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, Check, Plus, CreditCard } from 'lucide-react';
import { useCreatePayee } from '../../hooks/usePayees';
import { PayeeIcon } from '../payees/PayeeIcon';
import type { PayeeWithCount } from '../../types';

interface Props {
  value: string | null;
  payeeName: string | null;
  onChange: (payeeId: string, payeeName: string) => void;
  payees: PayeeWithCount[];
  onClose: () => void;
}

export function PayeePicker({ value, payeeName, onChange, payees, onClose }: Props) {
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const createPayee = useCreatePayee();

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const sorted = useMemo(
    () => [...payees].sort((a, b) => b.transactionCount - a.transactionCount),
    [payees],
  );

  const filtered = query
    ? sorted.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : sorted;

  const exactMatch = payees.find((p) => p.name.toLowerCase() === query.toLowerCase());

  function handleCreate() {
    if (!query.trim()) return;
    createPayee.mutate(
      { name: query.trim() },
      {
        onSuccess: (created) => {
          onChange(created.id, created.name);
        },
      },
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute top-full left-0 z-50 mt-1 w-72 bg-surface border border-border rounded-lg shadow-lg origin-top-left animate-menu-in"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-2 border-b border-border-light">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
          />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search merchants..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-md bg-surface text-text focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          />
        </div>
      </div>

      <div className="overflow-y-auto max-h-72">
        <div className="px-3 py-1.5 text-xs font-medium text-text-tertiary bg-surface-alt">
          Your merchants
        </div>
        {filtered.map((p) => {
          const isSelected = p.id === value;
          return (
            <button
              key={p.id}
              onClick={() => onChange(p.id, p.name)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-hover ${
                isSelected ? 'bg-brand-50 text-brand-700' : 'text-text'
              }`}
            >
              <PayeeIcon name={p.name} logo={p.logo} />
              <span className="truncate flex-1">{p.name}</span>
              <span className="flex items-center gap-1 text-xs text-text-tertiary shrink-0">
                <CreditCard size={11} />
                {p.transactionCount}
              </span>
              {isSelected && <Check size={14} className="text-brand-600 shrink-0" />}
            </button>
          );
        })}

        {filtered.length === 0 && (
          <div className="px-3 py-4 text-sm text-text-tertiary text-center">No merchants found</div>
        )}
      </div>

      {query && !exactMatch && (
        <div className="border-t border-border-light">
          <button
            onClick={handleCreate}
            disabled={createPayee.isPending}
            className="w-full px-3 py-2.5 text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1.5 hover:bg-hover"
          >
            <Plus size={14} />
            Create new "{query}" merchant
          </button>
        </div>
      )}
    </div>
  );
}
