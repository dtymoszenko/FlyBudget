import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    'getting-started',
    {
      type: 'category',
      label: 'Using FlyBudget',
      collapsed: false,
      items: [
        'accounts',
        'transactions',
        'bank-sync',
        'budgeting',
        'recurring',
        'rules',
        'reports',
        'goals',
      ],
    },
    'backups',
    'faq',
  ],
};

export default sidebars;
