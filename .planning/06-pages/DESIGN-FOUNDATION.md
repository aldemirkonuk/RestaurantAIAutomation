---
type: plan
title: Design Foundation
status: active — workstream REOPENED by founder 2026-08-27; sketches + brand exploration underway, production builds still gated on a direction pick
updated: 2026-08-27
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

## 0. Decision state (founder consulted 2026-08-26; kickoff 2026-08-27)

| Fork | State |
|---|---|
| Workstream | **REOPENED 2026-08-27** — "time has come … let's start for Mudavym." Sketches and brand exploration are go; production builds stay gated on the founder picking a direction. |
| Brand name on the product | **Decided: Mudavym everywhere** — customer-facing product brand, replaces WineOps in all sketches; the "müdavim = the restaurant's regular" story is the brand hook. Logo, slogan, voice all designed under this name. |
| Direction A/B/C (§4) · burgundy #9E4249 vs #CD2D5B | **Superseded** — founder ordered a from-scratch exploration (anything visual may change, even text size; only the monorepo architecture is untouchable). Replaced by the 5-direction bake-off below. |
| Brand directions | **Decided: 5 full directions** (voice + logo concepts + slogan candidates + palette + type + motion personality, each applied to the same sample screens); founder may extend to 10 after seeing them. |
| Coverage | **Decided: flagships first** — brand system + ~1 full sketch per archetype; propagation to all 47 pages only after the founder picks a direction. |
| Scope | **Decided: web first, mobile-aware** — tokens/archetypes written to port; 043–046 motion specs parked until mobile's turn |
| References | manus.im · bklit.com · motion.dev · the founder's GitHub stars (mined 2026-08-27: shadcn/Motion "design engineering" cluster — kokonutui, bklit-ui charts; `motion` as sole JS animation lib recommended). |
| Delivery | **Decided: HTML sketches in `sketches/` (MANIFEST-registered, 053+) + one published Artifact gallery.** Wave 1 shipped 2026-08-27: boards 053–057 (Habitué · Instrument · Cellar · Pass · Ledger) + 058 Blender marks (seal/ember/meter); gallery = Artifact "Mudavym Brand Directions". Founder pick pending; hybrid picks allowed; +5 more directions on request. |
| First co-design step (2026-08-26) | **Done: archetype map of every page** — 47 routes, `archetype:` frontmatter + Archetype column in [[PAGES-MAP]] (proposed assignments, founder to adjust) |

## 0a. Wave-1 verdicts (founder review, 2026-08-27)

**The governing feeling, stated by the founder and binding on every direction from
here:** *"the giving of hospitality and passion while technically superior."* Warmth
and rigour together — neither one traded for the other.

Review method is **elimination, not a single pick**: "I won't be able to select
everything in one go, but we can eliminate certain things and pick favourites."
Directions are therefore harvested for parts, and no board is adopted whole.

### Kept — the material that survives into 059

| From | Element | Kind |
|---|---|---|
| 053 Habitué | The `mü·da·vim` definition block ("the one who is there every day — who the house knows, and who knows the house") | story |
| 053 | The "security camera vs. sits at the bar like its most loyal regular" premise paragraph | story |
| 053 | **"Every vendor. Every bottle. Every shift."** | slogan |
| 053 | **"Less counting, more cooking."** | slogan |
| 053 | The live **row-expand `settle`** demo (grid-rows 0fr→1fr on the house curve, chevron on the same token) — singled out by name | motion |
| 054 Instrument | **Logo C, "The Meter"** — "kinda liked" | mark |
| 055 Cellar | **"Set the table. We'll keep the books."** + its division-of-labour rationale | slogan |
| 055 | **"Your back of house, front of mind."** — flagged sales-material, not in-app | slogan |
| 055 | The **Fraunces house-voice**: variable serif, "a wine label that learned software", used *only* when the product speaks ("Good evening, chef.") | voice |
| 056 Pass | **One-tap / hold-to-approve** | interaction |
| 057 Ledger | The **double-rule** mark and **the full stop** | mark |
| 057 | **"Every bottle, accounted for."** · **"Your müdavim, at the books."** | slogan |
| 057 | §03 **"how the book writes"** voice section | voice |
| 057 | §04 **paper / ink / one-seal** palette structure | palette |
| 057 | **Row-expand "show the working"** | motion |

### Cut

- **Every 053 logo** — "didn't like any logo in habitue." The müdavim *story* survives; its marks do not.
- **All of 054 except the Meter** — the monochrome instrument world read as too cold against the hospitality mandate.
- Everything in 055 and 057 not listed above; 056 contributes only the approve interaction.

### Open, and explicitly delegated

- **The seal colour** must be "one unique colour that is outside the colouring of themes
  among other startups" — founder asked for **candidates to judge in context** rather
  than naming a family. Ruled out by construction: SaaS purple-blue, terracotta/clay,
  and the incumbent burgundies (#9E4249 / #CD2D5B). **Ten candidates now exist** on
  board 059, stamped as wax on both surfaces; its recommendation is **İznik `#1A5E6B`**
  (`#5FB0BC` dark) — Ottoman ceramic blue-teal, the same cultural register as *müdavim*,
  measured 6.87:1 on paper and 7.47:1 on lamplight, and semantically free of the
  ok/warn/alert hues. Runner-up Aubergine `#4A2340`. **Founder's pick still open.**

### Decided — the dark ground (2026-08-27)

**Warm Charcoal `#15130F`**, founder's call, with the standing instruction to *"keep it
as simple as possible."* Six candidate blacks were built as identical dashboard
fragments behind the İznik seal; all six land between 7.44:1 and 7.69:1 on the accent
and 15.05:1–15.57:1 on cream text, so **contrast does not decide this** — a 0.3 spread
is invisible. The recommendation was Aubergine Ink `#120E16` (opposite İznik on the
wheel, so the seal reads at full strength); it was **overruled in favour of the ground
that already ships**, on the grounds that it introduces no second brand hue. Recorded
here because the reasoning matters more than the hex: *a palette that folds back on
what exists beats one that is theoretically cleaner and needs explaining.*

### Wave 2 — what shipped against those verdicts (2026-08-27)

| # | Board | Role |
|---|---|---|
| 059 | `mudavym-house` | **Front-runner.** Every kept element assembled into one identity, with three resolved lockups built from the two kept marks (double rule, full stop) and the Meter as alternate — no 053 mark survived, so these are new work. Carries the **ten-candidate seal-colour swatch board** the founder asked for. |
| 060 | `mudavym-anatolian` | New territory: the name's own homeland, İznik geometry as structure. |
| 061 | `mudavym-guestbook` | New territory: recognition and memory as the product. |
| 062 | `mudavym-warmmachine` | New territory: mechanism on show — the technical direction proving it can be the warmest. |
| 058 | `mudavym-3d-marks` | Re-rendered with real effort: six marks, computed framing, subsurface wax, brushed metal, printed ink — plus three generated scenes (higgsfield `z_image`, 0.45 credits) that gave the paper tooth and wax the renderer could not. |
| 063 | `mudavym-motion-canvas` | **One surface dedicated to motion: 62 live replayable demos** in five families — entrances, state/feedback, numbers, navigation, and the product surfaces the founder named (media display, order bars, comms, mail, team, invitations). Skin toggle (branded ↔ neutral) and a speed control make it a comparison tool rather than a showreel. |

Review surface: the **Mudavym Design Review** artifact — all nine boards, a **motion lab**
running every named token from every direction through the same three demos (springs
simulated and sampled into CSS `linear()`, so the curve shown is the real one), the
marks, and a **triage** list of the kept elements with love/keep/cut that persists.

### What the verdicts commissioned

1. **059 `mudavym-house`** — the kept material assembled into one identity (front-runner), carrying the seal-colour swatch board and properly-resolved marks, since no 053 mark survived.
2. **Three further directions**, founder-chosen territories: **060 Anatolian** (the name's own homeland — İznik geometry as structure, not ornament), **061 The Guest Book** (recognition and memory as the product), **062 Warm Machine** (mechanism on show — the most technical direction proving it can also be the warmest).
3. **058 re-rendered with real effort** — "these are super simple put more effort": subsurface wax, brushed metal, paper fibre, depth of field, six marks instead of three.
4. **All motion in one display** — every named token from every direction, side by side and replayable, plus a keep/kill surface so elimination can run across sessions instead of in one go.

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
