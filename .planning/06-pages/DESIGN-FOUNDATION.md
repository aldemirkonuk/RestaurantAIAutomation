---
type: plan
title: Design Foundation
status: proposed — workstream DEFERRED by founder 2026-08-26; documentation only, nothing builds
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[PAGES-MAP]]", "[[OPEN-DECISIONS]]"]
---

# Design Foundation — plan only, no build

> Founder mandate 2026-08-26: every page grew from its own sketch — "that's how I
> liked it at the time … each is very different from one another." Before anything
> is rebuilt, document what a shared design/sketch/foundation would look like so
> every page carries the same design understanding. **Do not build anything yet.**
> The founder will co-design the direction; the fork is registered as **OD-106**.
>
> *Retire-to-write (CLAUDE.md §4): this document supersedes the "Design Direction"
> header of [`sketches/MANIFEST.md`](../sketches/MANIFEST.md) as the home of
> visual-language intent; the MANIFEST keeps the sketch registry only.*

## 0. Decision state (founder consulted 2026-08-26)

| Fork | State |
|---|---|
| Direction A/B/C (§4) | **Open** — founder: no preference yet; sketch bake-off remains the offered path when the workstream wakes |
| Brand primary #9E4249 vs #CD2D5B | **Open** — founder: no preference yet; side-by-side mock offered |
| First co-design step | **Decided: archetype map of every page** — done as documentation (47 routes; the count was 50 before the four ADR 0019 §B retirements): `archetype:` frontmatter on every page doc + Archetype column in [[PAGES-MAP]] (proposed assignments, founder to adjust) |
| Scope | **Decided: web first, mobile-aware** — tokens/archetypes written to port; 043–046 motion specs parked until mobile's turn |
| Workstream | **Deferred** — founder will not focus on this now; documentation only, no sketches/tokens/builds until the founder reopens it |

## 1. What exists today (evidence, not judgment)

**Tokens, partially.** `apps/web/tailwind.config.js` already carries a deliberate
triad: `wine`/`brand` burgundy scale centered **#9E4249**, `info` blue, `warning`
yellow; `darkMode: 'class'` is configured and a theme preference exists on
`/profile`. But the *sketch* theme (`sketches/themes/default.css:6` and the old
MANIFEST direction) uses a **different primary, #CD2D5B** — two burgundies are in
circulation. Sketch 052's document standard also chose #9E4249. Fonts are already settled in
code: Plus Jakarta Sans (display) + DM Sans (body) + JetBrains Mono
(`tailwind.config.js:224-229`, loaded in `index.html:26`) — sketches and app agree
here.

**Components, three layers deep.**
- `apps/web/src/components/ui/` — shadcn-style primitives (button, card, badge,
  input, form, empty-state, error-state, loading-skeleton, toast) plus bespoke ones
  (ExportMenu, ContextMenu, RangeSlider…).
- `packages/ui` (`@wineops/ui`: charts/layout/notifications/primitives) — imported
  by only **4 files** in `apps/web/src`. A shared package exists and is nominally
  adopted.
- Page-local monoliths where most UI actually lives: Orders 3,614 lines, inventory
  legacy 1,928, WineLibrary 1,901, Dashboard 1,849, Notifications 1,807,
  Settings 1,575, Providers 1,484, Register 1,332.

**Chrome.** Three shells exist and are consistently applied: `DashboardLayout`
(sidebar + header) for product pages, `AuthShell` for auth, `StudioLayout` for
studio — plus deliberate chrome-free escapes (door receipt, SimPOS terminal,
`/authorize`, `/v/:slug`), each with an in-code rationale.

**Sketch lineages already competing to be "the" design** (see MANIFEST registry):
- *Command surface* — sketches 037/038, shipped as `/inventory` and `/team`.
- *Editorial* — provider grid (008/009), sketch 052's warm-paper document standard.
- *Onboarding glass* — 001–004, Stripe/Linear-inspired, #CD2D5B (sketch-only).
- *Motion signatures* — 043–046 full trigger/motion/haptic specs, none ratified.

## 2. The divergence, concretely (from the 50 page docs' §1a/§3)

- **Layout archetypes in live use:** command surface (inventory, team) · list+detail
  (receipts, notifications) · drag/resize dashboard canvas, unique to reports ·
  editorial card grid (providers) · chat (sommelier) · rail-form wizard (register,
  get-started) · month/week grid (calendar) · full-screen task flow (door receipt) ·
  ten-section settings page. Nine patterns for ~17 core pages.
- **Tabs:** at least seven pages implement their own tab bar (Communications,
  Promotions, Receipts, Providers, Documents, Admin, Get-Started). The `?tab=`
  deep-link convention *is* mostly shared — the one uniformity worth keeping.
- **Keyboard:** `r`/`Esc` on admin-health, `1/2/3` on promotions, `g`-chords in the
  command palette — three unrelated grammars.
- **Empty/error/loading:** `empty-state`/`error-state` components exist but are not
  uniformly used; on `/logs` and SimPOS an *error* renders as an *empty* state.
- **Honesty idioms worth canonizing:** em-dash for unknown, never a pass (E49);
  "No comparable data", never 0%; unpriced sorts last. These are house style already
  — just unwritten.

## 3. What a foundation must define (the co-design agenda)

1. **Tokens** — settle the burgundy (#9E4249 vs #CD2D5B), ratify the triad, type
   scale (fonts are already settled — §1), spacing, radii, elevation, dark-mode story.
2. **Shells** — DashboardLayout as the one frame; a named, closed list of
   chrome-free escapes with criteria.
3. **Page anatomy archetypes** — ✅ *proposed map exists (2026-08-26, founder's
   chosen first step)*: seven product archetypes (`command` · `list+detail` ·
   `canvas` · `form` · `calendar` · `chat` · `document`) + three structural buckets
   (`focused` · `redirect` · `dev`), assigned per route in
   [[PAGES-MAP]] and each page's `archetype:` frontmatter. Founder review pending.
   This is the sentence "each page has the same design understanding" made
   mechanical.
4. **Component vocabulary** — one tab bar, one table spec, one modal/drawer/sheet
   policy (sketch 010 already picked centered-sheet for providers), filter bar,
   export, status chips, empty/loading/error triplet.
5. **Interaction grammar** — `?tab=`/deep-links, command-palette verbs, one
   keyboard map, realtime-update and offline-outbox presentation, the honesty
   idioms (§2 last bullet).
6. **Motion signature** — adopt/reject the 043–046 specs per moment.
7. **Density, responsiveness, accessibility baselines.**

## 4. Candidate directions (fork — founder call, OD-106)

- **A. Command-surface first.** Ratify the 037/038 lineage as the default
  archetype; retrofit list pages toward it. Cheapest coherence — two flagship pages
  already ship it — but it flattens genres that aren't ops-dense (documents, chat).
- **B. Editorial identity.** The 052 warm-paper/burgundy document language as the
  brand spine; command surfaces remain for dense ops pages. Strongest identity,
  most retrofit work.
- **C. Federation of archetypes.** Shared tokens + component vocabulary underneath,
  ~6 named archetypes on top; each page keeps its genre on shared bones. Most
  honest to what exists; weakest single "look".

Not mutually exclusive at the token layer — §3.1 and §3.4 are the first work
regardless of the pick. No recommendation is recorded here on purpose: the founder
asked to co-design this.

## 5. Process, when approved

Sketch-first (the existing `gsd-sketch` flow): one sketch series per §3 item,
founder picks winners, each ratified choice lands as a short spec doc in this
directory and an ADR when it locks. Per-page migration notes then go into each
page doc; the §1a Features lists are the inventory of what must survive any
redesign. Until OD-106: **document, never build.**
