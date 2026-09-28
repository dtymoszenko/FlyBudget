import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  communitySidebar: [
    'intro',
    {
      type: 'category',
      label: 'Contributing',
      // The category itself opens the contributing overview (community/contributing/index.mdx)
      link: { type: 'doc', id: 'contributing/index' },
      collapsed: false,
      items: ['contributing/ai-usage', 'contributing/commit-conventions'],
    },
    'self-hosting',
    'security',
    {
      type: 'link',
      label: 'Current Bug Reports',
      href: 'https://github.com/dtymoszenko/flybudget/issues?q=label%3Abug',
    },
    {
      type: 'link',
      label: 'New Feature Requests',
      href: 'https://github.com/dtymoszenko/flybudget/issues?q=label%3Aenhancement',
    },
  ],
};

export default sidebars;
