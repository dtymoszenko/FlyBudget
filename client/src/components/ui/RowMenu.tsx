import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import { PHONE_MAX_WIDTH } from '../../hooks/useIsPhone';

export interface RowMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
}

const MENU_W = 200;

/** ⋮ button that opens a portal popover of actions. Closes on outside click, scroll, or ESC. */
export default function RowMenu({
  items,
  label = 'Actions',
}: {
  items: RowMenuItem[];
  /** The button's accessible name, e.g. "Actions for Rent" when a page has several */
  label?: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const visible = items.filter((i) => !i.hidden);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      )
        close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);

  if (!visible.length) return <span className="w-7" />;

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (pos) return setPos(null);
    const r = btnRef.current!.getBoundingClientRect();
    // Items are taller on phones (touch-sized), which decides whether it opens upward
    const itemH = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`).matches ? 44 : 34;
    const menuH = visible.length * itemH + 8;
    const top = r.bottom + 4 + menuH > window.innerHeight ? r.top - 4 - menuH : r.bottom + 4;
    setPos({ top, left: Math.max(8, r.right - MENU_W) });
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        className={`p-1 max-md:min-w-11 max-md:min-h-11 flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-hover transition-colors cursor-pointer ${
          pos ? 'bg-hover text-text-secondary' : ''
        }`}
      >
        <MoreVertical size={15} />
      </button>
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            className="fixed z-50 bg-surface border border-border rounded-md shadow-hover py-1 animate-menu-in"
            style={{ top: pos.top, left: pos.left, width: MENU_W }}
          >
            {visible.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                onClick={() => {
                  setPos(null);
                  item.onClick();
                }}
                className={`w-full text-left px-3 py-2 max-md:py-3 text-sm transition-colors cursor-pointer ${
                  item.danger
                    ? 'text-negative hover:bg-negative-subtle'
                    : 'text-text hover:bg-hover'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
