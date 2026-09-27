# Security Policy

## Supported Versions

FlyBudget is a single-user, local-first app under active development. Security
fixes land on `main` and ship in the next release; older releases are not patched.

| Version                 | Supported          |
| ----------------------- | ------------------ |
| Latest release / `main` | :white_check_mark: |
| Older releases          | :x:                |

## Reporting a Vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub: go to the
[Security tab](https://github.com/dtymoszenko/FlyBudget/security) →
**Report a vulnerability**. Please include:

- what the issue is and where (file, endpoint, or screen)
- steps to reproduce or a proof of concept
- the impact you think it has
- your OS and whether you're using the web app or the desktop (Electron) app

What to expect:

- **Acknowledgement** within 7 days
- **Status updates** at least every 14 days while it's being investigated
- If **accepted**, a fix is prioritized and credited to you in the release notes
  and advisory (unless you'd rather stay anonymous)
- If **declined**, you'll get an explanation of why it isn't considered a vulnerability

This is a personal open-source project maintained in my spare time, so response
times are best-effort.

## Scope

FlyBudget runs entirely on your own machine: the API binds to `127.0.0.1`, and
your data lives in a local SQLite file. Bank-sync credentials (Plaid and SimpleFIN
tokens) are stored in that database.

Especially in scope:

- anything that lets a website, another user, or another process read or change
  FlyBudget data or bank-sync credentials
- ways to make the local API reachable from outside the machine
- vulnerabilities in the Electron desktop app

Out of scope:

- attacks that require someone who already has full access to your user account
  or machine
- vulnerabilities in third-party services (Plaid, SimpleFIN) themselves, which
  should be reported to them
- outdated dependencies with no demonstrated impact on FlyBudget (Dependabot
  already tracks these)
