import { useEffect, useRef } from 'react';

/**
 * Fills a form once each time it opens: `reset` runs when `openKey` becomes a new
 * non-null value (the dialog opening, or opening for another record) and never again
 * while it stays open.
 *
 * Don't reset a form from an effect that depends on query data (accounts, payees, the
 * record being edited): those refetch in the background (window focus, a sync, creating a
 * payee or category) and every refetch would wipe what the user has typed. Fill in values
 * that arrive later with a separate effect that only sets empty fields.
 */
export function useFormReset(openKey: string | null, reset: () => void) {
  const lastKey = useRef<string | null>(null);
  const resetRef = useRef(reset);
  resetRef.current = reset;

  useEffect(() => {
    if (openKey === null) {
      lastKey.current = null;
      return;
    }
    if (openKey === lastKey.current) return;
    lastKey.current = openKey;
    resetRef.current();
  }, [openKey]);
}
