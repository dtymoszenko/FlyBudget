import { useState, useMemo } from 'react';
import { Trash2, GitMerge, Search } from 'lucide-react';
import { usePayees, useUpdatePayee, useDeletePayee, useMergePayees } from '../hooks/usePayees';
import { useCategories } from '../hooks/useCategories';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { Modal, useModalValue } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { PayeeIcon } from '../components/payees/PayeeIcon';
import type { PayeeWithCount } from '../types';

function MergeModal({
  isOpen,
  selected,
  payees,
  onMerge,
  onClose,
}: {
  isOpen: boolean;
  selected: string[];
  payees: PayeeWithCount[];
  onMerge: (keepId: string, mergeIds: string[]) => void;
  onClose: () => void;
}) {
  const [keepId, setKeepId] = useState(selected[0]);
  const selectedPayees = payees.filter((p) => selected.includes(p.id));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Merge Payees" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Choose which payee name to keep. All transactions will be moved to the selected payee.
        </p>
        <div className="space-y-2">
          {selectedPayees.map((p) => (
            <label
              key={p.id}
              className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors ${keepId === p.id ? 'border-brand-500 bg-brand-50' : 'border-border hover:bg-hover'}`}
            >
              <input
                type="radio"
                name="keepId"
                value={p.id}
                checked={keepId === p.id}
                onChange={() => setKeepId(p.id)}
                className="accent-brand-600"
              />
              <PayeeIcon name={p.name} logo={p.logo} size="md" force />
              <div>
                <p className="text-sm font-medium text-text">{p.name}</p>
                <p className="text-xs text-text-tertiary">
                  {p.transactionCount} transaction{p.transactionCount !== 1 ? 's' : ''}
                </p>
              </div>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onMerge(
                keepId,
                selected.filter((id) => id !== keepId),
              );
              onClose();
            }}
          >
            Merge
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function PayeesPage() {
  const { data: payees = [], isLoading } = usePayees();
  const { data: groups = [] } = useCategories();
  const updatePayee = useUpdatePayee();
  const deletePayee = useDeletePayee();
  const mergePayees = useMergePayees();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const mergeModal = useModalValue(showMerge);

  const allCategories = useMemo(
    () =>
      (groups as any[]).flatMap((g: any) =>
        g.categories.map((c: any) => ({ ...c, groupName: g.name })),
      ),
    [groups],
  );

  const filtered = useMemo(
    () => payees.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())),
    [payees, search],
  );

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function startEditName(p: PayeeWithCount) {
    setEditingId(p.id);
    setEditingName(p.name);
  }

  function commitEditName(id: string) {
    if (editingName.trim()) updatePayee.mutate({ id, name: editingName.trim() });
    setEditingId(null);
  }

  function handleCategoryChange(id: string, categoryId: string) {
    updatePayee.mutate({ id, defaultCategoryId: categoryId || null });
  }

  function handleMerge(keepId: string, mergeIds: string[]) {
    mergePayees.mutate({ keepId, mergeIds }, { onSuccess: () => setSelected(new Set()) });
  }

  const deleteTarget = payees.find((p) => p.id === deleteId);

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold text-text">Payees</h1>
          <div className="flex items-center gap-2">
            {selected.size >= 2 && (
              <button
                onClick={() => setShowMerge(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-700 bg-brand-50 border border-brand-200 rounded-md hover:bg-brand-100 transition-colors"
              >
                <GitMerge size={13} />
                Merge {selected.size} payees
              </button>
            )}
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search payees…"
                className="pl-8 pr-3 py-1.5 text-sm border border-border rounded-full bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-sm text-text-tertiary">
            Loading...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-text-tertiary">
            {search
              ? 'No payees match your search.'
              : "No payees yet. They're created automatically from transactions."}
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-surface-alt border-b border-border z-10">
              <tr>
                <th className="w-10 px-4 py-2">
                  <input
                    type="checkbox"
                    checked={selected.size === filtered.length && filtered.length > 0}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(filtered.map((p) => p.id)) : new Set())
                    }
                    className="accent-brand-600"
                  />
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-text-tertiary">Name</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-text-tertiary">
                  Default category
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-text-tertiary">
                  Transactions
                </th>
                <th className="w-12 px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light">
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className={`group hover:bg-hover transition-colors ${selected.has(p.id) ? 'bg-brand-50' : ''}`}
                >
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      className="accent-brand-600"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <PayeeIcon
                        name={p.name}
                        logo={p.logo}
                        size="md"
                        force
                        onLogoChange={(logo) => updatePayee.mutate({ id: p.id, logo })}
                      />
                      {editingId === p.id ? (
                        <input
                          autoFocus
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={() => commitEditName(p.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEditName(p.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="text-sm border border-brand-500 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-brand-600 w-full max-w-xs"
                        />
                      ) : (
                        <span
                          className="text-sm font-medium text-text cursor-text hover:text-brand-600 transition-colors"
                          onDoubleClick={() => startEditName(p)}
                          title="Double-click to rename"
                        >
                          {p.name}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={p.defaultCategoryId ?? ''}
                      onChange={(e) => handleCategoryChange(p.id, e.target.value)}
                      className="text-sm border border-border rounded-md px-2 py-1 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 max-w-[220px]"
                    >
                      <option value="">No default</option>
                      {allCategories.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.groupName} → {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-right text-sm text-text-secondary">
                    {p.transactionCount}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => setDeleteId(p.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-text-tertiary hover:text-negative transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {mergeModal.value && (
        <MergeModal
          isOpen={mergeModal.isOpen}
          selected={[...selected]}
          payees={payees}
          onMerge={handleMerge}
          onClose={() => setShowMerge(false)}
        />
      )}

      <ConfirmModal
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deletePayee.mutate(deleteId);
        }}
        title="Delete Payee"
        message={`Delete "${deleteTarget?.name}"? This will remove the payee from all their transactions.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}
