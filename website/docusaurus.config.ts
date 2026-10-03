import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'FlyBudget',
  tagline:
    'A fast, open-source budgeting app that gives you complete control over your financial data.',
  favicon: 'img/logo.png',

  future: {
    v4: true,
  },

  url: 'https://flybudget.org',
  baseUrl: '/',

  organizationName: 'dtymoszenko',
  projectName: 'flybudget',

  stylesheets: [
    {
      href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
      type: 'text/css',
    },
  ],

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexBlog: true,
        indexDocs: true,
        indexPages: false,
        language: ['en'],
      },
    ],
  ],

  plugins: [
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'tour',
        path: 'tour',
        routeBasePath: 'tour',
        sidebarPath: './sidebarsTour.ts',
        editUrl: 'https://github.com/dtymoszenko/flybudget/tree/main/website/',
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'community',
        path: 'community',
        routeBasePath: 'community',
        sidebarPath: './sidebarsCommunity.ts',
        editUrl: 'https://github.com/dtymoszenko/flybudget/tree/main/website/',
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/dtymoszenko/flybudget/tree/main/website/',
        },
        blog: {
          blogSidebarTitle: 'All Posts',
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl: 'https://github.com/dtymoszenko/flybudget/tree/main/website/',
          // Useful options to enforce blogging best practices
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/logo.png',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'FlyBudget',
      logo: {
        alt: 'FlyBudget Logo',
        src: 'img/logo.png',
      },
      items: [
        { to: '/#features', label: 'Features', position: 'left', activeBaseRegex: '$^' },
        {
          type: 'docSidebar',
          sidebarId: 'tourSidebar',
          docsPluginId: 'tour',
          position: 'left',
          label: 'Tour',
        },
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Docs',
        },
        { to: '/blog', label: 'Blog', position: 'left' },
        {
          type: 'docSidebar',
          sidebarId: 'communitySidebar',
          docsPluginId: 'community',
          position: 'left',
          label: 'Community',
        },
        { to: '/download', label: 'Download', position: 'left' },
        {
          href: 'https://github.com/dtymoszenko/flybudget',
          label: 'GitHub',
          position: 'right',
          // Shown as an icon next to the dark mode toggle on phones (src/css/custom.css)
          className: 'header-github-link',
          'aria-label': 'FlyBudget on GitHub',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        { label: 'Docs', to: '/docs/intro' },
        { label: 'Download', to: '/download' },
        { label: 'Blog', to: '/blog' },
        { label: 'Security', to: '/community/security' },
        { label: 'GitHub', href: 'https://github.com/dtymoszenko/flybudget' },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} FlyBudget. Free software under the AGPL-3.0 license.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
