import { useTranslation } from 'react-i18next';
import { useAccounts } from '../../hooks/useAccounts';

interface Props {
  selected: string[];
  onChange: (ids: string[]) => void;
}

export default function AccountMultiSelect({ selected, onChange }: Props) {
  const { t } = useTranslation();
  const { data: accounts = [] } = useAccounts();
  const open = accounts.filter((a) => !a.closedAt);

  const allSelected = selected.length === 0;

  function toggle(id: string) {
    if (selected.length === 0) {
      onChange(open.filter((a) => a.id !== id).map((a) => a.id));
    } else if (selected.includes(id)) {
      const next = selected.filter((s) => s !== id);
      onChange(next.length === open.length ? [] : next);
    } else {
      const next = [...selected, id];
      onChange(next.length === open.length ? [] : next);
    }
  }

  return (
    <div className="space-y-1">
      <button
        onClick={() => onChange([])}
        className={`text-xs px-1.5 py-0.5 rounded ${allSelected ? 'text-brand-600 font-medium' : 'text-text-tertiary hover:text-text-secondary'}`}
      >
        {allSelected ? t('reports.pickers.allSelected') : t('reports.pickers.selectAll')}
      </button>
      {open.map((a) => {
        const checked = allSelected || selected.includes(a.id);
        return (
          <label key={a.id} className="flex items-center gap-2 py-0.5 cursor-pointer">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(a.id)}
              className="rounded border-border text-brand-600 focus:ring-brand-600"
            />
            <span className="text-sm text-text-secondary truncate">{a.name}</span>
          </label>
        );
      })}
    </div>
  );
}
