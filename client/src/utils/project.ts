/**
 * Where FlyBudget's source code lives, linked from Settings. FlyBudget is AGPL-3.0:
 * if you run a modified version for other people over a network, point this at your
 * own source code so your users can get it (AGPL-3.0, section 13).
 */
export const SOURCE_CODE_URL = 'https://github.com/dtymoszenko/FlyBudget';
export const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

/** FlyBudget's website and user guide */
export const WEBSITE_URL = 'https://flybudget.org';
export const DOCS_URL = `${WEBSITE_URL}/docs/intro`;

/** Where people report bugs and ask for features */
export const ISSUES_URL = 'https://github.com/dtymoszenko/FlyBudget/issues';

/** How to run FlyBudget on your own server (linked from Settings → Server) */
export const SELF_HOSTING_URL = `${WEBSITE_URL}/community/self-hosting`;

/** A page of the user guide, e.g. `docsUrl('budgeting')` */
export type DocsPage =
  | 'getting-started'
  | 'accounts'
  | 'transactions'
  | 'bank-sync'
  | 'budgeting'
  | 'recurring'
  | 'reports'
  | 'rules'
  | 'goals'
  | 'backups';

export const docsUrl = (page: DocsPage) => `${WEBSITE_URL}/docs/${page}`;
