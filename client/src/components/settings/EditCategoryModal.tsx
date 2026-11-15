import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormReset } from '../../hooks/useFormReset';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { EmojiPickerPopover } from '../ui/EmojiPickerPopover';
import { useUpdateCategory } from '../../hooks/useCategories';
import { usePreferencesStore } from '../../store/preferencesStore';
import type { BudgetType, Category, CategoryGroup } from '../../types';

const BUDGET_TYPE_OPTIONS: BudgetType[] = ['fixed', 'flexible', 'non_monthly', 'savings'];

interface Props {
  category: Category | null;
  groups: CategoryGroup[];
  isIncome: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export function EditCategoryModal({ category, groups, isIncome, onClose, onDelete }: Props) {
  const { t } = useTranslation();
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const updateCategory = useUpdateCategory();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [groupId, setGroupId] = useState('');
  const [budgetType, setBudgetType] = useState<BudgetType>('flexible');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

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
    <Modal
      isOpen={!!category}
      onClose={onClose}
      title={t('settings.categories.edit.title')}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-text mb-1.5">
            {t('settings.categories.edit.iconAndName')}
          </label>
          <div className="flex items-center gap-3">
            {showCategoryIcons && (
              <div className="relative shrink-0">
                <button
                  ref={emojiButtonRef}
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  aria-label={t('settings.categories.edit.changeIcon')}
                  className="text-xl w-10 h-10 flex items-center justify-center rounded-lg border border-border hover:bg-hover transition-colors"
                >
                  {icon || '📦'}
                </button>
                {showEmojiPicker && (
                  <EmojiPickerPopover
                    anchorRef={emojiButtonRef}
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
              placeholder={t('settings.categories.edit.categoryName')}
              aria-label={t('settings.categories.edit.categoryName')}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text mb-1.5">
            {t('settings.categories.edit.group')}
          </label>
          <select
            aria-label={t('settings.categories.edit.group')}
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
            <label className="block text-sm font-medium text-text mb-2">
              {t('settings.categories.edit.budgetType')}
            </label>
            <div className="space-y-2">
              {BUDGET_TYPE_OPTIONS.map((type) => (
                <label
                  key={type}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    budgetType === type
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-border hover:bg-hover'
                  }`}
                >
                  <input
                    type="radio"
                    name="budgetType"
                    value={type}
                    checked={budgetType === type}
                    onChange={() => setBudgetType(type)}
                    className="mt-0.5 accent-brand-600"
                  />
                  <div>
                    <div className="text-sm font-medium text-text">
                      {t(`budget.types.${type}.label`)}
                    </div>
                    <div className="text-xs text-text-tertiary">
                      {t(`budget.types.${type}.description`)}
                    </div>
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
            {t('common.actions.delete')}
          </Button>
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim() || updateCategory.isPending}>
              {updateCategory.isPending
                ? t('settings.categories.edit.saving')
                : t('common.actions.save')}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
