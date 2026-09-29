import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClasses = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-3xl' };
// Matches --animate-dialog-out / --animate-sheet-out / --animate-fade-out in index.css
const EXIT_MS = 120;

/**
 * For modals that only exist while there's something to show (e.g. the item being edited):
 * keeps the last value around for the fade-out after it's cleared.
 *
 *   const edit = useModalValue(editGoal);
 *   {edit.value && <GoalFormModal isOpen={edit.isOpen} editGoal={edit.value} … />}
 */
export function useModalValue<T>(value: T | null | undefined | false) {
  const isOpen = value != null && value !== false;
  const [last, setLast] = useState<T | null>(isOpen ? value : null);
  if (isOpen && last !== value) setLast(value);

  useEffect(() => {
    if (isOpen) return;
    const t = setTimeout(() => setLast(null), EXIT_MS);
    return () => clearTimeout(t);
  }, [isOpen]);

  return { value: isOpen ? value : last, isOpen };
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: Props) {
  // Stay mounted briefly after closing so the dialog can fade out
  const [mounted, setMounted] = useState(isOpen);
  if (isOpen && !mounted) setMounted(true);
  const closing = mounted && !isOpen;
  const titleId = useId();

  // While fading out, keep showing what was on screen: parents often clear the data a modal
  // was showing (e.g. the transaction being edited) in the same update that closes it
  const shown = useRef({ title, children });
  if (isOpen) shown.current = { title, children };

  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [closing]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className={`fixed inset-0 z-50 overflow-y-auto ${closing ? 'pointer-events-none' : ''}`}>
      <div
        className={`fixed inset-0 bg-black/30 backdrop-blur-sm cursor-pointer ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={onClose}
      />
      {/* Tall dialogs scroll with the page instead of getting cut off. Phones: a sheet that
          slides up from the bottom edge, full width, clear of the home indicator */}
      <div className="relative min-h-full flex items-center max-md:items-end justify-center p-4 max-md:p-0 max-md:pt-12 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={`relative w-full ${sizeClasses[size]} max-md:max-w-none bg-surface rounded-lg max-md:rounded-b-none max-md:rounded-t-xl shadow-modal max-md:pb-[env(safe-area-inset-bottom)] ${closing ? 'animate-dialog-out max-md:animate-sheet-out' : 'pointer-events-auto animate-dialog-in max-md:animate-sheet-in'}`}
        >
          <div className="flex items-center justify-between px-6 max-md:px-4 py-4 max-md:py-2 border-b border-border">
            <h2 id={titleId} className="text-base font-semibold text-text">
              {shown.current.title}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1 max-md:-mr-2 max-md:min-w-11 max-md:min-h-11 flex items-center justify-center rounded-md text-text-tertiary hover:text-text-secondary hover:bg-surface-alt transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          <div className="px-6 max-md:px-4 py-5">{shown.current.children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
