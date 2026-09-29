import { useState, useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import EmojiPicker, { type EmojiClickData } from 'emoji-picker-react';
import { usePreferencesStore } from '../../store/preferencesStore';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  useCategories,
  useCreateGroup,
  useUpdateGroup,
  useDeleteGroup,
  useReorderGroups,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useReorderCategories,
} from '../../hooks/useCategories';
import { getCategoryTransactionCount } from '../../api/categories';
import { ConfirmModal } from '../ui/ConfirmModal';
import { DeleteCategoryModal } from './DeleteCategoryModal';
import { useModalValue } from '../ui/Modal';
import { EditCategoryModal } from './EditCategoryModal';
import type { Category, CategoryGroup } from '../../types';

function InlineEdit({
  value,
  onSave,
  onCancel,
}: {
  value: string;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && text.trim()) {
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          cancelled.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!cancelled.current && text.trim()) onSave(text.trim());
        else if (!cancelled.current) onCancel();
      }}
      className="text-sm bg-surface border border-brand-500 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-brand-600 w-48"
    />
  );
}

function EmojiPickerPopover({
  currentEmoji,
  onSelect,
  onClose,
}: {
  currentEmoji: string | null;
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
    <div ref={ref} className="absolute z-50 mt-1" style={{ left: 0, top: '100%' }}>
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

function SortableCategoryRow({
  cat,
  onOpenEditModal,
}: {
  cat: Category;
  onOpenEditModal: (id: string) => void;
}) {
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cat.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1 pl-2 bg-surface rounded-lg hover:bg-hover hover:shadow-sm transition-all mx-2"
    >
      <button
        {...attributes}
        {...listeners}
        className="text-text-disabled hover:text-text-tertiary cursor-grab active:cursor-grabbing touch-none shrink-0 p-1"
        aria-label={`Drag to reorder ${cat.name}`}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="4" r="1.5" />
          <circle cx="10" cy="4" r="1.5" />
          <circle cx="4" cy="10" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onOpenEditModal(cat.id)}
        aria-label={`Edit ${cat.name}`}
        className="flex-1 min-w-0 flex items-center gap-3 pr-3 py-2.5 text-left cursor-pointer"
      >
        {showCategoryIcons && (
          <span className="shrink-0 text-base w-7 h-7 flex items-center justify-center">
            {cat.icon || '📦'}
          </span>
        )}
        <span className="flex-1 min-w-0 text-sm text-text truncate">{cat.name}</span>
      </button>
    </div>
  );
}

function GroupCard({
  group,
  editingId,
  addingCategoryGroupId,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDeleteGroup,
  onAddCategoryStart,
  onAddCategorySubmit,
  onAddCategoryCancel,
  newCategoryName,
  onNewCategoryNameChange,
  newCategoryIcon,
  onNewCategoryIconChange,
  onOpenEditModal,
  onReorderCategories,
  dragAttributes,
  dragListeners,
}: {
  group: CategoryGroup;
  editingId: string | null;
  addingCategoryGroupId: string | null;
  onStartEdit: (id: string) => void;
  onSaveEdit: (id: string, name: string) => void;
  onCancelEdit: () => void;
  onDeleteGroup: (id: string) => void;
  onAddCategoryStart: (groupId: string) => void;
  onAddCategorySubmit: () => void;
  onAddCategoryCancel: () => void;
  newCategoryName: string;
  onNewCategoryNameChange: (v: string) => void;
  newCategoryIcon: string;
  onNewCategoryIconChange: (v: string) => void;
  onOpenEditModal: (id: string) => void;
  onReorderCategories: (groupId: string, ids: string[]) => void;
  dragAttributes?: Record<string, any>;
  dragListeners?: Record<string, any>;
}) {
  const [localCats, setLocalCats] = useState(group.categories);
  const showCategoryIcons = usePreferencesStore((s) => s.showCategoryIcons);
  const [showNewCatEmojiPicker, setShowNewCatEmojiPicker] = useState(false);
  const isEditingGroup = editingId === group.id;
  const isAddingCategory = addingCategoryGroupId === group.id;

  useEffect(() => {
    setLocalCats(group.categories);
  }, [group.categories]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleCatDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localCats.findIndex((c) => c.id === active.id);
    const newIndex = localCats.findIndex((c) => c.id === over.id);
    const reordered = arrayMove(localCats, oldIndex, newIndex);
    setLocalCats(reordered);
    onReorderCategories(
      group.id,
      reordered.map((c) => c.id),
    );
  }

  return (
    <div className="bg-surface-alt rounded-xl border border-brand-500 overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-border-light">
        <div className="flex items-center gap-2">
          {dragAttributes && dragListeners && (
            <button
              {...dragAttributes}
              {...dragListeners}
              className="text-text-disabled hover:text-text-tertiary cursor-grab active:cursor-grabbing touch-none shrink-0 -ml-1"
              aria-label="Drag to reorder group"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                <circle cx="4" cy="4" r="1.5" />
                <circle cx="10" cy="4" r="1.5" />
                <circle cx="4" cy="10" r="1.5" />
                <circle cx="10" cy="10" r="1.5" />
              </svg>
            </button>
          )}
          {isEditingGroup ? (
            <InlineEdit
              value={group.name}
              onSave={(name) => onSaveEdit(group.id, name)}
              onCancel={onCancelEdit}
            />
          ) : (
            <span className="text-sm font-semibold text-text">{group.name}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!isEditingGroup && (
            <button
              onClick={() => onStartEdit(group.id)}
              className="text-xs text-text-tertiary hover:text-brand-600 transition-colors"
            >
              Edit
            </button>
          )}
          <button
            onClick={() => onDeleteGroup(group.id)}
            className="text-xs text-text-tertiary hover:text-negative transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCatDragEnd}>
        <SortableContext items={localCats.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="py-2 space-y-1">
            {localCats.map((cat) => (
              <SortableCategoryRow key={cat.id} cat={cat} onOpenEditModal={onOpenEditModal} />
            ))}
            {localCats.length === 0 && !isAddingCategory && (
              <p className="text-xs text-text-tertiary py-2 px-4">No categories yet.</p>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {isAddingCategory && (
        <div className="px-4 py-3 border-t border-border-light">
          <div className="flex items-center gap-2">
            {showCategoryIcons && (
              <div className="relative shrink-0">
                <button
                  onClick={() => setShowNewCatEmojiPicker(!showNewCatEmojiPicker)}
                  className="text-base w-8 h-8 flex items-center justify-center rounded border border-border-light hover:bg-hover transition-colors"
                  title="Pick icon"
                >
                  {newCategoryIcon || '📦'}
                </button>
                {showNewCatEmojiPicker && (
                  <EmojiPickerPopover
                    currentEmoji={newCategoryIcon}
                    onSelect={(emoji) => onNewCategoryIconChange(emoji)}
                    onClose={() => setShowNewCatEmojiPicker(false)}
                  />
                )}
              </div>
            )}
            <input
              autoFocus
              value={newCategoryName}
              onChange={(e) => onNewCategoryNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onAddCategorySubmit();
                if (e.key === 'Escape') onAddCategoryCancel();
              }}
              placeholder="Category name..."
              className="text-sm border border-border rounded px-2.5 py-1.5 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 flex-1"
            />
            <button
              onClick={onAddCategorySubmit}
              aria-label="Add category"
              disabled={!newCategoryName.trim()}
              className="p-1.5 text-positive hover:bg-positive-subtle rounded disabled:opacity-40 transition-colors"
            >
              <Check size={16} />
            </button>
            <button
              onClick={onAddCategoryCancel}
              aria-label="Cancel"
              className="p-1.5 text-text-tertiary hover:bg-hover rounded transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {!isAddingCategory && (
        <button
          onClick={() => onAddCategoryStart(group.id)}
          className="w-full px-4 py-2.5 text-xs text-brand-600 hover:text-brand-700 hover:bg-brand-50/50 transition-colors text-left border-t border-border-light"
        >
          Create Category
        </button>
      )}
    </div>
  );
}

function SortableGroupCard(
  props: Omit<Parameters<typeof GroupCard>[0], 'dragAttributes' | 'dragListeners'> & {
    groupId: string;
  },
) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.groupId,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <GroupCard {...props} dragAttributes={attributes} dragListeners={listeners} />
    </div>
  );
}

function Section({
  title,
  groups,
  onCreateGroup,
  editingId,
  addingCategoryGroupId,
  addingGroupSection,
  addingGroupName,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDeleteGroup,
  onAddCategoryStart,
  onAddCategorySubmit,
  onAddCategoryCancel,
  newCategoryName,
  onNewCategoryNameChange,
  newCategoryIcon,
  onNewCategoryIconChange,
  onOpenEditModal,
  onReorderCategories,
  onReorderGroups,
  onAddGroupStart,
  onAddGroupNameChange,
  onAddGroupSubmit,
  onAddGroupCancel,
}: {
  title: string;
  groups: CategoryGroup[];
  onCreateGroup: () => void;
  editingId: string | null;
  addingCategoryGroupId: string | null;
  addingGroupSection: 'income' | 'expense' | null;
  addingGroupName: string;
  onStartEdit: (id: string) => void;
  onSaveEdit: (id: string, name: string) => void;
  onCancelEdit: () => void;
  onDeleteGroup: (id: string) => void;
  onAddCategoryStart: (groupId: string) => void;
  onAddCategorySubmit: () => void;
  onAddCategoryCancel: () => void;
  newCategoryName: string;
  onNewCategoryNameChange: (v: string) => void;
  newCategoryIcon: string;
  onNewCategoryIconChange: (v: string) => void;
  onOpenEditModal: (id: string) => void;
  onReorderCategories: (groupId: string, ids: string[]) => void;
  onReorderGroups: (ids: string[]) => void;
  onAddGroupStart: () => void;
  onAddGroupNameChange: (v: string) => void;
  onAddGroupSubmit: () => void;
  onAddGroupCancel: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sectionKey = title === 'Income' ? 'income' : 'expense';
  const isAddingGroup = addingGroupSection === sectionKey;

  function handleGroupDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = groups.findIndex((g) => g.id === active.id);
    const newIndex = groups.findIndex((g) => g.id === over.id);
    const reordered = arrayMove(groups, oldIndex, newIndex);
    onReorderGroups(reordered.map((g) => g.id));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-text">{title}</h2>
        <button
          onClick={onAddGroupStart}
          className="text-sm text-brand-600 hover:text-brand-700 transition-colors"
        >
          Create group
        </button>
      </div>

      {isAddingGroup && (
        <div className="flex items-center gap-3 p-3 bg-brand-50 rounded-lg border border-brand-100">
          <input
            autoFocus
            value={addingGroupName}
            onChange={(e) => onAddGroupNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onAddGroupSubmit();
              if (e.key === 'Escape') onAddGroupCancel();
            }}
            placeholder="Group name..."
            className="text-sm border border-border rounded px-2.5 py-1.5 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 flex-1"
          />
          <button
            onClick={onAddGroupSubmit}
            aria-label="Add group"
            disabled={!addingGroupName.trim()}
            className="p-1.5 text-positive hover:bg-positive-subtle rounded disabled:opacity-40 transition-colors"
          >
            <Check size={16} />
          </button>
          <button
            onClick={onAddGroupCancel}
            aria-label="Cancel"
            className="p-1.5 text-text-tertiary hover:bg-hover rounded transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleGroupDragEnd}
      >
        <SortableContext items={groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {groups.map((group) => (
              <SortableGroupCard
                key={group.id}
                groupId={group.id}
                group={group}
                editingId={editingId}
                addingCategoryGroupId={addingCategoryGroupId}
                onStartEdit={onStartEdit}
                onSaveEdit={onSaveEdit}
                onCancelEdit={onCancelEdit}
                onDeleteGroup={onDeleteGroup}
                onAddCategoryStart={onAddCategoryStart}
                onAddCategorySubmit={onAddCategorySubmit}
                onAddCategoryCancel={onAddCategoryCancel}
                newCategoryName={newCategoryName}
                onNewCategoryNameChange={onNewCategoryNameChange}
                newCategoryIcon={newCategoryIcon}
                onNewCategoryIconChange={onNewCategoryIconChange}
                onOpenEditModal={onOpenEditModal}
                onReorderCategories={onReorderCategories}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {groups.length === 0 && !isAddingGroup && (
        <p className="text-sm text-text-tertiary py-4 text-center">No groups yet.</p>
      )}
    </div>
  );
}

// Stable while loading: a new [] each render would re-run the setLocalGroups effect forever
const NO_GROUPS: CategoryGroup[] = [];

export function CategoryManager() {
  const { data: groups = NO_GROUPS, isLoading } = useCategories();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const reorderGroups = useReorderGroups();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategoryMut = useDeleteCategory();
  const reorderCategories = useReorderCategories();

  const [localGroups, setLocalGroups] = useState<CategoryGroup[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingGroupSection, setAddingGroupSection] = useState<'income' | 'expense' | null>(null);
  const [addingGroupName, setAddingGroupName] = useState('');
  const [addingCategoryGroupId, setAddingCategoryGroupId] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('');
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [deleteCatState, setDeleteCatState] = useState<{
    id: string;
    name: string;
    count: number;
  } | null>(null);
  // Categories with transactions ask where to move them; empty ones use the plain confirm
  const deleteCatModal = useModalValue(
    deleteCatState && deleteCatState.count > 0 && deleteCatState,
  );
  const [editModalCategory, setEditModalCategory] = useState<Category | null>(null);

  useEffect(() => {
    setLocalGroups(groups);
  }, [groups]);

  const incomeGroups = localGroups.filter((g) => g.isIncome === 1);
  const expenseGroups = localGroups.filter((g) => g.isIncome === 0);

  function handleSaveEdit(id: string, name: string) {
    setEditingId(null);
    const isGroup = localGroups.some((g) => g.id === id);
    if (isGroup) {
      updateGroup.mutate({ id, data: { name } });
    } else {
      updateCategory.mutate({ id, data: { name } });
    }
  }

  function handleAddGroup() {
    if (!addingGroupName.trim() || !addingGroupSection) return;
    createGroup.mutate({
      name: addingGroupName.trim(),
      isIncome: addingGroupSection === 'income' ? 1 : 0,
    });
    setAddingGroupSection(null);
    setAddingGroupName('');
  }

  function handleAddCategory() {
    if (!addingCategoryGroupId || !newCategoryName.trim()) return;
    createCategory.mutate({
      groupId: addingCategoryGroupId,
      name: newCategoryName.trim(),
      icon: newCategoryIcon || undefined,
    });
    setNewCategoryName('');
    setNewCategoryIcon('');
    setAddingCategoryGroupId(null);
  }

  function handleOpenEditModal(id: string) {
    const cat = localGroups.flatMap((g) => g.categories).find((c) => c.id === id);
    if (cat) setEditModalCategory(cat);
  }

  async function handleDeleteCategoryClick(id: string) {
    const cat = localGroups.flatMap((g) => g.categories).find((c) => c.id === id);
    if (!cat) return;
    const { count } = await getCategoryTransactionCount(id);
    setDeleteCatState({ id, name: cat.name, count });
  }

  function handleConfirmDeleteCategory(reassignTo?: string) {
    if (!deleteCatState) return;
    deleteCategoryMut.mutate({ id: deleteCatState.id, reassignTo });
    setDeleteCatState(null);
  }

  function handleReorderGroups(sectionIds: string[]) {
    const otherSection = localGroups.filter((g) => !sectionIds.includes(g.id));
    const allIds = [...sectionIds, ...otherSection.map((g) => g.id)];
    reorderGroups.mutate(allIds);
  }

  const deleteGroupTarget = localGroups.find((g) => g.id === deleteGroupId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-text-tertiary">
        Loading...
      </div>
    );
  }

  const sharedProps = {
    editingId,
    addingCategoryGroupId,
    addingGroupSection,
    addingGroupName,
    onStartEdit: setEditingId,
    onSaveEdit: handleSaveEdit,
    onCancelEdit: () => setEditingId(null),
    onDeleteGroup: (id: string) => setDeleteGroupId(id),
    onAddCategoryStart: (groupId: string) => setAddingCategoryGroupId(groupId),
    onAddCategorySubmit: handleAddCategory,
    onAddCategoryCancel: () => {
      setAddingCategoryGroupId(null);
      setNewCategoryName('');
      setNewCategoryIcon('');
    },
    newCategoryName,
    onNewCategoryNameChange: setNewCategoryName,
    newCategoryIcon,
    onNewCategoryIconChange: setNewCategoryIcon,
    onOpenEditModal: handleOpenEditModal,
    onReorderCategories: (_groupId: string, ids: string[]) => reorderCategories.mutate(ids),
    onAddGroupNameChange: setAddingGroupName,
    onAddGroupSubmit: handleAddGroup,
    onAddGroupCancel: () => {
      setAddingGroupSection(null);
      setAddingGroupName('');
    },
  };

  return (
    <div className="space-y-10">
      <Section
        title="Income"
        groups={incomeGroups}
        onCreateGroup={() => setAddingGroupSection('income')}
        onReorderGroups={handleReorderGroups}
        onAddGroupStart={() => setAddingGroupSection('income')}
        {...sharedProps}
      />

      <Section
        title="Expenses"
        groups={expenseGroups}
        onCreateGroup={() => setAddingGroupSection('expense')}
        onReorderGroups={handleReorderGroups}
        onAddGroupStart={() => setAddingGroupSection('expense')}
        {...sharedProps}
      />

      <ConfirmModal
        isOpen={deleteGroupId !== null}
        onClose={() => setDeleteGroupId(null)}
        onConfirm={() => {
          if (deleteGroupId) deleteGroup.mutate(deleteGroupId);
          setDeleteGroupId(null);
        }}
        title="Delete Group"
        message={`Delete "${deleteGroupTarget?.name ?? ''}" and all its categories? This cannot be undone.`}
        confirmLabel="Delete"
        danger
      />

      {deleteCatModal.value && (
        <DeleteCategoryModal
          key={deleteCatModal.value.id}
          isOpen={deleteCatModal.isOpen}
          onClose={() => setDeleteCatState(null)}
          onConfirm={(reassignTo) => handleConfirmDeleteCategory(reassignTo)}
          categoryName={deleteCatModal.value.name}
          categoryId={deleteCatModal.value.id}
          transactionCount={deleteCatModal.value.count}
          groups={groups}
        />
      )}

      <ConfirmModal
        isOpen={deleteCatState !== null && deleteCatState.count === 0}
        onClose={() => setDeleteCatState(null)}
        onConfirm={() => handleConfirmDeleteCategory()}
        title="Delete Category"
        message={`Delete "${deleteCatState?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
      />

      <EditCategoryModal
        category={editModalCategory}
        groups={localGroups}
        isIncome={
          editModalCategory
            ? localGroups.some(
                (g) => g.isIncome === 1 && g.categories.some((c) => c.id === editModalCategory.id),
              )
            : false
        }
        onClose={() => setEditModalCategory(null)}
        onDelete={(id) => {
          setEditModalCategory(null);
          handleDeleteCategoryClick(id);
        }}
      />
    </div>
  );
}
