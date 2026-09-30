import type { ReactNode } from 'react';
import Link from '@docusaurus/Link';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import ThemedImage from '@theme/ThemedImage';
import useBaseUrl from '@docusaurus/useBaseUrl';

import styles from './index.module.css';

function HeroSection(): ReactNode {
  return (
    <header className={styles.hero}>
      <div className={styles.heroContainer}>
        <div className={styles.heroGrid}>
          <div className={styles.heroText}>
            <Heading as="h1" className={styles.heroHeadline}>
              Plan your money.
              <br />
              Keep it private.
            </Heading>
            <p className={styles.heroDescription}>
              FlyBudget is a free budgeting app. Plan every dollar, track your accounts, and keep
              your financial data on your own computer or server. No subscription. No account
              required.
            </p>
            <div className={styles.ctaRow}>
              <Link className={styles.ctaPrimary} to="/download">
                Download FlyBudget
              </Link>
              {/* A static app next to the website (scripts/build-demo.mjs), not a Docusaurus page */}
              <Link className={styles.ctaSecondary} to="pathname:///demo/" target="_self">
                Try the Demo
              </Link>
            </div>
            <p className={styles.heroFacts}>
              Open source (AGPL). Available for Windows or self-host with Docker.
            </p>
          </div>
          <div className={styles.heroArtwork}>
            <img
              src="/img/hero-decoration.svg"
              className={styles.heroDecoration}
              alt=""
              aria-hidden="true"
              width="560"
              height="420"
            />
            <img
              src="/img/logo.png"
              className={styles.heroMoney}
              alt="FlyBudget — flying money illustration"
              width="480"
              height="480"
            />
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * A screenshot of the app (static/img/screenshots, taken from the demo by e2e/screenshots.ts):
 * the dark-mode version when the website is dark.
 */
function Screenshot({
  name,
  alt,
  width,
  height,
  className,
}: {
  name: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
}): ReactNode {
  return (
    <ThemedImage
      className={className}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      sources={{
        light: useBaseUrl(`/img/screenshots/${name}.webp`),
        dark: useBaseUrl(`/img/screenshots/dark-${name}.webp`),
      }}
    />
  );
}

interface Highlight {
  title: string;
  text: string;
  points: string[];
  doc: string;
  docLabel: string;
  shot: { name: string; alt: string; width: number; height: number; dialog?: boolean };
}

const HIGHLIGHTS: Highlight[] = [
  {
    title: 'Give every dollar a job',
    text: 'Plan the month category by category, and watch what’s left as you spend. Bars turn amber as a category gets close to its plan and red when it goes over, so you can adjust before the month ends.',
    points: [
      'Planned, actual and remaining for every category',
      'Money you haven’t planned carries into next month',
      'Each category’s history is one click away',
    ],
    doc: '/docs/budgeting',
    docLabel: 'How budgeting works',
    shot: { name: 'budget', alt: 'The budget for the month', width: 2880, height: 1800 },
  },
  {
    title: 'Sort transactions once, then never again',
    text: 'Write a rule in plain words, see which past transactions it matches while you type, and let it rename, categorize or split everything that comes in after.',
    points: [
      'Matches bank text, payees, amounts, dates and more',
      'Splits by amount or percentage',
      'Runs on imports, bank syncs and what you type',
    ],
    doc: '/docs/rules',
    docLabel: 'How rules work',
    shot: {
      name: 'rule-editor',
      alt: 'Editing a rule that renames and categorizes coffee purchases',
      width: 1536,
      height: 1288,
      dialog: true,
    },
  },
  {
    title: 'Reports you arrange yourself',
    text: 'Build dashboards from net worth, income and expenses, spending trends, a transaction calendar and your own custom reports. Drag them into place, and give each one the dates you care about.',
    points: [
      'Several dashboards, each with its own date range',
      'A report builder for everything else',
      'Every number exports to CSV',
    ],
    doc: '/docs/reports',
    docLabel: 'Using reports',
    shot: { name: 'reports', alt: 'A report dashboard', width: 2880, height: 1800 },
  },
  {
    title: 'Follow every dollar',
    text: 'Cash Flow draws your income flowing into each group of spending and on into single categories, with what you saved on top: one picture of where the month went.',
    points: ['Any period, from one month to a year', 'Totals and your savings rate at the top'],
    doc: '/docs/reports#cash-flow',
    docLabel: 'About Cash Flow',
    shot: {
      name: 'cash-flow',
      alt: 'Cash flow from income to spending categories',
      width: 2880,
      height: 1800,
    },
  },
];

const PHONES = [
  { name: 'phone-budget', alt: 'The budget on a phone' },
  { name: 'phone-dashboard', alt: 'The dashboard on a phone' },
  { name: 'phone-transactions', alt: 'Transactions on a phone' },
];

function HighlightRow({ title, text, points, doc, docLabel, shot }: Highlight): ReactNode {
  return (
    <div className={styles.highlight}>
      <div className={styles.highlightText}>
        <Heading as="h3" className={styles.highlightTitle}>
          {title}
        </Heading>
        <p>{text}</p>
        <ul className={styles.highlightPoints}>
          {points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <Link className={styles.highlightLink} to={doc}>
          {docLabel}
        </Link>
      </div>
      <div className={shot.dialog ? styles.highlightDialog : styles.highlightShot}>
        <Screenshot
          className={styles.shotFrame}
          name={shot.name}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
        />
      </div>
    </div>
  );
}

function HighlightsSection(): ReactNode {
  return (
    <section className={styles.highlights} aria-labelledby="highlights-title">
      <div className={styles.productShot}>
        <Screenshot
          className={styles.productFrame}
          name="dashboard"
          alt="The FlyBudget dashboard: net worth, left to spend, cash flow, spending and upcoming bills"
          width={2880}
          height={1800}
        />
      </div>
      <div className={styles.highlightsContainer}>
        <Heading as="h2" id="highlights-title" className={styles.highlightsTitle}>
          Your whole financial picture, on one screen
        </Heading>
        <p className={styles.highlightsIntro}>
          The dashboard shows your net worth, what’s left to spend this month, the bills coming up
          and where your money went. Every number comes from your own accounts, and every card opens
          the page behind it.
        </p>
        {HIGHLIGHTS.map((h) => (
          <HighlightRow key={h.title} {...h} />
        ))}
        <div className={`${styles.highlight} ${styles.highlightPhones}`}>
          <div className={styles.highlightText}>
            <Heading as="h3" className={styles.highlightTitle}>
              On your phone, too
            </Heading>
            <p>
              Run FlyBudget on a server of your own and open it from any browser. Every page has a
              layout made for small screens, and transactions you add without a connection are saved
              as soon as it’s back.
            </p>
            <Link className={styles.highlightLink} to="/docs/phone">
              Using FlyBudget on your phone
            </Link>
          </div>
          <div className={styles.phones}>
            {PHONES.map((p) => (
              <Screenshot
                key={p.name}
                className={styles.phoneFrame}
                name={p.name}
                alt={p.alt}
                width={780}
                height={1688}
              />
            ))}
          </div>
        </div>
        <div className={styles.highlightsCta}>
          {/* A static app next to the website (scripts/build-demo.mjs), not a Docusaurus page */}
          <Link className={styles.demoButton} to="pathname:///demo/" target="_self">
            Try it with a sample budget
          </Link>
          <p>It runs in your browser: nothing to install, and nothing you change is saved.</p>
        </div>
      </div>
    </section>
  );
}

// Icons from Lucide (the same set, and the same icon for each page, as the app's sidebar)
function Icon({ children }: { children: ReactNode }): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

interface Feature {
  title: string;
  icon: ReactNode;
  text: string;
  /** The user guide page that explains it */
  doc: string;
  docLabel: string;
}

const FEATURES: Feature[] = [
  {
    title: 'Plan every dollar',
    icon: (
      <Icon>
        <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
        <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
      </Icon>
    ),
    text: "Give each dollar a category at the start of the month. What you don't spend carries over, so you always know what's left.",
    doc: '/docs/budgeting',
    docLabel: 'How budgeting works',
  },
  {
    title: 'Connect your bank',
    icon: (
      <Icon>
        <line x1="3" x2="21" y1="22" y2="22" />
        <line x1="6" x2="6" y1="18" y2="11" />
        <line x1="10" x2="10" y1="18" y2="11" />
        <line x1="14" x2="14" y1="18" y2="11" />
        <line x1="18" x2="18" y1="18" y2="11" />
        <polygon points="12 2 20 7 4 7" />
      </Icon>
    ),
    text: 'Bring in transactions automatically with SimpleFIN or Plaid, or import a CSV file from your bank. Syncing is optional.',
    doc: '/docs/bank-sync',
    docLabel: 'Connecting a bank',
  },
  {
    title: 'Let rules do the sorting',
    icon: (
      <Icon>
        <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
      </Icon>
    ),
    text: 'Rules categorize, rename and split new transactions for you, whether you type them in, import them or sync them.',
    doc: '/docs/rules',
    docLabel: 'How rules work',
  },
  {
    title: 'See bills before they’re due',
    icon: (
      <Icon>
        <path d="m17 2 4 4-4 4" />
        <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
        <path d="m7 22-4-4 4-4" />
        <path d="M21 13v1a4 4 0 0 1-4 4H3" />
      </Icon>
    ),
    text: 'Keep track of bills, subscriptions and paychecks. FlyBudget can find the ones that repeat in your past transactions.',
    doc: '/docs/recurring',
    docLabel: 'Tracking recurring bills',
  },
  {
    title: 'Understand your spending',
    icon: (
      <Icon>
        <path d="M3 3v16a2 2 0 0 0 2 2h16" />
        <path d="M18 17V9" />
        <path d="M13 17V5" />
        <path d="M8 17v-3" />
      </Icon>
    ),
    text: 'Net worth, income and expenses, spending by category and a transaction calendar, on dashboards you arrange yourself.',
    doc: '/docs/reports',
    docLabel: 'Using reports',
  },
  {
    title: 'Save toward goals',
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </Icon>
    ),
    text: 'Set a target for an emergency fund, a trip or a down payment, and watch your progress as you save.',
    doc: '/docs/goals',
    docLabel: 'Setting goals',
  },
];

function SmallFeature({ title, icon, text, doc, docLabel }: Feature): ReactNode {
  return (
    <div className={styles.smallFeature}>
      <div className={styles.smallFeatureIcon}>{icon}</div>
      <div>
        <h3 className={styles.smallFeatureTitle}>{title}</h3>
        <p className={styles.smallFeatureText}>{text}</p>
        <Link className={styles.smallFeatureLink} to={doc}>
          {docLabel}
        </Link>
      </div>
    </div>
  );
}

function FeaturesSection(): ReactNode {
  // The navbar's "Features" link jumps here; registering the id lets the build check that link
  useBrokenLinks().collectAnchor('features');
  return (
    <section id="features" className={styles.featuresSection}>
      <img
        src="/img/homepage/footer-bg.svg"
        className={styles.footerBg}
        alt=""
        aria-hidden="true"
      />
      <div className={styles.featuresContainer}>
        <Heading as="h2" className={styles.featuresSectionHeader}>
          Why FlyBudget?
        </Heading>
        <div className={styles.smallFeaturesGrid}>
          {FEATURES.map((f) => (
            <SmallFeature key={f.doc} {...f} />
          ))}
        </div>

        <div className={styles.ownDataSection}>
          <h2 className={styles.ownDataTitle}>Own your data</h2>
          <p className={styles.ownDataText}>
            Your budget lives in one file on your computer, or on a server you run. There's no
            FlyBudget account, no subscription and no tracking, and you can download a full backup
            whenever you like.
          </p>
          <p className={styles.ownDataLinks}>
            <Link to="/community/security">How your data is protected</Link>
            <Link to="/docs/backups">Backups and exports</Link>
          </p>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout description={siteConfig.tagline}>
      <HeroSection />
      <main>
        <HighlightsSection />
        <FeaturesSection />
      </main>
    </Layout>
  );
}
