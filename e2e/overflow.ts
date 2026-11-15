// Checks for content that doesn't fit, shared by the phone tests and the screenshot script.
import type { Page } from '@playwright/test';

/**
 * What doesn't fit sideways: the document, and every scrolling area of the page (a page
 * that scrolls up and down must not also scroll sideways), plus content that sticks out
 * past the right edge. Strips that scroll only sideways on purpose (tabs, wide tables in
 * an `overflow-x-auto` box) are fine.
 */
export async function sidewaysOverflow(page: Page) {
  return page.evaluate(() => {
    // The page's own scrolling areas (main, and anything else that scrolls up and down)
    const scrollsDown = (el: Element) =>
      /auto|scroll/.test(getComputedStyle(el).overflowY) &&
      (el.tagName === 'MAIN' || el.scrollHeight > el.clientHeight + 2);
    const sidewaysOnly = (el: Element) =>
      /auto|scroll/.test(getComputedStyle(el).overflowX) && !scrollsDown(el);
    const name = (el: Element) =>
      `<${el.tagName.toLowerCase()}> "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`;
    const problems: string[] = [];
    const extra = document.documentElement.scrollWidth - window.innerWidth;
    if (extra > 0) problems.push(`document +${extra}px`);
    // Only the content area scrolls up and down, never the window itself
    const below = document.documentElement.scrollHeight - window.innerHeight;
    if (below > 0) problems.push(`document scrolls down +${below}px`);
    for (const el of document.querySelectorAll('body *')) {
      if (scrollsDown(el) && el.scrollWidth > el.clientWidth + 1) {
        problems.push(`${name(el)} scrolls sideways +${el.scrollWidth - el.clientWidth}px`);
      }
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || box.right <= window.innerWidth + 1) continue;
      let parent = el.parentElement;
      while (parent && !sidewaysOnly(parent)) parent = parent.parentElement;
      if (!parent) problems.push(`${name(el)} ends at ${Math.round(box.right)}px`);
    }
    return problems.slice(0, 4);
  });
}

export interface ClippedText {
  /** The element, like `<span> "Bank access ends on …"` */
  element: string;
  text: string;
  /**
   * `label`: UI text that's cut off (the pseudo-language wraps UI text in ⟦…⟧), which needs
   * a fix. `data`: a name or other data cut off without a `title` to read it in full.
   */
  kind: 'label' | 'data';
}

/**
 * Text that's cut off sideways: elements that hide what doesn't fit (`overflow: hidden` or
 * `clip`, or an ellipsis) and are narrower than their content. Data with a `title` is fine.
 */
export async function clippedText(page: Page): Promise<ClippedText[]> {
  return page.evaluate(() => {
    const found: ClippedText[] = [];
    const elements: Element[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('svg')) continue;
      const style = getComputedStyle(el);
      const clips = /hidden|clip/.test(style.overflowX) || style.textOverflow === 'ellipsis';
      if (!clips || el.scrollWidth <= el.clientWidth + 1) continue;
      const box = el.getBoundingClientRect();
      // Hidden, or only for screen readers (sr-only is 1px wide on purpose)
      if (box.width <= 1 || box.height <= 1) continue;
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      if (!text) continue;
      // Pseudo-language text: wrapped in ⟦…⟧, or (a part inside a <Trans> tag) mostly accented
      const letters = text.match(/\p{L}/gu) ?? [];
      const accented = letters.filter((c) => /[\u00C0-\u02AF]/.test(c)).length;
      const kind: ClippedText['kind'] =
        text.includes('⟦') || (letters.length > 0 && accented * 2 >= letters.length)
          ? 'label'
          : 'data';
      if (kind === 'data' && el.closest('[title]')) continue;
      // Nested elements that cut off the same text: report the innermost (parents come first)
      if (
        elements.length &&
        elements.at(-1)!.contains(el) &&
        found.at(-1)!.text === text.slice(0, 80)
      ) {
        found.pop();
        elements.pop();
      }
      elements.push(el);
      found.push({
        element: `<${el.tagName.toLowerCase()}> "${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"`,
        text: text.slice(0, 80),
        kind,
      });
    }
    return found;
  });
}
