import { useState, useCallback, useEffect } from 'react';

/**
 * Whether the auto-hide sidebar is open: while hovered or keyboard-focused, until Escape.
 *
 * Relies on the sidebar's markup:
 * - `data-sidebar-popup` on menus portaled out of the sidebar, so focus in them keeps it open
 * - `data-escape-to="<route>"` on areas the collapsed strip hides: Escape there moves focus
 *   to the nav link with the matching `data-nav-to`
 */
export function useAutoHideExpansion(
  asideRef: React.RefObject<HTMLElement | null>,
  isAutoHide: boolean,
) {
  // Tracked in both modes, so unpinning keeps the sidebar open until the pointer leaves it
  const [hovered, setHovered] = useState(false);
  // Escape collapses it but keeps focus where it is, until the next focus or hover
  const [dismissed, setDismissed] = useState(false);
  const onMouseEnter = useCallback(() => {
    setHovered(true);
    setDismissed(false);
  }, []);
  const onMouseLeave = useCallback(() => setHovered(false), []);

  // Keyboard focus opens it like hovering does. Mouse clicks don't, or it would stay open
  // after clicking a link and moving the pointer away.
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      setDismissed(false);
      const target = e.target as Element;
      const inside =
        !!asideRef.current?.contains(target) || !!target.closest?.('[data-sidebar-popup]');
      setKeyboardFocus(inside && target.matches(':focus-visible'));
    };
    // Focus going nowhere (clicking empty space, or leaving the window)
    const onFocusOut = (e: FocusEvent) => {
      if (!e.relatedTarget) setKeyboardFocus(false);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  const isExpanded = isAutoHide ? (hovered || keyboardFocus) && !dismissed : true;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as Element;

    // Keys from its portaled menus bubble here through React, but Escape there closes the menu
    if (e.key !== 'Escape' || e.defaultPrevented || !asideRef.current?.contains(target)) return;
    if (!isExpanded || !isAutoHide) return;

    const hidden = target.closest<HTMLElement>('[data-escape-to]');
    if (hidden) {
      asideRef.current
        .querySelector<HTMLElement>(`[data-nav-to="${hidden.dataset.escapeTo}"]`)
        ?.focus();
    }
    setDismissed(true); // After focus(), whose focusin would reopen it
  };

  return { isExpanded, onMouseEnter, onMouseLeave, onKeyDown };
}
