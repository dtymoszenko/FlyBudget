import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Opens a dialog when the page is reached with `?<param>=1` (e.g. `/transactions?add=1`
 * from a button on the dashboard), then drops the parameter so going back or reloading
 * doesn't open it again.
 */
export function useOpenFromLink(param: string, open: () => void) {
  const [params, setParams] = useSearchParams();
  const openRef = useRef(open);
  openRef.current = open;

  const requested = params.get(param) === '1';
  useEffect(() => {
    if (!requested) return;
    openRef.current();
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(param);
        return next;
      },
      { replace: true },
    );
  }, [requested, param, setParams]);
}
