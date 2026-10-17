import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import EmojiPicker, { EmojiStyle, type EmojiClickData } from 'emoji-picker-react';

const WIDTH = 320;
const HEIGHT = 400;
const MIN_HEIGHT = 240;
const GAP = 4;
const EDGE = 8;

interface Position {
  top: number;
  left: number;
  height: number;
}

/** Below the anchor when it fits, else above, else on the roomier side, shortened to fit */
function placeBeside(anchor: DOMRect): Position {
  const below = window.innerHeight - anchor.bottom - GAP - EDGE;
  const above = anchor.top - GAP - EDGE;
  const left = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - WIDTH - EDGE));
  if (below >= HEIGHT || below >= above) {
    return {
      top: anchor.bottom + GAP,
      left,
      height: Math.max(MIN_HEIGHT, Math.min(HEIGHT, below)),
    };
  }
  const height = Math.max(MIN_HEIGHT, Math.min(HEIGHT, above));
  return { top: anchor.top - GAP - height, left, height };
}

/**
 * Emoji picker opened from a button (`anchorRef`). It's portaled to the body so a card with
 * `overflow-hidden` or a dialog can't cut it off. Closes on a click outside it or on the anchor.
 */
export function EmojiPickerPopover({
  anchorRef,
  onSelect,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Position | null>(null);

  useLayoutEffect(() => {
    function place() {
      if (anchorRef.current) setPos(placeBeside(anchorRef.current.getBoundingClientRect()));
    }
    place();
    window.addEventListener('resize', place);
    // Follow the anchor when the page or a dialog scrolls (scrolling inside the picker is ignored)
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) place();
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      // The anchor toggles the picker itself
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [anchorRef, onClose]);

  if (!pos) return null;

  return createPortal(
    <div ref={ref} className="fixed z-[60]" style={{ top: pos.top, left: pos.left }}>
      <EmojiPicker
        onEmojiClick={(data: EmojiClickData) => {
          onSelect(data.emoji);
          onClose();
        }}
        width={WIDTH}
        height={pos.height}
        searchPlaceholder="Search emoji..."
        previewConfig={{ showPreview: false }}
        // The default style loads images from a CDN, which the CSP blocks
        emojiStyle={EmojiStyle.NATIVE}
      />
    </div>,
    document.body,
  );
}
