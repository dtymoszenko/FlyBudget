<p align="center">
  <img src="client/public/logo.png" alt="FlyBudget" width="80" />
</p>

<h1 align="center">FlyBudget</h1>

<p align="center">
  A fast and powerful open-source budgeting app that gives you complete control over your financial data.
</p>

<p align="center">
  <a href="https://github.com/dtymoszenko/FlyBudget/actions/workflows/ci.yml"><img src="https://github.com/dtymoszenko/FlyBudget/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/dtymoszenko/FlyBudget/actions/workflows/github-code-scanning/codeql"><img src="https://github.com/dtymoszenko/FlyBudget/actions/workflows/github-code-scanning/codeql/badge.svg" alt="CodeQL" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/dtymoszenko/FlyBudget"><img src="https://api.scorecard.dev/projects/github.com/dtymoszenko/FlyBudget/badge" alt="OpenSSF Scorecard" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/dtymoszenko/FlyBudget" alt="License: AGPL-3.0" /></a>
  <a href="https://github.com/dtymoszenko/FlyBudget/releases"><img src="https://img.shields.io/github/v/release/dtymoszenko/FlyBudget?include_prereleases&sort=semver" alt="Latest release" /></a>
  <a href="https://github.com/dtymoszenko/FlyBudget/stargazers"><img src="https://img.shields.io/github/stars/dtymoszenko/FlyBudget?style=social" alt="GitHub stars" /></a>
</p>

<p align="center">
  <a href="https://flybudget.org">Website</a> ·
  <a href="https://flybudget.org/docs/getting-started">Getting started</a> ·
  <a href="https://flybudget.org/tour/intro">Tour</a> ·
  <a href="https://flybudget.org/download">Download</a>
</p>

---

## Features

- **Zero-based budgeting**: plan every dollar by category, with carry-over from month to month
- **Accounts of every kind**: checking, credit cards, loans, investments, property, and your
  net worth across all of them
- **Bank import**: CSV files from any bank, or automatic sync with SimpleFIN or Plaid
- **Rules** that categorize, rename and split transactions as they arrive
- **Recurring bills and paychecks**, including finding them in your past transactions
- **Reports**: dashboards you arrange, a custom report builder, cash flow and a transaction
  calendar
- **Goals** for savings targets
- **Works on your phone** when self-hosted, and keeps working through a dropped connection

## Getting started

- **Desktop app (Windows, macOS, Linux):** get it from the
  [download page](https://flybudget.org/download), which picks the right file for your
  computer (or from the [latest release](https://github.com/dtymoszenko/FlyBudget/releases/latest)).
- **Your own server:** run it in Docker (below) and open it from any browser.
- **From source:**

  ```bash
  git clone https://github.com/dtymoszenko/FlyBudget.git
  cd FlyBudget
  npm ci && npm ci --prefix client && npm ci --prefix server
  npm run dev   # opens on http://localhost:5173
  ```

Then follow the [getting started guide](https://flybudget.org/docs/getting-started). The app
walks you through it too: a checklist on the dashboard tracks your first steps.

## Self-hosting

Besides the desktop app, FlyBudget can run on your own server in Docker, protected
by a password, so you can open it from any browser:

```bash
openssl rand -base64 32 > flybudget_data_key.txt   # encryption key for bank credentials
docker compose up -d                                # uses docker-compose.yml from this repo
```

Then open `http://<your-server>:3001` and create your password. See the
[self-hosting guide](https://flybudget.org/community/self-hosting) for HTTPS,
backups and updates.

## Security & privacy

FlyBudget is local-first: your data stays on your computer, with no FlyBudget
account, server, or telemetry. Bank credentials are encrypted with a key
protected by your operating system, the local API only answers the app itself,
and releases are signed so you can verify them. See [SECURITY.md](SECURITY.md)
for the full security model, what you should do to protect your data, and how to
report a vulnerability privately.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
the checks to run, and commit message conventions. Before your first pull request
is merged, you'll be asked to accept the [Contributor License Agreement](CLA.md)
with a one-line comment.

## Roadmap

Ideas we're considering (not promises):

- Imports from YNAB and other budgeting apps
- Investment projections and forecasting, and a FIRE calculator
- Envelope budgeting
- Syncing one budget between devices that also work offline
- MCP support

Have an idea? [Open an issue](https://github.com/dtymoszenko/FlyBudget/issues).

## License

FlyBudget is free software, licensed under the
[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). You can use,
study, share and modify it. If you run a modified version for other people to use
over a network, you must make your source code available to them too.
