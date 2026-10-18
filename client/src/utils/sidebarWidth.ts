/** The desktop sidebar's width, in pixels: dragged by its edge, remembered per device */
export const SIDEBAR_DEFAULT_WIDTH = 208;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 320;
/** How far one arrow key press moves the edge */
export const SIDEBAR_WIDTH_STEP = 16;

/** A width the sidebar can have: whole pixels between the min and max (the default for anything else) */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}
