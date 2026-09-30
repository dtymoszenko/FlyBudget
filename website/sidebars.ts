import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    'installing',
    'getting-started',
    {
      type: 'category',
      label: 'Using FlyBudget',
      collapsed: false,
      items: [
        'dashboard',
        'accounts',
        'transactions',
        'importing',
        'bank-sync',
        'budgeting',
        'recurring',
        'rules',
        'reports',
        'goals',
        'payees',
        'settings',
      ],
    },
    {
      type: 'category',
      label: 'Other devices',
      collapsed: false,
      items: ['phone', 'offline'],
    },
    'backups',
    'privacy',
    'faq',
  ],
};

export default sidebars;
