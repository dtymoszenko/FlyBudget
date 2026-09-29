import { useSyncExternalStore } from 'react';

/** Below this width the sidebar becomes a slide-out drawer (Tailwind's `md` breakpoint). */
export const PHONE_MAX_WIDTH = 767;

const QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/** True on phone-sized screens (and narrow windows). */
export function useIsPhone() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
