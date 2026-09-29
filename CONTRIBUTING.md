# Contributing to FlyBudget

Thanks for helping make FlyBudget better. Bug reports, ideas and pull requests
are all welcome.

## Before you start

- **Found a security problem?** Don't open a public issue. Follow
  [SECURITY.md](SECURITY.md) to report it privately.
- **Planning something big?** Open an issue first so we can agree on the
  approach before you spend time on it.

## Contributor License Agreement

FlyBudget is licensed under the [GNU AGPL v3](LICENSE). Before we can merge your
first pull request, you need to accept the
[Contributor License Agreement](CLA.md) by commenting this on the pull request:

> I have read the FlyBudget CLA (v1) and I agree to it.

You only do this once. A check named **CLA** on your pull request shows whether
it's done.

**Why a CLA?** It lets FlyBudget be offered in places the AGPL alone doesn't
allow, like Apple's App Store, and lets the project change licenses later if it
ever needs to. In return, the CLA promises that every version including your work
is also released as open source. You keep the copyright to your work.

## Development setup

```bash
npm install && npm install --prefix client && npm install --prefix server
npm run dev   # client on http://localhost:5173, server on port 3001
```

Every package has an `.npmrc` with `ignore-scripts=true`, so dependency install
scripts never run. None are needed.

## Checks to run before opening a pull request

```bash
cd server && npx tsc --noEmit && npm test
cd client && npx tsc --noEmit && npm test
cd e2e && npm ci && npx playwright install chromium && npm test   # end-to-end
```

CI runs all of these on every pull request.

## Guidelines

- **Amounts are integer cents** everywhere; convert only in the UI.
- **Validate every request body** with Zod on the server, and use the shared
  validators in `server/src/utils/validation.ts` for dates and months.
- **Add tests** for what you change. Most tests are property-based (fast-check);
  UI changes should come with a Playwright test in `e2e/`.
- **Give controls accessible names** (labels, `aria-label`), so they work with
  screen readers and can be found by tests.
- **Keep the security model intact.** [SECURITY.md](SECURITY.md) and
  [CLAUDE.md](CLAUDE.md) describe it; loading anything from a new external
  origin, for example, means updating the Content Security Policy.

## Commit messages

Use conventional commit prefixes:

| Type       | Description                                 |
| ---------- | ------------------------------------------- |
| `feat`     | Adds a new feature                          |
| `fix`      | Fixes a bug                                 |
| `docs`     | Documentation-only changes                  |
| `style`    | Formatting or styling changes               |
| `refactor` | Restructures code without changing behavior |
| `perf`     | Improves performance                        |
| `test`     | Adds or updates tests                       |
| `build`    | Changes the build system or dependencies    |
| `ci`       | Changes CI/CD configuration                 |
| `chore`    | General maintenance work                    |
| `revert`   | Reverts a previous commit                   |
