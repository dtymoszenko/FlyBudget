import type { ReactNode } from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

const RELEASES_URL = 'https://github.com/dtymoszenko/FlyBudget/releases/latest';

export default function Download(): ReactNode {
  return (
    <Layout
      title="Download"
      description="Download FlyBudget for Windows, or run it on your own server"
    >
      <main className="container margin-vert--xl" style={{ maxWidth: 820 }}>
        <Heading as="h1">Download FlyBudget</Heading>
        <p>FlyBudget is free and open source. Pick the way you want to run it.</p>

        <Heading as="h2">Desktop app</Heading>
        <p>
          For Windows. Your budget is stored in a single file on your computer. On macOS and Linux,
          run the self-hosted server below (it works on your own computer too), or{' '}
          <Link to="/community/contributing">build it from source</Link>.
        </p>
        <p>
          <Link className="button button--primary button--lg" href={RELEASES_URL}>
            Get the latest release on GitHub
          </Link>
        </p>
        <p>
          Every release is signed, so you can check that the file you downloaded is the one we
          published. See the <Link to="/community/security">security overview</Link>.
        </p>

        <Heading as="h2">Self-hosted server</Heading>
        <p>
          Run FlyBudget in Docker on a home server or VPS and open it from any browser, including
          your phone. Protected by a password you choose.
        </p>
        <p>
          <Link className="button button--secondary" to="/community/self-hosting">
            Read the self-hosting guide
          </Link>
        </p>

        <Heading as="h2">Next steps</Heading>
        <p>
          Once it's running, follow <Link to="/docs/getting-started">Getting started</Link> to set
          up your accounts and your first budget.
        </p>
      </main>
    </Layout>
  );
}
