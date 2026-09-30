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

FlyBudget runs entirely on your own machine. See [How FlyBudget protects your
data](#how-flybudget-protects-your-data) below for the full model.

Especially in scope:

- anything that lets a website, another user, or another process read or change
  FlyBudget data or bank-sync credentials
- ways to make the local API reachable from outside the machine
- vulnerabilities in the Electron desktop app
- in the self-hosted Docker server: getting past the password login, stealing
  or forging sessions, or reading data or credentials without logging in

Out of scope:

- attacks that require someone who already has full access to your user account
  or machine
- vulnerabilities in third-party services (Plaid, SimpleFIN) themselves, which
  should be reported to them
- outdated dependencies with no demonstrated impact on FlyBudget (Dependabot
  already tracks these)

## How FlyBudget protects your data

FlyBudget is local-first: there is no FlyBudget server, account, telemetry, or
crash reporting. Your data never leaves your computer except when bank sync
talks to Plaid or SimpleFIN on your behalf.

You can also host FlyBudget yourself with Docker ("server mode", see
[Self-hosting](https://flybudget.org/community/self-hosting)). Then the data
lives on your server, and:

- a password protects every API route (scrypt hash; 10 failed attempts per 15
  minutes, then blocked). Setting the first password also needs a one-time setup
  code printed only in the server log, so whoever reaches a fresh server first
  (or a website using DNS rebinding) can't claim it
- behind HTTPS (`FLYBUDGET_TRUST_PROXY`), responses carry HSTS
- sessions are random 256-bit tokens, stored server-side only as SHA-256
  hashes, sent in an HttpOnly, SameSite=Strict cookie (Secure over HTTPS),
  expiring after 30 days; changing the password ends every other session.
  Settings → Server lists signed-in devices (by an opaque id that can't be used
  to sign in) so you can sign any of them out
- visitors who aren't signed in learn nothing about the server: `/api/health`
  only says it's up, and the version and security check (Settings → Server)
  need a session. The security check names the setting that fixes each
  warning, never a secret value
- the server refuses to start without a credential encryption key, supplied as
  a Docker secret (`FLYBUDGET_DATA_KEY_FILE`) rather than stored with the
  database
- the container runs as an unprivileged user; the example Compose file adds a
  read-only filesystem, drops all capabilities and sets `no-new-privileges`
- images are built in GitHub Actions for amd64 and arm64 without a shared build
  cache, base images are pinned by digest, npm registry signatures are verified
  during the build, each image has an SBOM and signed SLSA build provenance, and
  images are scanned for known vulnerabilities (Grype) weekly
  (`gh attestation verify oci://ghcr.io/dtymoszenko/flybudget:<version> -R dtymoszenko/FlyBudget`)

Run it behind an HTTPS reverse proxy before exposing it to the internet.

### What is stored, and where

| Data                               | Location (desktop app)                     | Protection                                                                                        |
| ---------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Budget, accounts, transactions     | `budget.db` in the app's data folder       | Your OS user account (not encrypted by FlyBudget; see below)                                      |
| Plaid secret and access tokens     | `budget.db`                                | AES-256-GCM, with a key protected by the OS (Windows DPAPI, macOS Keychain, Linux secret service) |
| SimpleFIN access URL (credentials) | `budget.db`                                | Same as above                                                                                     |
| Encryption key for the above       | `credentials.key` in the app's data folder | Encrypted by the OS; only usable by your user account on that machine                             |
| Display preferences                | Browser storage inside the app             | Not sensitive                                                                                     |

A copied or backed-up `budget.db` therefore does **not** give bank access.
Access tokens are never sent to the app's own UI, logs, or backup exports.

### Network

- **Local API.** The embedded server listens only on `127.0.0.1`. It accepts
  requests only from the app's own window: other websites (including DNS
  rebinding and cross-site requests) are rejected, and in the desktop app every
  request needs a random per-launch secret held in an HttpOnly cookie, so other
  programs and users on the same machine can't read your data.
- **Outbound.** The only external services contacted are Plaid (the
  `plaid.com` API) and your SimpleFIN bridge, always
  over HTTPS. SimpleFIN URLs are restricted to public HTTPS addresses (checked at
  connection time), redirects are re-validated, and requests time out. Fonts and
  all other assets are bundled with the app; nothing is loaded from other sites.
- **Content Security Policy.** The UI can only run code shipped with the app
  and can only talk to its own local server. No third-party scripts or frames
  are allowed, and the page is isolated from other origins (COOP/COEP).

### Bank connections

- **Plaid:** you use your own Plaid API keys. You log in to your bank on
  Plaid's own page in your web browser (Plaid Hosted Link), never inside
  FlyBudget, which is how banks that use OAuth (Chase, Wells Fargo, and others)
  work in the desktop app. Disconnecting a bank revokes its
  access token at Plaid (`/item/remove`); if Plaid can't be reached, the
  connection is kept so you can retry.
- **SimpleFIN:** SimpleFIN has no revoke API. Disconnecting deletes FlyBudget's
  copy of the access URL; to revoke access completely, also remove the app in
  your [SimpleFIN Bridge](https://bridge.simplefin.org) account.
- Data from banks is treated as untrusted: it is validated, amounts are converted
  exactly, and exported CSV files are protected against formula injection.

### The desktop app

- Sandboxed renderer with no Node.js access, DevTools disabled in releases, all
  permission requests (camera, microphone, location, notifications) denied, and
  the window can't navigate away from the app. Links open in your browser only
  if they are `https://`.
- Electron fuses disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, and `--inspect`,
  and the app refuses to start if its files have been modified (asar integrity).
- Releases are built by GitHub Actions and signed with Sigstore, with SLSA build
  provenance. Verify a download with:
  `gh attestation verify FlyBudget-Windows-Setup.exe -R dtymoszenko/FlyBudget` (the same
  for the macOS and Linux files; each release also has `SHA256SUMS.txt`)

### Development and supply chain

- Every change runs CI (type checks, builds, property-based tests) and CodeQL
  (extended security queries); `main` requires CI to pass.
- npm install scripts are disabled in every package, CI verifies registry
  signatures, and Dependabot waits 7 days before adopting new releases
  (security fixes are not delayed). GitHub Actions are pinned to commit SHAs.
- Secret scanning with push protection is enabled on the repository.

### What you should do

FlyBudget can't protect against someone who controls your user account. To keep
your financial data safe:

- Use a strong OS login and turn on full-disk encryption (BitLocker on Windows,
  FileVault on macOS), since `budget.db` itself is not encrypted.
- Treat backup exports (`budget-backup-*.json`) and CSV exports as sensitive:
  they contain your full financial history (but no bank credentials).
- Only download FlyBudget from this repository's Releases page, and verify it
  with the command above.
- Keep your Plaid API keys private, and disconnect banks you no longer use.
- `npm run dev` is for development: it has no per-launch secret, and bank
  credentials are stored unencrypted. Use the desktop app for real accounts.
