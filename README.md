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

---

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

## Future Considerations:

- Company/Merchant Logos
- YNAB imports (and potentially other apps)
- Investment projections and forecasting
- FIRE Calculator
- Supported Hosting plans for ease of access
- Support for enevelope budgeting
- MCP Support

## License

FlyBudget is free software, licensed under the
[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). You can use,
study, share and modify it. If you run a modified version for other people to use
over a network, you must make your source code available to them too.
