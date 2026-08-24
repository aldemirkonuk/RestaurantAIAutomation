---
type: reference
name: Playwright CLI
category: agent-tooling
url: https://playwright.dev/docs/test-cli
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]"]
---

# Playwright CLI

## What it is

Verified 2026-08-24 against the official CLI documentation.

Documented commands: `npx playwright test`, `codegen` (record actions → generated test),
`install` (browsers + deps), `show-report`, `show-trace`, `merge-reports`, `clear-cache`.

**Correction to a claim worth not repeating:** there are **no** `playwright screenshot` or
`playwright pdf` subcommands in the current CLI docs. Those existed in the older
`playwright-cli` package. Screenshots and PDFs are produced from test/script code
(`page.screenshot()`, `page.pdf()`), not from a CLI verb.

## Why it might matter here specifically

**It is already installed and in use** — this is the one item in the library with existing
repo evidence:

- `apps/web/package.json:64` — `"@playwright/test": "^1.58.0"` (devDependency)
- `apps/web/package.json:17` — `"test:e2e": "playwright test"`
- `apps/web/playwright.config.ts`
- `apps/web/e2e/` — `auth.setup.ts`, `navigation.spec.ts`, `prod-smoke.spec.ts`,
  `smoke.spec.ts`, `studio-flow.spec.ts`

So the open question is not "adopt Playwright" but **"what else should it be pointed at"**:

- `CLAUDE.md §9` requires evidence for behavioural claims and says user-visible changes
  must be verified rather than handed to the founder to check. `codegen` and trace viewing
  are the cheapest route to that evidence.
- The UX-paths burn-down (`UX_PATHS_CATALOG.md`, ~760 paths) is a natural consumer of
  generated specs rather than hand-written ones.

## What adopting it would cost

Nothing new to install. The real cost is the one E2E suites always have: five specs that
must keep passing, browser downloads in CI, and flake budget. Expanding coverage across
760 paths without a triage rule would turn a green suite into a permanently amber one.

## What decision it bears on

None open. It is in the tree already; no ADR records a decision about its scope, which is
itself a small gap — if E2E coverage policy is ever set, it should get an ADR.

## Status

`candidate` — in use in `apps/web`, but per CLAUDE.md §0.1 no ADR adopts it, so the
library does not call it `adopted`.
