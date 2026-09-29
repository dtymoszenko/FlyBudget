import { useState, useEffect, useRef } from 'react';
import { useFormReset } from '../../hooks/useFormReset';
import EmojiPicker, { type EmojiClickData } from 'emoji-picker-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useUpdateCategory } from '../../hooks/useCategories';
import { usePreferencesStore } from '../../store/preferencesStore';
import type { BudgetType, Category, CategoryGroup } from '../../types';

const BUDGET_TYPE_OPTIONS: { value: BudgetType; label: string; description: string }[] = [
  { value: 'fixed', label: 'Fixed', description: 'Consistent, predictable monthly amount' },
  {
    value: 'flexible',
    label: 'Flexible',
    description: 'Variable spending that changes each month',
  },
  { value: 'non_monthly', label: 'Non-Monthly', description: 'Periodic or irregular expenses' },
  {
    value: 'savings',
    label: 'Savings/Investments',
    description: 'Savings goals and investment contributions',
  },
];

function EmojiPickerPopover({
  onSelect,
  onClose,
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute z-[60] mt-1" style={{ left: 0, top: '100%' }}>
      <EmojiPicker
        onEmojiClick={(data: EmojiClickData) => {
          onSelect(data.emoji);
          onClose();
        }}
        width={320}
        height={400}
        searchPlaceholder="Search emoji..."
        previewConfig={{ showPreview: false }}
      />
    </div>
  );
}

interface Props {
  category: Category | null;
  groups: CategoryGroup[];
  isIncome: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export function EditCategoryModal({ category, groups, isIncome, onClose, onDelete }: Props) {
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const updateCategory = useUpdateCategory();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [groupId, setGroupId] = useState('');
  const [budgetType, setBudgetType] = useState<BudgetType>('flexible');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Filled once per opening, not on every refetch of the categories (that would undo edits)
  useFormReset(category?.id ?? null, () => {
    if (!category) return;
    setName(category.name);
    setIcon(category.icon ?? '');
    setGroupId(category.groupId);
    setBudgetType((category.budgetType as BudgetType) ?? 'flexible');
    setShowEmojiPicker(false);
  });

  if (!category) return null;

  const applicableGroups = groups.filter((g) => (isIncome ? g.isIncome === 1 : g.isIncome === 0));
  const groupLocked = isIncome && applicableGroups.length <= 1;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!category || !name.trim()) return;

    const data: Record<string, unknown> = {};
    if (name.trim() !== category.name) data.name = name.trim();
    if ((icon || null) !== (category.icon || null)) data.icon = icon || null;
    if (groupId !== category.groupId) data.groupId = groupId;
    if (!isIncome && budgetType !== (category.budgetType ?? 'flexible'))
      data.budgetType = budgetType;

    if (Object.keys(data).length > 0) {
      await updateCategory.mutateAsync({ id: category.id, data });
    }
    onClose();
  }

  return (
    <Modal isOpen={!!category} onClose={onClose} title="Edit Category" size="sm">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-text mb-1.5">Icon & Name</label>
          <div className="flex items-center gap-3">
            {showCategoryIcons && (
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  aria-label="Change icon"
                  className="text-xl w-10 h-10 flex items-center justify-center rounded-lg border border-border hover:bg-hover transition-colors"
                >
                  {icon || '📦'}
                </button>
                {showEmojiPicker && (
                  <EmojiPickerPopover
                    onSelect={setIcon}
                    onClose={() => setShowEmojiPicker(false)}
                  />
                )}
              </div>
            )}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block w-full rounded-lg border border-border px-3 py-2 text-sm bg-surface text-text focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="Category name"
              aria-label="Category name"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text mb-1.5">Group</label>
          <select
            aria-label="Group"
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            disabled={groupLocked}
            className={`block w-full rounded-lg border border-border px-3 py-2 text-sm bg-surface text-text focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 ${
              groupLocked ? 'opacity-60 cursor-not-allowed bg-surface-alt' : ''
            }`}
          >
            {applicableGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        {!isIncome && (
          <div>
            <label className="block text-sm font-medium text-text mb-2">Budget Type</label>
            <div className="space-y-2">
              {BUDGET_TYPE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    budgetType === opt.value
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-border hover:bg-hover'
                  }`}
                >
                  <input
                    type="radio"
                    name="budgetType"
                    value={opt.value}
                    checked={budgetType === opt.value}
                    onChange={() => setBudgetType(opt.value)}
                    className="mt-0.5 accent-brand-600"
                  />
                  <div>
                    <div className="text-sm font-medium text-text">{opt.label}</div>
                    <div className="text-xs text-text-tertiary">{opt.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              onClose();
              onDelete(category!.id);
            }}
          >
            Delete
          </Button>
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || updateCategory.isPending}>
              {updateCategory.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
