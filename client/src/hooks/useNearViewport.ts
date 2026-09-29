import { useEffect, useRef, useState } from 'react';

/** How far outside the visible area an element counts as "near", so it's ready before it scrolls in */
const NEAR_PX = 300;

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/**
 * True once the element has been on screen or within `NEAR_PX` of it, and stays true after
 * that. Lets long pages draw (and fetch data for) only what the user can actually see.
 */
export function useNearViewport<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    // Watch against the scrolling box the element sits in: with the window as the root, the
    // margin wouldn't reach past that box's edges
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { root: scrollParent(el), rootMargin: `${NEAR_PX}px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);

  return { ref, near };
}
