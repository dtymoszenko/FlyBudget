/** The id of the app's <main>, which SkipToContent jumps to */
export const MAIN_ID = 'main-content';

/**
 * The first thing Tab reaches: jumps past the sidebar to the page. Hidden until focused.
 * Focuses <main> by hand, since a plain #main-content link would be a route under HashRouter.
 */
export function SkipToContent() {
  return (
    <a
      href={`#${MAIN_ID}`}
      onClick={(e) => {
        e.preventDefault();
        document.getElementById(MAIN_ID)?.focus();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-text focus:shadow-hover"
    >
      Skip to main content
    </a>
  );
}
