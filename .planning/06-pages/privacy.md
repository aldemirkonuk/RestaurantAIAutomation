---
type: page
route: /privacy
slug: privacy
component: apps/web/src/pages/Privacy.tsx
audience: public
tier: public
signals_today: none
rebrand_strings: 4
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[help]]", "[[settings]]", "[[profile]]"]
---

# /privacy — privacy & data notice

## Surface — buttons → where they go

- **Settings → Services & permissions** → [[settings]] `/settings`
- **Settings → Integrations** → [[settings]] `/settings`
- **your profile** → [[profile]] `/profile`

## 1. Purpose
Plain-language privacy notice "written to match what the code actually does rather
than boilerplate" (`Privacy.tsx:5-12`): cookies, Google sign-in, connected
integrations, product analytics, partner sharing, plus a "Your controls" block linking
Settings and Profile. Public — readable before you have an account.

## 2. Entry
Public route (`App.tsx:156-158`: "linked from the auth screens and the consent page,
so it must be readable before you have an account"). PAGE_MAP classes it public and
shows outbound edges privacy→profile/settings (`PAGE_MAP.md:82-83,101`).

## 3. Files
- Route: `apps/web/src/App.tsx:158` → `pages/Privacy.tsx` (122 lines, fully static —
  `BrandMark` from `components/brand/BrandMark.tsx` is the only non-UI import)

## 4. Endpoints
none — entirely static JSX.

## 5. Signals
none. (Fitting: the page promises telemetry is off by default.)

## 6. Tier cut
Public — applies to every tier identically.

## 7. Rebrand surface — the OD-27 strings, precisely
4 user-visible `WineOps` occurrences on 3 lines:
- `Privacy.tsx:23` — "What **WineOps** stores, what leaves your browser, and what you control."
- `Privacy.tsx:31` — "**WineOps** sets no tracking or advertising cookies. We don't use
  a cookie-consent banner because there is nothing to consent to. Your sign-in session
  is kept in your browser's local storage instead of a cookie…" — **this is the
  cookie-behaviour promise OD-27 flags**: a behavioural representation in legal-adjacent
  text, under the wrong brand.
- `Privacy.tsx:43` — two occurrences: "grants **WineOps** permission to write files on
  your behalf" and "limited to files **WineOps** creates".
Status: OD-27 **deferred by founder** — wineops strings stay pending the full Mudavym
migration (`.planning/decisions/OPEN-DECISIONS.md:27,74`).

## 8. State & config
none — no flags, no env vars. But the page's *claims* are couplings to config
elsewhere: the "Product analytics" section (`Privacy.tsx:49`) is true only while
`VITE_UX_OPTIMIZER` stays unset (`lib/uxSignals.ts:15-16` — ships dark) and its payload
description matches `uxSignals`' privacy contract (`lib/uxSignals.ts:8-12`); "Sharing
with partners … off by default" (`:55`) is a standing representation. The header
comment says it plainly: "If any of those change, this page has to change with them"
(`:10-11`).

## 9. Gaps
- The behavioural-promise coupling in §8 has **no guard**: nothing fails a build if
  telemetry defaults flip while this text stands. Not in `v3.0-TECH-DEBT.md`.
- "Your controls" links say "Settings → Services & permissions" but link plain
  `/settings` without the `?tab=services` deep link the rest of the app uses
  (`Privacy.tsx:64` vs `Help.tsx:154`).
- Rebrand is user-visible on a legal surface — the highest-visibility slice of the
  brand debt, already registered as OD-27 (deferred).
