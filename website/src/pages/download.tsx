import { useEffect, useState, type ReactNode } from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './download.module.css';

const REPO = 'https://github.com/dtymoszenko/FlyBudget';
const RELEASES_URL = `${REPO}/releases/latest`;
/** The latest release's file with this name (release.yml gives files names without versions) */
const file = (name: string) => `${REPO}/releases/latest/download/${name}`;

type Platform = 'windows' | 'mac' | 'linux';

interface Download {
  label: string;
  note: string;
  href: string;
}

const DOWNLOADS: Record<Platform, { name: string; requires: string; files: Download[] }> = {
  windows: {
    name: 'Windows',
    requires: 'Windows 10 or 11, 64-bit',
    files: [
      {
        label: 'Installer (.exe)',
        note: 'For most PCs',
        href: file('FlyBudget-Windows-Setup.exe'),
      },
    ],
  },
  mac: {
    name: 'macOS',
    requires: 'macOS 12 Monterey or later',
    files: [
      {
        label: 'Apple silicon (.dmg)',
        note: 'Macs with an M1 chip or newer (2020 and later)',
        href: file('FlyBudget-macOS-arm64.dmg'),
      },
      {
        label: 'Intel (.dmg)',
        note: 'Older Macs with an Intel processor',
        href: file('FlyBudget-macOS-x64.dmg'),
      },
    ],
  },
  linux: {
    name: 'Linux',
    requires: '64-bit Linux, x86 or ARM',
    files: [
      {
        label: 'Ubuntu and Debian (.deb)',
        note: 'Also Linux Mint, Pop!_OS and other Debian-based systems',
        href: file('FlyBudget-Linux-amd64.deb'),
      },
      {
        label: 'Any distribution (.AppImage)',
        note: 'Fedora, Arch, openSUSE and others',
        href: file('FlyBudget-Linux-x86_64.AppImage'),
      },
      {
        label: 'ARM (.deb, .AppImage)',
        note: 'Raspberry Pi 4 and 5, ARM laptops',
        href: RELEASES_URL,
      },
    ],
  },
};

/** What to do the first time: none of the downloads are signed with a paid certificate yet */
const FIRST_RUN: Record<Platform, ReactNode> = {
  windows: (
    <>
      Run the installer. If Windows says <em>Windows protected your PC</em>, choose{' '}
      <strong>More info</strong>, then <strong>Run anyway</strong>: FlyBudget isn't signed with a
      paid Microsoft certificate yet.
    </>
  ),
  mac: (
    <>
      Open the .dmg and drag FlyBudget to <strong>Applications</strong>. The first time you open it,
      macOS says it can't check it for malicious software, because FlyBudget isn't notarized by
      Apple yet. Open <strong>System Settings → Privacy &amp; Security</strong>, scroll down, and
      choose <strong>Open Anyway</strong> next to FlyBudget.
    </>
  ),
  linux: (
    <>
      <strong>.deb</strong>: open it with your software installer, or run{' '}
      <code>sudo apt install ./FlyBudget-Linux-amd64.deb</code>. <strong>AppImage</strong>: make it
      executable (<code>chmod +x FlyBudget-Linux-x86_64.AppImage</code>) and run it. On Ubuntu 24.04
      and later, use the .deb: AppImages can't start Electron apps there without extra setup.
    </>
  ),
};

const PLATFORMS: Platform[] = ['windows', 'mac', 'linux'];

/** The visitor's system, from the browser (null on phones and anything unrecognized) */
function detectPlatform(): Platform | null {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } };
  if (nav.userAgentData?.mobile) return null;
  const hint = (nav.userAgentData?.platform || navigator.userAgent).toLowerCase();
  if (/android|iphone|ipad/.test(navigator.userAgent.toLowerCase())) return null;
  if (hint.includes('win')) return 'windows';
  if (hint.includes('mac')) return 'mac';
  if (hint.includes('linux') || hint.includes('x11')) return 'linux';
  return null;
}

function Recommended({ platform }: { platform: Platform }): ReactNode {
  const info = DOWNLOADS[platform];
  const main = info.files[0];
  return (
    <div className={styles.recommended}>
      <a className={styles.primaryButton} href={main.href}>
        Download for {info.name}
      </a>
      <p className={styles.recommendedNote}>
        {main.label}: {main.note}. Needs {info.requires}.
        {platform === 'mac' && (
          <>
            {' '}
            Intel Mac? <a href={info.files[1].href}>Download the Intel version</a>.
          </>
        )}
      </p>
    </div>
  );
}

export default function DownloadPage(): ReactNode {
  // Detected after the first render: the page is built ahead of time, without a browser
  const [platform, setPlatform] = useState<Platform | null>(null);
  useEffect(() => setPlatform(detectPlatform()), []);
  const ordered = platform ? [platform, ...PLATFORMS.filter((p) => p !== platform)] : PLATFORMS;

  return (
    <Layout
      title="Download"
      description="Download FlyBudget for Windows, macOS or Linux, or run it on your own server"
    >
      <main className={styles.page}>
        <header className={styles.header}>
          <Heading as="h1" className={styles.title}>
            Download FlyBudget
          </Heading>
          <p className={styles.lead}>
            Free and open source. Your budget stays in a file on your computer: no account, no
            subscription.
          </p>
          {platform && <Recommended platform={platform} />}
        </header>

        <section aria-labelledby="desktop" className={styles.section}>
          <Heading as="h2" id="desktop" className={styles.sectionTitle}>
            Desktop app
          </Heading>
          <div className={styles.platforms}>
            {ordered.map((p) => (
              <div key={p} className={styles.platform}>
                <Heading as="h3" className={styles.platformName}>
                  {DOWNLOADS[p].name}
                </Heading>
                <p className={styles.requires}>{DOWNLOADS[p].requires}</p>
                <ul className={styles.files}>
                  {DOWNLOADS[p].files.map((f) => (
                    <li key={f.label}>
                      <a href={f.href}>{f.label}</a>
                      <span>{f.note}</span>
                    </li>
                  ))}
                </ul>
                <p className={styles.firstRun}>{FIRST_RUN[p]}</p>
              </div>
            ))}
          </div>
          <p className={styles.after}>
            Then follow <Link to="/docs/getting-started">Getting started</Link> to add your accounts
            and plan your first budget. To update, download the new version and install it over the
            old one: your budget stays where it is.
          </p>
        </section>

        <section aria-labelledby="server" className={styles.section}>
          <Heading as="h2" id="server" className={styles.sectionTitle}>
            Your own server
          </Heading>
          <p>
            Run FlyBudget in Docker on a home server, a NAS or a small cloud machine, and open it
            from any browser, including your phone. A password you choose protects it.
          </p>
          <pre className={styles.command}>
            <code>
              openssl rand -base64 32 {'>'} flybudget_data_key.txt{'\n'}docker compose up -d
            </code>
          </pre>
          <p>
            <Link to="/community/self-hosting">Read the self-hosting guide</Link> for the Compose
            file, HTTPS, backups and updates.
          </p>
        </section>

        <section aria-labelledby="more" className={styles.section}>
          <Heading as="h2" id="more" className={styles.sectionTitle}>
            More ways to get it
          </Heading>
          <ul className={styles.more}>
            <li>
              <Link to="pathname:///demo/" target="_self">
                Try the demo
              </Link>{' '}
              in your browser first, with a sample budget. Nothing to install.
            </li>
            <li>
              <a href={RELEASES_URL}>All files for the latest release</a>, with their checksums (
              <code>SHA256SUMS.txt</code>) and signatures. Every file is built by GitHub from the
              public source and signed:{' '}
              <Link to="/community/security#verifying-your-download">verify your download</Link>.
            </li>
            <li>
              <Link to="/docs/installing#from-source">Build it from source</Link> to try the latest
              changes or help develop FlyBudget.
            </li>
          </ul>
        </section>
      </main>
    </Layout>
  );
}
