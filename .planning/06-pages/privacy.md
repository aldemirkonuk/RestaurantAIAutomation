---
type: page
route: /privacy
slug: privacy
softwares: [app-shell-support]
component: apps/web/src/pages/Privacy.tsx
audience: public
tier: public
archetype: document # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 4
maturity: complete
status: documented
updated: 2026-09-13
links: ["[[PAGE-CONTRACT]]", "[[help]]", "[[settings]]", "[[profile]]"]
---

# /privacy — privacy & data notice

> **Part of** [[08-softwares/app-shell-support|App Shell & Support]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Settings → Services & permissions** → [[settings]] `/settings`
- **Settings → Integrations** → [[settings]] `/settings`
- **your profile** → [[profile]] `/profile`

## 1. Purpose
Plain-language privacy notice "written to match what the code actually does rather
than boilerplate" (`Privacy.tsx:5-12`): cookies, Google sign-in, connected
integrations, product analytics, partner sharing, plus a "Your controls" block linking
Settings and Profile. Public — readable before you have an account.

## 1a. Features
- Plain-language privacy notice matching what the code does: cookies, Google sign-in, connected integrations, product analytics, partner sharing
- "Your controls" block linking Settings and Profile
- Readable without an account

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
migration (OD-27, `.planning/decisions/OPEN-DECISIONS.md:148`).

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
4. Rebrand the 4 strings alongside the auth screens and the verification email, not separately — a notice under one brand describing a product under another is worse than either. *Blocked:* OD-27, deferred by founder pending the full Mudavym migration (OD-27, `.planning/decisions/OPEN-DECISIONS.md:148`).


### PublicShell implementation — 2026-09-13

Implemented in the page-finalization working branch from `60ed83a7`; this is a code/test record, not a production-deployment claim. The new public treatment uses the shared `PublicShell` and `usePublicDesign()`. [UPDATED 2026-09-17, decision 0149 row 37: the switch is now permanent-on in code — `isPublicDesignOn()` resolves `true` unconditionally except an explicit `localStorage["mudavym.design.public"] = "off"` QA override, kept only so the legacy rendering stays reachable and compiling until the gated cutover deletes it. `VITE_MUDAVYM_PUBLIC` is no longer read.] No new server authorization or public endpoint is introduced by the visual port.

The new document uses one h1, seven prose sections and links to Profile/Connections/legacy Settings. Its copy corrects the old universal “only app-created files” claim: Microsoft Excel's `Files.ReadWrite` is broader OneDrive access. It no longer promises that a local disconnect revokes provider-side consent or that an old preferences checkbox controls all telemetry. Public vendor catalogue visibility is disclosed. [UPDATED 2026-09-17, decision 0149 row 9: Fraunces and the house monospace are now self-hosted (`apps/web/public/fonts/`, `@font-face` in `styles/mudavym.css`), and every runtime Google Fonts injection was removed from `apps/web/src` — this notice now says the app's own code makes no third-party font request. [UPDATED 2026-09-18: `index.html`'s Fraunces/JetBrains Mono `<link>` params are removed too, once the SEO PR that owned the file merged; both faces now preload from woff2 files. Plus Jakarta Sans and DM Sans stay on `index.html`'s Google Fonts request — self-hosting them needs new font files this pass could not download without the founder's explicit go-ahead (this repo's download rule), tracked open as `ADR-0158-FONTS-NOT-YET-SELF-HOSTED` in CLAIMS.jsonl (the row this pass had cited as `ADR-0149-9-ALL-FOUR-FACES-SELF-HOSTED` was dropped 2026-09-19, wave-5 lane C: it repeated that exact check under a second id and wrongly said no prior id existed for it — see CLAIMS.jsonl history). The notice's own copy already discloses this accurately (`Privacy.tsx:116-118`) and needed no correction. **[CORRECTED 2026-09-19, wave-5 lane C: this was wrong. `Privacy.tsx:115-119` and `:206` say "The app's own code makes no third-party font request," but `index.html` — also the app's own code — still requests Plus Jakarta Sans and DM Sans from `fonts.googleapis.com`. The clause is false as written, in a public legal notice. Per the founder's ruling (ADR 0149 row 47 on `train/finish-2`, his words: "hold as is per now but will be dealt later after the web deployment finishes"), the page's text is held as is until then; not corrected here. Tracked under OD-124.]** **[RE-CORRECTED 2026-09-19, wave-5 lane C repair pass: the bracket immediately above is itself wrong, caught by an independent verifier on this pass. It quotes only "The app's own code makes no third-party font request" and calls that false; but the same sentence does not end there — in both renderings (`Privacy.tsx:115-119` and `:206`) it continues in the same breath: "Fraunces and the house monospace are self-hosted; `index.html` still loads two other faces from Google Fonts until that link is removed in a follow-up" (the flag-off wording is equivalent, with "though" in place of the em dash). Read whole, not truncated to its first clause, the sentence already discloses the Google Fonts gap accurately, in the same public legal notice the previous bracket says it misleads. The claim that bracket overwrote — "The notice's own copy already discloses this accurately (`Privacy.tsx:116-118`) and needed no correction" — was correct and is restored; `Privacy.tsx` did not need editing then and does not now. Its "Tracked under OD-124" line is also wrong and is retracted here: OD-124 (`OPEN-DECISIONS.md`) is the notice's missing legal-entity name, named contact and retention timeline — a different, pre-existing gap — not this sentence's wording, and ADR 0149 row 47's hold governs that gap, not font-request phrasing. No OD row exists, or is needed, for this sentence.]**] The same 2026-09-13 lane also silently dropped "sets no tracking or advertising cookies" / "we do not sell your data" / "partner sharing off by default" from both renderings with no founder decision behind the removal (D2/F2/F8) — restored 2026-09-17, since removing a live commitment is not a decision this fixer pass gets to make by omission.] This is a factual product description, not a new retention schedule, processor agreement or legal policy. The flag-off notice receives the same factual scope/revocation/reporting corrections; current contact, retention and legal-entity details still need owner input — a support address now exists (`support@mudavym.com`, decision 0149 row 8) but the rest of that gap (legal entity, retention terms) is filed as OD-124 (2026-09-18, `OPEN-DECISIONS.md`), not decided here.

Verification (2026-09-13 Codex run, not re-measured; counts above are its own): `apps/web/src/pages/__tests__/publicPages.recovery.test.tsx` (ten behavior tests across the seven pages), existing PublicShell/public-switch tests (34), web/gateway TypeScript checks. Vendor read/JSON-LD tests (five) and account email body/sender identity tests (five) are isolated and perform no real sends or database writes. Remaining product choices were recorded under [[OPEN-DECISIONS#Public-page completion — 2026-09-13 (5 of 6 resolved 2026-09-17; the sixth is OD-124)]]; five of six are now resolved (2026-09-17) — see that section and decision 0149 rows 7-9.

[FIXER RE-MEASURE 2026-09-17, this tree, clean: `apps/web/src/pages/__tests__/publicPages.recovery.test.tsx` 16 passed (6 added, closing the 404-vs-503, javascript: URL, role-capitalisation and token-vs-client-error gaps the lane C judge found), plus `PublicShell.test.tsx` 20 passed and `publicDesign.test.ts` 12 passed (rewritten for the permanent-on switch) — 48/48 across the three files. Gateway: 24/24 across 5 suites, including a new `verification-email-identity.spec.ts` and an added assertion in `password-reset.spec.ts` pinning the Mudavym senderName/subject the judge found untested (D5d/F10). 7 CLAUDE.md guard scripts and `check_decision_claims.sh` (335 claims) hold. Web and gateway `tsc --noEmit` both clean. Full command list and exit codes: `.planning/handoff/PROGRESS.md` §0b.] [CONFIRMER CORRECTION 2026-09-17: this tree was NOT clean at that point — `authPages.publicDesign.test.tsx:442` still asserted the pre-0149-row-37 contract against code this same pass had already flipped, and `verify_index.sh` was RED on it. The 48/48 above is now 49/49 (one CSS-specificity assertion added to `PublicShell.test.tsx`). Fixed and re-measured via `verify_index.sh` itself: `.planning/handoff/PROGRESS.md` §0b.]
