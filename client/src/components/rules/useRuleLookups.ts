import { useMemo } from 'react';
import { useAccounts } from '../../hooks/useAccounts';
import { useCategories } from '../../hooks/useCategories';
import { usePayees } from '../../hooks/usePayees';
import { usePreferencesStore } from '../../store/preferencesStore';
import type { RuleLookups } from '../../utils/ruleFormat';
import type { CategoryGroup } from '../../types';
import type { PickerOption } from './OptionPicker';

/** Names and picker options for the payees, accounts and categories rules refer to */
export function useRuleLookups() {
  const { data: payees = [] } = usePayees();
  const { data: accounts = [] } = useAccounts();
  const { data: groups = [] } = useCategories();
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);

  return useMemo(() => {
    const payeeOptions: PickerOption[] = [...payees]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, label: p.name }));
    const accountOptions: PickerOption[] = accounts.map((a) => ({ id: a.id, label: a.name }));
    const categoryOptions: PickerOption[] = (groups as CategoryGroup[]).flatMap((g) =>
      g.categories.map((c) => ({
        id: c.id,
        group: g.name,
        label: `${showCategoryIcons && c.icon ? `${c.icon} ` : ''}${c.name}`,
      })),
    );

    const names = (opts: PickerOption[]) => new Map(opts.map((o) => [o.id, o.label]));
    const payeeNames = names(payeeOptions);
    const accountNames = names(accountOptions);
    const categoryNames = names(categoryOptions);
    const lookups: RuleLookups = {
      payee: (id) => payeeNames.get(id),
      account: (id) => accountNames.get(id),
      category: (id) => categoryNames.get(id),
    };
    return { lookups, payeeOptions, accountOptions, categoryOptions };
  }, [payees, accounts, groups, showCategoryIcons]);
}
