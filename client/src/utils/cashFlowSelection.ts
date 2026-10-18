import { endOfMonth, format, parseISO } from 'date-fns';

export function cashFlowSelection(
  node: {
    nodeType: 'income' | 'hub' | 'expense-group' | 'subcategory' | 'savings';
    categoryId?: string | null;
    groupId?: string | null;
  },
  from: string,
  to: string,
) {
  return {
    categoryId: node.nodeType === 'subcategory' ? (node.categoryId ?? undefined) : undefined,
    categoryGroupId: node.nodeType === 'expense-group' ? (node.groupId ?? undefined) : undefined,
    uncategorized:
      (node.nodeType === 'subcategory' && !node.categoryId) ||
      (node.nodeType === 'expense-group' && !node.groupId),
    from: `${from}-01`,
    to: format(endOfMonth(parseISO(`${to}-01`)), 'yyyy-MM-dd'),
  };
}
