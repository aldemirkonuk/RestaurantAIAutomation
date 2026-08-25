---
type: page
route: /privacy
slug: privacy
component: apps/web/src/pages/Privacy.tsx
audience: public
tier: public
signals_today: none
rebrand_strings: 4
maturity: complete
status: documented
updated: 2026-08-26
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

---

## 10. Maturity

**complete.** A fully static notice (`Privacy.tsx`, 122 lines, `BrandMark` its only non-UI import), publicly routed (`App.tsx:158`), and — verified against the code today — accurate.

Spot-checked, each claim against its implementation:
- *"sets no tracking or advertising cookies… your sign-in session is kept in your browser's local storage instead of a cookie"* (`:31`) — holds: tokens are written to `localStorage` (`AuthContext.tsx:434-436`), and no `Set-Cookie` path exists in the auth flow.
- *"Product analytics"* (`:49`) — holds while `VITE_UX_OPTIMIZER` stays unset: `uxSignals` is a no-op unless it is exactly `"true"` (`lib/uxSignals.ts:15`), and its stated payload matches the in-file privacy contract (`:8-12`).
- Google/integration grants (`:43`) — matches the consent screen at [[authorize-integration]] and the server-side grant model.

The risk here is not function, it is drift: this is a legally-adjacent behavioural representation with no mechanism binding it to the code it describes (§9). The page's own header comment says exactly that — *"If any of those change, this page has to change with them"* (`:10-11`).

## 11. Data flow

### Calls out

**None.** No `fetch`, no axios client, no hook — the page is static JSX. That is the correct design for a notice readable before an account exists, and it is also the reason it can silently fall out of date.

### Fed by

Nothing at runtime. Its inputs are build-time and human: `VITE_UX_OPTIMIZER` (`lib/uxSignals.ts:15`), the `uxSignals` payload contract (`:8-12`), the OAuth scopes disclosed by the integrations catalog, and a standing founder representation about partner sharing (`Privacy.tsx:55`). Three of those four live in code; none of them is checked against this file.

### Writes

**None** — no database write, no telemetry, no cookie, no `localStorage` key. Fitting for a page whose subject is what the product does not collect. Nothing downstream reacts to it.

## 12. Design intent

**Should be:** a notice written from the code rather than from a template, readable by a stranger, and structurally impossible to leave stale.

| State | Handled? | Evidence |
|---|---|---|
| Empty | n/a — static content | |
| Loading | n/a — no async | |
| Error | n/a — nothing can fail | |
| Permission-denied | n/a — public by design (`App.tsx:156-158`) | |

The four-state question does not bite here, and saying so is more useful than inventing states the page has no reason to have.

**Where it misleads:** two places, both small and both real.
1. *Latent, not current.* Every behavioural promise in §11 is a claim about configuration that nothing enforces. Flip `VITE_UX_OPTIMIZER=true` and `Privacy.tsx:49` becomes false with no build failure, no test failure, and no reviewer prompt.
2. *Current.* "Your controls" links say *"Settings → Services & permissions"* but href plain `/settings` (`:64`), while the rest of the app deep-links `?tab=services` (`Help.tsx:154`). A user following a privacy control lands one click short of it.
3. Brand: 4 user-visible `WineOps` strings on a legal surface (§7) — the highest-visibility slice of the brand debt, and the only one that appears in a representation rather than in chrome. OD-27, deferred.

## 13. Roadmap

1. Deep-link the controls: `/settings?tab=services` and `/settings?tab=features` (`Privacy.tsx:64`), matching `Help.tsx:154`. One-line, immediate.
2. Add the guard §9 says is missing — a test that fails when `VITE_UX_OPTIMIZER` defaults to enabled while this text stands, plus a comment reference at `lib/uxSignals.ts:15` pointing back here. Cheapest possible binding between a promise and its implementation.
3. Register the coupling in `v3.0-TECH-DEBT.md` — §9 notes it is absent from the register, which is why it is invisible to anyone not reading this page.
4. Rebrand the 4 strings alongside the auth screens and the verification email, not separately — a notice under one brand describing a product under another is worse than either. *Blocked:* OD-27, deferred by founder pending the full Mudavym migration (`.planning/decisions/OPEN-DECISIONS.md:27,74`).
