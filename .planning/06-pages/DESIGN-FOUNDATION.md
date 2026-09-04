---
type: plan
title: Design Foundation
status: active — implementation underway since ADR 0044 (2026-08-30); mark decided (ADR 0047, OD-111 resolved); 10 of 47 pages built and flagged, in a page-by-page review-and-fix pass — see §0b
updated: 2026-09-02
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
| Workstream | **REOPENED 2026-08-27, gate lifted 2026-08-30** — "time has come … let's start for Mudavym." Sketches and brand exploration ran through wave 2; ADR 0044 then moved the workstream from documentation into implementation. See §0b for where it actually stands. |
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

## 0b. Where this actually stands now (2026-09-02)

Everything above §1 is the pre-implementation record — real history, kept as
written. It is not the current state. What changed:

- **§4's A/B/C fork never got a single winner.** The founder picked per page
  and mixed directions on one screen, so OD-106 resolved in practice as
  **per-archetype composition**, not one direction — [[MAKEOVER-VERDICTS]]
  carries the page-by-page calls. §4/§5 below describe a decision process
  that already ran its course this way, not a still-open fork.
- **The mark is decided.** [ADR 0047](../decisions/0047-am-interlock-supersedes-rivet-m.md)
  — the trued A+M interlock, after the Rivet M ([ADR 0045](../decisions/0045-rivet-m-and-full-go.md))
  was chosen and withdrawn the same day. Live in production. OD-111 moved to
  Resolved.
- **Implementation is running, not gated.** [[0044-mudavym-implementation-kickoff]]
  opened the build 2026-08-30. Shared foundation: `apps/web/src/styles/mudavym.css`
  (ADR 0042 tokens), `apps/web/src/lib/mudavym/motion.ts` (CSS+WAAPI springs,
  no new dependency), `apps/web/src/components/mudavym/*` and
  `apps/web/src/components/brand/BrandMark.tsx`. Each page ships behind its
  own `mudavym_design_<page>` flag, DB-backed per restaurant
  (`restaurant_feature_flags`), default OFF.
- **Ten pages are built and flagged**: dashboard, orders, receiving,
  receiving-door, providers, communications, team, inventory, receipts,
  documents-reports. That is the *building* done, not the workstream done —
  a page-by-page review-and-fix pass is running in the founder's stated
  order (dashboard → orders → receiving → receiving-door → receipts →
  inventory → providers → communications → documents-reports → team) and
  has found substantive defects under several already-built pages (invented
  data rows, columns nothing writes, conversations the UI cannot render).
  Founder elimination/sign-off across pages is deliberately held until that
  pass clears, not run against flagged pages with known holes underneath.
- **Wine-agent is the one page from the original claim list still
  unstarted.**

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
   policy, filter bar, export, status chips, empty/loading/error triplet.
   The **modal/drawer/sheet half is ✅ decided and built** (2026-09-03):
   [[0112-one-modal-policy-three-shapes-one-primitive]] — three named shapes
   (`Sheet` a record · `Panel` a question · `Popover` a control's own menu) over
   one primitive `apps/web/src/components/mudavym/Sheet.tsx`, gated by
   `lib/mudavym/shellGround.ts` so the nine shell overlays wear the wave only
   while a rebuilt page is mounted. Sketch 010's centered-sheet-for-providers is
   **superseded**: providers shipped a right sheet, the calendar copied it, and
   the ADR ratifies right-sheet-for-a-record on that measured evidence. Status
   Proposed until the founder ratifies. The rest of item 4 (tab bar, table spec,
   filter bar, export, status chips, the state triplet) is still open.
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

## 6. Competitive reference — what the field does, page by page (2026-09-02)

Research pass over the products the founder named, plus whoever turned out to be
actually best per surface. It is scoped to the current rebuild wave and it exists to
answer three questions per page: what is now **table stakes** and we lack it, what the
field does that we should **refuse**, and what would be **exponentially** better
because it runs on data only Mudavym holds — the ledger of every order, receipt and
count, the vendor conversations, the POS checks, and agent decisions with an audit
trail.

Three findings govern the rest of this section.

1. **The arrangement is commoditised; the provenance is not.** Restaurant365 and
   Lightspeed both ship drag-and-drop dashboards [^r365ai] [^ls]; Linear ships a better
   inbox than ours [^linbox]; Google Ads ships a more complete recommendation queue
   [^gads]; Provi and SevenFifty list 750,000 products [^provi]. On every wave surface
   the differentiator has to be what a figure can *prove*, not how it can be moved.
2. **The field's most-copied idea is the one to refuse.** Google's optimization score
   reaches 100% by *dismissing* every recommendation [^gads]; Slack collapses 47
   messages into a count [^slack]; MarketMan can auto-order on a par breach [^mmpar];
   Toast IQ executes menu and shift edits straight from a feed card [^toastiq]. These
   are one fault in four costumes — **cleared reported as healthy**. §2's honesty
   idioms (em dash for unknown, "No comparable data" never 0%, a control that cannot
   work says so) are the antidote, and they are a stronger product position than a
   style rule.
3. **One idea recurs on six of seven wave pages and is available to nobody else:** the
   ledger can answer for the interface. It is one engine rendered six ways — the 057
   row-expand *"show the working"* motion (§0a) applied to blocks, notifications,
   recommendations, calendar days, settings controls and catalogue rows.

Reading the tables: rows are independent threads; a cell with no counterpart carries an
**em dash**, per the house idiom. Archetype names are §3.3's. Flag and motion-map
mechanics are ADR 0044's; palette tokens are ADR 0042's. Long form with every source
and the strongest objection to each idea lives in the session scratchpad
(`competitor-research-2026-09-02.md`) — this section is the pointer, not the corpus.

### `/reports` — archetype `canvas` · verdict MERGE

| Table stakes we lack | Do not copy | Exponential idea | Need it |
|---|---|---|---|
| Scheduled/emailed digest of the canvas [^tenzo] [^me] | "More blocks" as the answer to "more graphs" — R365 bolted AI onto widget sprawl [^r365ai] | **The service calendar** — a month grid, one cell per service, TradeZella's P&L shape [^tz]; click a day into its receipts, counts, orders, agent decisions | **now** (ADR 0044's named ask) |
| Threshold alert defined *from* a chart [^tenzo] | Prompt-to-chart as a headline — a chart nobody can restate [^r365ai] | **Blocks that cite their working** — row-expand into the arithmetic and the rows behind it | **now** |
| Role-based default layouts [^r365ai] [^tenzo] | CSV-export-as-answer [^supy] — exporting is admitting the page failed | **A house layout, not an empty one** — named presets ("Before service", "Buying week"); dragging is dissent, not assembly | **now** |
| Drill-down in place, overview→site→item [^supy] | Lightspeed's chart-type picker [^ls] — a spreadsheet in disguise | **Alert-from-a-block** — drag a threshold line onto a chart; it arms pre-loaded with its own 90-day fire count | later |
| Benchmark that is not ourselves [^me] | Vendor-claimed impact figures in our own UI [^nory] [^supy] | **Vendor-attributed margin** — split cost movement into price / mix / yield, naming the vendor and the conversation | later |
| — | — | **"What the agents did"** — the autonomy trust ledger; zero decisions must read differently from no data | later |

### `/notifications` — archetype `list+detail` · verdict REWORK ("re-transformations")

| Table stakes we lack | Do not copy | Exponential idea | Need it |
|---|---|---|---|
| **Snooze** — Linear has had it since 2021 [^lsnooze]; `/recommendations` has it, the inbox does not | Linear's Inbox wholesale — its items are messages about work; ours are facts about stock and money | **Two rooms** — "Needs a decision" (four resolutions, à la Linear Triage [^ltriage]) split from "The house is telling you". Density belongs to room two, subduing to room one — exactly the two kept inspirations | **now** |
| Auto-un-snooze on new activity [^lsnooze] | Slack's batch-by-count [^slack] — one urgent item and 46 trivia become one number | **Subdue by settlement, not by reading** — greys out when the credit note lands, the PO goes out, the price returns to range. Nobody does this; only a ledger can | **now** |
| Hide-read toggle; filter/quick-search [^linbox] | Watchdog-style unconfigured anomaly alerts [^ddog] — in a one-site restaurant "anomaly" is Tuesday | **Every item states its rule and its history** — threshold, observed value, 90-day fire count, and "this rule is too loud" | **now** |
| Persistence for the custom one-tap action (🚧 today) | MarketMan's auto-order on breach [^mmpar] — money moving without a seal | **The service-shaped inbox** — grouped before / during / after service, not by timestamp | later |
| Context-aware batching (don't batch what is on screen; reset on open) [^slack] | A bare unread badge without a severity split | **Truck-inbound as a self-expiring item** — MOXē's shape [^moxe], but promising only the window the vendor stated, em dash otherwise | later |

### `/recommendations` — archetype `list+detail` → `document` · verdict REWORK / "find another way"

| Table stakes we lack | Do not copy | Exponential idea | Need it |
|---|---|---|---|
| A route in the sidebar (🚧 palette-only today) | **The optimization score** [^gads] — a metric that hits 100% by dismissing everything is queue-clearing wearing the clothes of health | **Cases, not cards** — fact → rule → money at stake → act → seal → outcome measured N days later. A case reopens and *closes with a result*; a card cannot. This is the "another way" | **now** |
| Type-level grouping with a type action [^gads] | Apply-all — bulk commitment without reading is why Google earned its distrust | **Scored after the fact** — write the measured outcome back; "No comparable data" where it is not comparable, never 0% | **now** (write-back) |
| Suppression with a stated scope and duration [^aws] | Toast IQ's execute-from-the-feed [^toastiq] — unreconstructable later | **The refusal is as valuable as the act** — dismissal reasons become a taxonomy that retunes the rule, attributed and reversible. Google suppresses; AWS excludes; neither learns | **now** |
| A "would have fired N times" preview before a rule arms | "AI recommends" framing — our own source already makes the stronger claim: deterministic, no LLM, auditable | **Cross-surface prescription** — the sentence only we can write, joining counts + POS checks + vendor conversations + price provenance, each clause carrying its own provenance chip | **now** (composition) |
| — | Weather / local-events inputs [^toastiq] — unfalsifiable at single-site volume | **Assignment that behaves like a shift**, expiring with service | later (no `staff` role in prod) |

### `/calendar` — archetype `calendar` · verdict KEEP (additive only)

| Table stakes we lack | Do not copy | Exponential idea | Need it |
|---|---|---|---|
| A permission on event management [^7sev] | Labour scheduling [^7sched] [^fourth] — it would flatten a liked page into a shift grid | **Order-by windows as calendar objects** — every vendor's cutoff drawn as closing time ("Vendor B closes in 3h 10m for Thursday"). The whole field stores cutoffs as *settings* [^linenow]; nobody draws them as time | **now** |
| A dated house log [^7log] [^ls] | Weather-driven forecasting on the grid [^fourth] — a guess on a page whose virtue is that everything is a fact | **The day that already happened** — past cells hold what the ledger recorded; ink-light, non-interactive until hovered | **now** |
| Two-way calendar subscription (iCal is publish-only today) | Notion Calendar's chrome (menu bar, countdown) [^ncal] — wrong idiom for a wall calendar in a kitchen | **The tasting that becomes a line item** — poured / listed / passed writes back to the catalogue, so next year's tasting opens with last year's note | later |
| A "something happened here" mark on the month grid [^7sev] | A fifth view | **A house log seeded from the ledger** — the day opens with what happened; the manager adds what only a human knows | later |

### `/settings` — archetype `command`/`document` · verdict KEEP (Editorial) · "there should be more"

| Table stakes we lack | Do not copy | Exponential idea | Need it |
|---|---|---|---|
| Approval policy as configuration — who seals what, above what amount, for which vendor [^ott] | Stripe's Organizations hierarchy [^stripeorg] — an accounting shape with one real tenant to justify it | **Every setting states its blast radius** — "changes what 3 rules fire on · last changed by … · 42 items use this unit". R365's docs *warn* that unit setup is critical [^r365uom] — an admission the UI does not say so itself | **now** |
| Unit conversions with measure types and a separate **receive unit** [^r365uom] [^r365vi] — more necessary, not less, under ADR 0070's integer quantity + item-level `uom` | LaunchDarkly's targeting matrices in an operator tab [^ldflags] — borrow its honesty about scope, not its density | **Vendor terms as a tab** — cutoffs, delivery days, minimums, pack sizes, each with provenance: stated · inferred from N orders · em dash. Unblocks the calendar and notification ideas | **now** |
| Vendor-level terms have no home at all [^linenow] | Hiding admin controls from members [^lworkspace] — a control that cannot work must **say so**, not vanish | **Units that show their conversion both ways**, with a worked example against a real recent invoice line — or an em dash and "no delivery yet to check this against" | **now** |
| Flag scope visibility — ADR 0044 added a per-browser dev override, so a flag now has two scopes and the tab shows one [^ldflags] | Growing to fifteen tabs — depth inside the ten, plus at most Vendors and Data | **A settings ledger** — who/when/from→to on every change | **now** (capture) · later (UI) |
| An audit trail on settings changes; a Data & retention section; roles beyond the built-ins | — | **Approval thresholds and the seal** — ADR 0044's ceremony gets its policy | later (blocked: one tenant, no `staff` role) |

### `/profile` — archetype `form` · verdict KEEP+ (MCPs · linked accounts · payments)

| Table stakes we lack | Do not copy | Exponential idea | Need it |
|---|---|---|---|
| Sessions & devices with revoke | Stripe's dashboard density [^stripedash] — a finance console for a page a chef visits three times a year | **Connected capabilities** — one list of everything that acts on your behalf (Google/Microsoft, POS, sender identity, MCP servers), each with its scope, its last action and a revoke. Claude's Connectors is the shape [^mcp]; a permissions ledger is the framing. Answers two of the three asks in one object | **now** |
| 2FA / passkeys on an account that can seal purchase orders | A raw MCP config-file editor [^mcp] — our users are not developers | **Payments as a state, not a form** — Stripe's checklist logic [^stripechk] in the honesty idiom: "Card on file — · Billing contact set · VAT number —"; the provider's hosted flow does the collecting | **now** |
| A second linked provider — Microsoft is backend-supported, button 🚧 missing | Billing-plan management on a *personal* profile — it belongs to the restaurant | **"What I did here"** — the user's own record of what they sealed, approved and changed. Every competitor's audit log is an admin surface; making it personal turns accountability into craft pride — the müdavim register | later |
| Personal notification preferences (they live on the restaurant's page today) | Linear's preference sprawl [^lpref] — ADR 0042 settles both grounds, so theme is a two-state switch | **The seal is personal** — the İznik die pressed with the user's name, and the ceremony's one setting | later (ceremony is rationed) |

*Note: MarketMan, MarginEdge, R365 and Craftable treat the profile as a name-and-password
form — there is no restaurant-category competition on this page. The references are all
outside it.*

### `/cellar` (parent) · `/wines` today — archetype `command` · verdict REJECT ("more character", keep "see everything")

| Table stakes we lack | Do not copy | Exponential idea | Need it |
|---|---|---|---|
| Market price actually populated (renders "—" today) [^ct] [^provi] | Marketplace catalogue-size ambition [^provi] — 750,000 SKUs is Provi's business model; ours is *this house's* ~500 | **The house's own record on every bottle** — first bought, what we have paid, what we poured, when it ran out, who quoted it, what the tasting memo said. CellarTracker has 7.5M strangers' notes [^ct]; we have one house's memory, which is the brand thesis as data | **now** |
| Deadstock / velocity on the row [^binwise] | The crowded grid — already rejected once; density without hierarchy is what "crowded" meant | **"See everything" kept literally** — one dense table, character *in the row*: producer in the Fraunces house voice, a hairline seal-tint bar for stock depth, em dash for unknown price, struck-through for delisted. A wine list is the form this trade already trusts | **now** |
| A guest-facing list published from the same data [^binwise] | Partender's swipe [^partender] — brilliant for counting, wrong for a reference surface | **Four children, one spine** — `/beer` `/whiskey` `/cocktails` inherit the row grammar with a per-category accent; three tables already exist unsurfaced | **now** (shell) · later (depth) |
| Staff-training content per item [^backbar] [^meez] | CellarTracker's community ratings [^ct] — a number we did not derive beside one we did | **Price with provenance on the row** — `/vendor-prices`' vocabulary (invoice · catalogue · quote · rep message · social · manual) as a chip; strongest shown, the rest on row-expand. Reframes the "—" hole: we stop pretending there is one market price | **now** |
| Sample/quote request from a row [^sf]; barcode/label scan [^backbar] [^ct] | Dual valuation as an unlabelled toggle [^binwise] — a valuation whose basis is ambiguous is worse than none | **Publish the list to the guest** from the same rows — an out-of-stock bottle is marked, never silently vanished | later |
| — | — | **The pour-to-purchase loop** — "we are pouring this, we will need it" as a live demand signal, which static par sheets famously miss [^linenow] | later |

### Second tier — one line each

| Page | Table stakes we lack | Do not copy | Exponential idea | Need it |
|---|---|---|---|---|
| `/login` + `/register` | Google (and Microsoft) sign-**up**, not only sign-in — highest leverage on "the most important step"; the OAuth self-provision hole is closed, so it can be gated safely | Stripe's requirement-list rendering [^stripeonb] (reads as a compliance form); a marketing hero — that is the "too modern" already rejected | The form **proves it is not generic**: the invite code resolves to the real restaurant and inviter before the account exists ("Hasan is expecting you at Lokanta"). Later: the wax seal pressed **once**, at account creation — the arrival journey's only ceremony, and where `/login`'s missing character belongs | **now** · later (seal) |
| `/onboarding` | A checklist with *state* — done, blocking, what it unblocks [^stripechk] | A multi-step wizard (re-creates the sprawl this page was collapsed to escape); "% complete" — the optimization-score fault in miniature | **First evidence, not first configuration** — one invoice photographed at the door produces a real line, vendor and price: the first true ledger row, in one act. Later: seed the catalogue from the menu-photo scan `/wines` already ships. **Never**: importing a competitor's data as step one | **now** |
| `/vendor-prices` | Navigation — the page is 🚧 unreachable, so the feature is wasted; pack-size normalisation; alert-*before*-order [^nxt] [^de] | "Best price" badges [^de] — they ignore minimums, delivery days and relationship, and would overrule the seal; weekly bid imports [^de] | Provenance **clickable through to the source sentence** — the rep's message, the attachment, the catalogue page. No competitor can do this. Normalise to ADR 0070's `uom` or the comparison is decoration. Later: freeze the comparison at the moment of sealing, so the ledger holds what we knew | **now** |
| `/promotions` | Server-side dismissal (per-device today); an expiry model — an offer with no end date is not an offer | A deals *feed* [^provideals] — a seller's surface in a buyer's clothes; urgency framing | **Grade every offer against our own ledger** — "12% off list, but 4% *above* what you paid Vendor B in March". Impossible without invoice history; turns a marketing email into a fact. Later: offers expire into `/calendar` as an order-by window. **Never**: auto-acting on an extracted offer | **now** |
| `/wine-agent` (today `/sommelier`, HOLD) | A registered chat backend (🚧 every message falls back to local rules today); more than 50 wines of context; any permission model on a page described as permissioned | Toast IQ's execute-from-chat [^toastiq]; the assistant-crew metaphor [^nory] — it obscures which agent is accountable | **Answers only from the ledger, always citing rows** — the honest failure is "I can't see that", never a fluent guess. Every action is a *proposal* carrying the audit fields the governance literature names — proposed action, parameters, reasoning, impact, rollback, expiry [^hitl]. Later: the answer ends in a link to the page that proves it, so chat becomes navigation, not a replacement UI | **now** |
| `/receiving/:orderId/door` | Optional per-line check-off [^mmrecv]; an auto-drafted credit on a discrepancy [^mmrecv] | Line-item check-off as the *default* — the three-question flow is the better one-handed door design; 24–48h processing latency as acceptable [^merecv]; auto-credit without a human | **Say what is short before the driver leaves** — the flow already knows the PO and already ships `match-ink`; extend it from "14 of 16 — two short" to *which two*. Later: the driver countersigns, so the ledger holds who signed — the only useful question when something goes missing between the door and the cellar. Later: the door photo becomes the end-to-end provenance link a price can be walked back to | **now** |

*The door flow is the most finished page in the wave — its motion map, `seal-forgive`
mercy and deliberate non-motions are the reference implementation of ADR 0044 §2, and
Robinhood's swipe-for-consequence precedent [^rh] confirms the hold-to-seal choice.*

### Two asks are blocked by tenancy, not by design

Role-based default layouts (`/reports`) and approval thresholds (`/settings`) both need
more than one real tenant and a `staff` role that production does not have. Recorded as
**later** rather than attempted; building either now would ship a policy nobody can
exercise.

### Sources

[^r365ai]: https://www.restaurant365.com/inventory/ai-dashboards/ · https://docs.restaurant365.com/docs/create-and-modify-ad-hoc-reports · https://docs.restaurant365.com/docs/configure-mobile-dashboard-widgets
[^r365uom]: https://docs.restaurant365.com/docs/unit-of-measure · https://docs.restaurant365.com/docs/unit-of-measure-conversions
[^r365vi]: https://help.restaurant365.net/support/solutions/articles/12000039209-vendor-item-record
[^ls]: https://www.lightspeedhq.com/uk/pos/restaurant/advanced-insights/ · https://k-series-support.lightspeedhq.com/hc/en-us/articles/7625714308763-About-Advanced-Insights
[^tenzo]: https://www.gotenzo.com/product-analyse/ · https://tenzo.zendesk.com/hc/en-gb/articles/34003036167315-Tenzo-Alert-Creator
[^me]: https://www.marginedge.com/how-it-works · https://www.marginedge.com/food-cost
[^merecv]: https://help.marginedge.com/hc/en-us/articles/218822667-Uploading-Invoices · https://help.marginedge.com/hc/en-us/articles/17318808776851-Invoice-Approval-in-the-Mobile-App
[^supy]: https://supy.io/platform/restaurant-analytics-software
[^nory]: https://www.nory.ai/product/business-intelligence · https://restauranttechnologynews.com/2026/06/nory-brings-agentic-ai-to-restaurant-forecasting-labor-optimization-inventory-management-and-profitability/ *(impact figures vendor-claimed)*
[^tz]: https://help.tradezella.com/en/articles/9689020-advanced-calendar-widget-in-tradezella-dashboard · https://help.tradezella.com/en/articles/10528734-how-the-dashboard-calendar-calculates-and-shows-daily-profit-loss-p-l
[^linbox]: https://linear.app/docs/inbox
[^lsnooze]: https://linear.app/changelog/2021-06-17-inbox-snooze-and-easier-issue-merge
[^ltriage]: https://linear.app/docs/triage
[^lpref]: https://linear.app/docs/account-preferences
[^lworkspace]: https://linear.app/docs/workspaces · https://linear.app/changelog/2024-12-18-personalized-sidebar
[^slack]: https://slack.engineering/how-slack-rebuilt-notifications/
[^ddog]: https://docs.datadoghq.com/watchdog/insights/ · https://docs.datadoghq.com/watchdog/alerts/
[^gads]: https://support.google.com/google-ads/answer/9061546 · https://support.google.com/google-ads/answer/10169817 · https://developers.google.com/google-ads/api/docs/recommendations
[^aws]: https://docs.aws.amazon.com/awssupport/latest/user/trusted-advisor.html
[^toastiq]: https://www.qsrmagazine.com/news/toast-expands-toast-iq-with-conversational-ai-assistant-to-help-restaurants-run-smarter-and-faster/ · https://pos.toasttab.com/news/toast-expands-toast-iq-smart-ai-assistant
[^mmpar]: https://www.marketman.com/blog/how-to-calculate-par-level-in-a-restaurant
[^mmrecv]: https://www.marketman.com/platform/restaurant-purchasing-software-and-order-management · https://marketman.zendesk.com/hc/en-us/articles/203068791-How-do-I-receive-an-order-without-scanning
[^moxe]: https://www.usfoods.com/how-we-help-you/easy-ordering · https://www.usfoods.com/how-we-help-you/easy-ordering/moxe-help-center/ordering-on-moxe
[^7sev]: https://kb.7shifts.com/hc/en-us/articles/4417514047379-Creating-Managing-Events
[^7log]: https://kb.7shifts.com/hc/en-us/articles/4417520176531-Manager-Log-Book
[^7sched]: https://kb.7shifts.com/hc/en-us/articles/31634882661907-7shifts-101-Schedule
[^fourth]: https://www.fourth.com/solution/workforce-management-software/restaurant-sales-forecasting-software
[^ncal]: https://www.notion.com/help/guides/getting-started-with-notion-calendar · https://www.notion.com/help/notion-calendar-settings
[^linenow]: https://www.linenow.co/blog/guides/restaurant-vendor-ordering-software
[^ott]: https://ottimate.com/ · https://ottimate.com/industry/restaurants/
[^ldflags]: https://launchdarkly.com/docs/home/flags/list · https://launchdarkly.com/docs/home/flags/view-across
[^stripeorg]: https://docs.stripe.com/get-started/account/orgs · https://docs.stripe.com/get-started/account/orgs/team
[^stripechk]: https://docs.stripe.com/get-started/account/checklist
[^stripeonb]: https://docs.stripe.com/connect/custom/hosted-onboarding · https://docs.stripe.com/connect/api-onboarding
[^stripedash]: https://www.925studios.co/blog/stripe-dashboard-design-breakdown
[^mcp]: https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities
[^binwise]: https://home.binwise.com/wine-inventory-software · https://home.binwise.com/binwise-pro
[^backbar]: https://www.getbackbar.com/bar-inventory-app · https://apps.apple.com/us/app/backbar/id1461796151
[^partender]: https://apps.apple.com/us/app/partender-bar-inventory/id726829071 · https://www.forbes.com/sites/themacallan/2016/11/10/this-tech-company-is-shaking-up-the-bar-industry-with-tinder-for-inventory/
[^provi]: https://www.provi.com/buyers · https://www.provi.com/provi-sevenfifty
[^provideals]: https://www.provi.com/blog/alcohol-supplier-101
[^sf]: https://go.sevenfifty.com/buyers/
[^ct]: https://www.cellartracker.com/ · https://support.cellartracker.com/article/49-tasting-notes-and-ratings · https://mobileapp.cellartracker.com/
[^meez]: https://www.getmeez.com/multi-unit-restaurants
[^nxt]: https://nxtedge.net/vendor-price-comparison/
[^de]: https://diningedge.net/restaurant-vendor-price-comparison-software/ · https://buyersedgeplatform.com/restaurant-supply-chain-management-software/
[^hitl]: https://www.strata.io/blog/agentic-identity/practicing-the-human-in-the-loop/ · https://techarion.com/blog/ai-agent-governance-audit-trails-compliance
[^rh]: https://design.google/library/robinhood-investing-material · https://medium.com/@ericyi/ux-teardown-3-robinhood-79e310f7578

*Section added 2026-09-02. Every claim above about a competitor is sourced from public
product or help documentation, not from a hands-on account; vendor-claimed figures are
marked. "Table stakes we lack" is measured against each page's §1a Features list, not
against a fresh read of the running app. `/cellar` and `/wine-agent` have no page note
in this vault yet, so their rows are written against `/wines` and `/sommelier`.*

### 6a. Adapting the cellar to the house, and whether `/menu` exists (2026-09-03)

The founder's rule: every restaurant is different — a whisky bar, a beer hall, a
non-alcoholic house with soft drinks only — and a house changes what it carries
without the platform sensing it. Four calls were made and two studies run.

**Decided (founder, 2026-09-03):** the declared registers (wine · beer · whisky ·
cocktails · spirits · non-alcoholic · soft drinks) live in **their own table, one
authoritative row per restaurant** (`restaurant_cellar_registers`, `source:
inferred | confirmed | manual`, dated) — never a second copy on `restaurants`;
the platform **infers from the imported menu and inventory, then asks the house
to confirm at onboarding**; registers **ship now, honestly gated** (a register with
no ledger behind it says so; counts come from the library's `beverage_kind`;
stocking waits for OD-113); the prompt shape and the `/menu` question were
delegated with a backtest and a scenario study attached.

**Backtest of the prompt shape** (four scenarios: a wine house adding six taps, a
non-alcoholic café adding cocktails, a hotel bar importing 900 items, a seasonal
spritz list on in June and off in September; three trade sources) — verdict
**AMEND**: the persistent, dismissible **inline notice** beats an interrupting
pop-up in all four (an interrupt is dismissed reflexively within weeks and then
tells nobody anything), with three amendments now in the build: the notice's
call-to-action names the register ("add your beers to /inventory"), several
registers switched on together produce one aggregated notice, and the symmetric
state — a register switched **off while items remain** — gets its own notice and a
"not on the list" band so nothing is lost.

**`/menu` as a surface** (five operator scenarios: a 400-label wine-led room, a
seasonal cocktail bar, a three-site group, a fast-casual with a fixed list, a
hotel with one cellar and three outlets) — **do not build now.** Four of five are
served by Settings-declared registers plus the inventory-add check; the menu
tables that exist (`restaurant_menus`, `menu_items`, food and full types unused)
stay a sensing mechanism, never a second source of truth. **Trigger to build it:**
Mudavym's first genuinely multi-outlet tenant (a core list with per-site
additions, or one cellar feeding several outlets), which production does not
have. The minimum page, when it comes, is the write surface into the declared
registers, sequenced after OD-113. Both studies live in the session record
(`menu-page-research-2026-09-03.md` with the five-cause premortem;
`menu-scenarios-2026-09-03.md`; `backtest-register-prompt-2026-09-03.md`); their
conclusions are the lines above.

### 6b. Where the outward connections live (2026-09-03)

The founder's note on `/profile`: *"be definite about comprehensiveness of design,
MCP's to connectors, to Third party apps and so on. Maybe not in profile you're
right."* This section is the definite answer. It supersedes nothing in §6 or §6a;
it sharpens §6's `/profile` row, whose exponential idea ("**Connected
capabilities** — one list of everything that acts on your behalf … each with its
scope, its last action and a revoke", rated **now**) was written before the wave-4
builds existed and before the placement question was asked.

#### The rule the field agrees on

Ten products were read (sources below). Placement is decided by **whose credential
it is and in whose name the action is taken** — never by what the thing is called.

| The credential authenticates | The action is attributed to | Where it lives |
|---|---|---|
| a **person** | that person | personal / account settings |
| the **business** | the business | a role-gated house or org surface |
| **both** — the org permits the app, the person connects their account | both | **two tiers with a governance link**, never one |

The third row is the one nobody skips. Notion: a workspace owner "can restrict
which connections members are allowed to install", and an Enterprise admin's
**Manage** tab decides which pages a connection reaches and who may connect or
disconnect it. Slack: the workspace owner pre-approves an app *and its scopes*,
then members install it. Claude: "Only Owners can add them to Team and Enterprise
plans. Once a connector has been added … users individually connect to and enable
that connector." Linear: personal API keys under *Settings → Account → Security &
Access*, workspace OAuth applications and webhooks under *Settings →
Administration → API*, **and the admin governs whether members may mint personal
keys at all**. Claude Code's MCP scopes are the same idea in a config file — a
`project` server is shared through version control but **requires each user's
approval before it runs**, while a `user` server is private and never shared.

Stripe states the taxonomy outright: the Dashboard's settings are **Personal**
(password, communication preferences, active sessions, 2FA), **Account/Business**
(account details, payouts, legal entity, domains) and **Product**. GitHub mirrors
one tree for a user's authorized OAuth apps and another for an organization's
installed GitHub Apps. Vercel installs at the account/team (billing runs through
the Vercel account) and attaches resources at the project.

And the two products closest to Mudavym's trade have **no personal tier at all**.
Toast: *Integrations → Integration management*, gated on the `Account Admin >
Manage Integrations` permission, removed one location at a time. Square:
*Settings → App integrations*, restricted to sellers with `account & settings`
permissions. Neither has a concept of "my connection".

**Corollary, on comprehensiveness.** Every connection must state, on its row,
**whose it is, what it may do, when it last did something, and how to stop it**.
Zapier's App Connections row is the field's most complete instance and is worth
copying wholesale: name, the app, **the number of workflows depending on it**, the
last time it changed, **the avatars of everyone it is shared with**, plus test,
reconnect, rename, transfer-ownership and delete.

#### Applying the rule to what Mudavym actually has

Measured on `feat/mudavym-design-p4`, 2026-09-03. Fourteen things can act.

| Attachment | Authenticates | Scope in the schema | Verdict |
|---|---|---|---|
| Google / Microsoft **sign-in** link | a person | `user_oauth_accounts`, identity only, no token | **personal** — correct today |
| Google Drive / Excel **API grants** | a person | `integration_oauth_connections.user_id NOT NULL`, `restaurant_id` **nullable** (`20260826170000:125-126`) | **personal**, but it writes the *house's* exports into a *person's* Drive |
| Sessions, 2FA, passkeys, personal API tokens | a person | none exist (G11) | **personal** — correct, and the largest personal gap |
| **Point of sale** (Toast / pos-hub) | the business | keyed by `restaurantId` on every route (`pos-hub.controller.ts:65,73`) | **the house's** — has no home on any personal page |
| **Payment provider + cards on file** | the business | `payment_methods.restaurant_id NOT NULL`, **no `user_id` column at all** (`20260903094600:53`) | **the house's** — and it is on `/profile` today |
| **Sender identity** | the *deployment* | one env mailbox, `GMAIL_SENDER_EMAIL \|\| "notifications@wineops.ai"` (`gmail.service.ts:75-80`) | **should be the house's**; is nobody's |
| **Calendar iCal feed** | nobody — `@Public()` (`calendar.controller.ts:632-633`) | per-restaurant token | **the house's**, and public to anyone holding the URL |
| **Vendor-facing public page** | nobody — `@Public()` (`vendor-portal.controller.ts:20-21`) | per-slug | **the house's** |
| **Model-context servers** | *contested* | `user_mcp_connections` — **both** `user_id` and `restaurant_id` NOT NULL (`20260903094500:55,61`) | **the open fork** |
| Model provider, encryption keys | the deployment | env | **listed, never controlled here** |

Three findings decide the placement, and each is a fact, not a preference:

1. **`payment_methods` has no user column.** It is a house object living on a
   personal page. Worse, the *read* is ungated — `GET /payment-methods`
   (`payment-methods.controller.ts:65-79`) and `GET /billing/provider` (`:66-78`)
   take any authenticated member, and the card rows render for every role
   (`PaymentRegister.tsx:370-385`); only the buttons check
   `isManagerOrOwner`. Toast and Square both gate this behind a named permission.
   The precedent for the fix is already in the tree —
   `assertManagerOrOwner(userId, restaurantId, "read the restaurant record")` on
   `getLocation`, added 2026-09-03.
2. **The same catalogue is rendered in three places and each shows a different
   subset** — `components/settings/IntegrationsAuth.tsx:161`,
   `settings/next/ServicesSection.tsx:128`,
   `profile/next/ConnectionsRegister.tsx:224` — while POS, sender identity, the
   calendar feed and payments appear in **none** of them. There is no one list.
3. **The scope taxonomy already exists and is already wrong in one place.**
   `settings/next/st-format.ts:31` defines `Kept = 'restaurant' | 'account' |
   'browser'`; `:103` labels `services` as `'account'` while the grants it renders
   are per-user, and `listConnections` (`integrations-oauth.service.ts:476-484`)
   filters on `user_id` alone — so a grant recorded against restaurant A is listed
   while standing in restaurant B. The label is on the tab; it needs to be on the row.

#### The decision

**Profile keeps what is personal: who you are, what protects this account, and what
is attached to you.** A house-scoped surface named **Connections** — opening on
*"What acts for this house"* — holds the till, the payment provider, the sender
identity, the calendar feed, the public page and the model-context servers, plus a
**named-but-not-revocable row for every personal grant that acts inside the
house**, each linking to its owner's profile. One list; two owners marked; revoke
lives where the owner is. Sketch **097**.

*The name.* "Connections" over "Integrations" (Toast/Square's word, which reads as
an IT department), over "Connectors" (Claude's, which would read as a copy), and
over "Apps" (a POS bridge and a sending address are not apps). Notion, Zapier and
Claude all use *connect* as the verb; "Connections" is the word a user will already
have met.

**The strongest counter-argument, and why it loses.** *Settings already has
`services`, `pos`, `email` and `calendar` tabs — all four are connections. A
Connections surface is a fourth place to render the same OAuth catalogue, and
retire-to-write says adding costs retiring.* This is the best case against, and it
fails on two measurements. First, it is not additive: those four tabs **collapse
into it**, so the surface count falls. Second, `/settings` is under a standing
founder instruction that "there should be more" — growing it with a consolidation
is how the sprawl that `/settings` was collapsed to escape comes back. What the
counter-argument does win is the *route* question, which is genuinely open and is
the founder's (§ below).

**The second counter-argument, which is the sharper one.** *Production has one real
tenant and no `staff` role at all (§6, "Two asks are blocked by tenancy"). For a
one-person house the split is pure friction: two pages, one person.* True today. It loses because the split is not for the
single-owner house — it is for the hour the house hires a GM, when the owner needs
to know what that account can do, and discovering the answer is *"it was on his
personal profile page"* is the failure this whole page exists to prevent. The cost
is one nav row, role-gated, so the single owner sees exactly one extra item.

#### The comprehensiveness checklist

Twenty-eight items, four groups, each with the `file:line` that proves the claim —
rendered in full at `.planning/sketches/097-integrations-home/checklist.html`.
Totals: **8 built · 8 a shape · 9 absent · 3 the founder's decision.**

- **The list itself (7).** One list of everything that acts *(absent)* · scope on
  the row *(built — `integrations-oauth.constants.ts:43-66`, better than the
  field)* · last action not last edit *(MCP yes, OAuth no)* · revoke on every row
  *(partial — the calendar feed can only be regenerated, POS has no disconnect)* ·
  whose it is *(absent)* · what depends on it *(absent — Zapier's workflow count)*
  · an unconfigured provider says so and does nothing *(built, best-in-class)*.
- **Scope and governance (6).** Two tiers with a link *(absent — any member may
  complete `POST /integrations/oauth/:id/authorize`)* · role gate on the house's
  rows, **read as well as write** *(writes only)* · a grant survives its author
  *(**decision** — both tables `ON DELETE CASCADE` on the user, so deleting the
  GM deletes the house's Toast bridge)* · the house's own sender identity
  *(absent)* · per-resource grant *(absent, not yet urgent)* · multi-location
  *(**decision** — the two tables already disagree: `integration_oauth_connections.restaurant_id`
  nullable, `user_mcp_connections.restaurant_id` NOT NULL)*.
- **Trust and forensics (9).** Consent in our own words *(built — ahead of the
  field)* · soft revoke not delete *(built)* · **a connection event log** *(absent
  — the cheapest item on the list and the one most missed after an incident)* ·
  re-consent when scopes change *(absent — a trusted MCP server that starts
  advertising `place_order` triggers nothing)* · expiry visible *(stored at
  `20260826170000:138`, read by no surface)* · a failed read is not an empty list
  *(page yes, wire no — `listConnections` returns `[]` on error, G3)* · outbound
  address safety *(built — the guard parses to sixteen bytes and pins the address
  into the socket; the strongest thing in the wave)* · secrets encrypted and never
  returned *(built)* · key rotation with a record *(absent)*.
- **Acting (6).** Handshake not declaration *(built, ADR 0107)* · tool invocation
  gated *(**decision** — ADR 0013 has never been extended)* · card on file without
  a PAN *(built to the credential, ADR 0110)* · webhook delivery proven *(built —
  "configured" and "has ever received a signed delivery" are different states)* ·
  freshness of the register *(manual, G17)* · a catalogue of what could be
  connected *(two entries, both still branded WineOps in their copy —
  `integrations-oauth.constants.ts:46,48,63`)*.

**The shape of the gap:** Mudavym is *ahead* of every product compared on the two
hardest items (a consent screen in our own words; an outbound guard that pins the
address) and *behind* on the two cheapest (one list; a log of who attached what).
And one thing in this comparison **no competitor ships**: applied to a connections
page, ADR 0020's rule that a failed read must name the register it could not read.
Every product above shows an empty list whether nothing is connected or the read
failed.

#### Decided 2026-09-03 — an own route, and four calls with it

The founder chose **"Own route, role-gated"** (question 1 above). `/connections`
is built behind `mudavym_design_connections` and documented at
[[connections]]; the decision, its rejected alternatives and its consequences are
[ADR 0114](../decisions/0114-connections-are-the-houses-profile-is-the-persons.md).
Four of the five questions below are answered by it:

- **Q1 route or settings section** — a route. The counter-argument (four
  `/settings` tabs must collapse into it or the surface count rises) is not
  waived; it is roadmap item 8 on the page note.
- **Q2 whose is a model-context server** — the **house's**. "House declares,
  each person consents." `user_mcp_connections` is renamed
  `restaurant_mcp_connections`, `user_id` becomes `declared_by … ON DELETE SET
  NULL`, and consent is its own table.
- **Q3 may a tool be called** — yes, on terms: a per-tool grant by name, and the
  seal on anything that writes outside the app. ADR 0107 carries the addendum.
- **Q4 the house's own sending address** — decided in direction (its own mailbox
  or a Mudavym subdomain) and **not built**: no sender column, no domain, no DNS.
  `GET /communications/sender-identity` exists so the page can state the shared
  mailbox from the server rather than from prose.
- **Q5 may a manager see or approve a member's connection** — **see, never
  approve**, and may cut the house off from it while the person keeps their own
  grant. There is no pending state, and the migration raises if one appears.

**One claim in this section was wrong and is corrected here.** The applied
inventory above lists the *"Vendor-facing public page"* as **the house's**.
`vendor_portal_pages` is keyed by `vendor_catalogue_id` / `provider_id`
(`supabase/migrations/20260805155901_vendor_portal.sql:27-33`) and has no
restaurant column: it is a page a **vendor** publishes. A house has no public
page at all, and `/connections` says so on the row rather than drawing one.

#### What only the founder can decide

1. **Route or Settings section?** Toast and Zapier make connections top-level
   because they are the substance of the product; Notion, Slack, Square, Linear
   and GitHub make them a settings section because they are not. The founder's own
   words this pass — *"we need to keep the customer inside the app … so MCP or API
   connections is a must"* — argue for top-level, role-gated. Not decided here.
2. **Whose is a model-context server?** The migration says one thing and the page
   says another, and both are in the tree: *"acts with the user's authority, so it
   hangs off the user"* (`20260903094500:53-54`) versus *"Servers the house agents
   may call"* (`McpRegister.tsx:319`).
3. **May a tool ever be called, and what is the human step** — the seal, a draft, a
   per-tool grant? (G18; the fork ADR 0107 deliberately left open.)
4. **Does the house get its own sending address?** A domain, a DNS record and a
   provider decision, not a page.
5. **May a manager see, or approve, what a member has connected?** A GM's personal
   Drive grant receives the house's exports today and no owner can see it exists.

*Sources for this section:*
[Stripe settings categories](https://support.stripe.com/topics/dashboard) ·
[Stripe Organizations](https://docs.stripe.com/get-started/account/orgs) ·
[Linear API & webhooks](https://linear.app/docs/api-and-webhooks) ·
[Linear security & access](https://linear.app/docs/security-and-access) ·
[Notion connections](https://www.notion.com/help/add-and-manage-connections-with-the-api) ·
[Slack app approval](https://slack.com/help/articles/222386767-Manage-app-approval-for-your-workspace) ·
[Vercel integrations](https://vercel.com/docs/integrations) ·
[GitHub apps](https://docs.github.com/en/apps/using-github-apps/about-using-github-apps) ·
[Zapier app connections](https://help.zapier.com/hc/en-us/articles/36818633398157-App-connections-on-Zapier) ·
[Zapier connection sharing](https://help.zapier.com/hc/en-us/articles/8496326497037-Share-app-connections-with-members-of-your-Team-or-Enterprise-account) ·
[Claude custom connectors](https://support.claude.com/en/articles/11175166-about-custom-connectors-via-remote-mcp) ·
[Claude Code MCP scopes](https://code.claude.com/docs/en/mcp) ·
[Toast integration management](https://doc.toasttab.com/doc/platformguide/adminRestaurantServiceIntegrationsAndToastPartnerIntegrations.html) ·
[Square app integrations](https://squareup.com/help/ca/en/article/5437-manage-your-square-app-marketplace-subscriptions) ·
[Square OAuth revocation](https://developer.squareup.com/docs/oauth-api/receive-and-manage-tokens)

---

### 6c. The calendar program (2026-09-03)

The founder's note on `/calendar` asked for two things §6's row does not cover — *"weather
forecast (basically all Quant detailed work) to predict weather, pricings, transportation,
quality of food"* and *"keep the customer inside the app … MCP or API connections is a
must"* — then widened it the same day to the whole program: meetings, notes, daily actions,
reminders, Google Meet, a ⌘K assistant, and every external-calendar direction.

The full design is [[0111-the-calendar-is-the-houses-day-book|ADR 0111]];
the measurements and the per-signal detail are in
[[calendar|calendar.md]] §1b *Quant overlay*, §9 and §12; the drawing is
`.planning/sketches/098-calendar-quant-overlay/`. Three things belong **here**, because
they change how §6 should be read.

#### 1. §6's "Do not copy" for `/calendar` is upheld, not overturned

§6 lists, under **Do not copy**: *"Weather-driven forecasting on the grid — a guess on a
page whose virtue is that everything is a fact."* That is still right, and the design
obeys it on a distinction §6 implies without stating:

> **A published meteorological forecast, attributed to its issuer and its issue time, is a
> citable observation about the future. Our covers number derived from it and drawn without
> its error is a guess.** The first is drawn from slice one. The second is the last slice,
> gated on ninety days of the house's own history, and withheld with a sentence until then.

The mechanism that keeps the two apart is the same one that satisfies §6's *other*
"need it now" idea for this page — *"The day that already happened — past cells hold what
the ledger recorded"*. **Left of today a cell holds the record; right of today it holds a
forecast that names whose it is; when a day passes the cell keeps both and states the
error.** One rule, both ideas, and after ninety days the house has not merely a model but
evidence about whether to believe one.

§6's `/calendar` "need it now" exponential idea — **order-by windows as calendar objects**
— is unchanged and becomes slice 4 of the program. It depends on `vendor_terms`, which
§6 already files as `/settings`' own "need it now" (*"Vendor terms as a tab … each with
provenance … Unblocks the calendar and notification ideas"*). **One table, two pages, one
builder.**

#### 2. The competitive lens, extended to the two things §6 did not price

| | What the field does | What we do differently, and why |
|---|---|---|
| **Weather on an operating surface** | 7shifts shows the local forecast beside projected labour as a manager builds a schedule [^7sf]; Tenzo frames the effect as *extremes* rather than absolute temperature, with rain saturating past a point [^tzwx]. The academic result is larger than either markets: weather moves daily retail sales **up to 23.1% by store location and 40.7% by sales theme**, non-linearly, and forecasts improve accuracy **up to seven days ahead with diminishing returns by horizon** [^bh20]; the effect differs by menu item and by daypart, lunch being most temperature-sensitive [^bbp17] | Nobody in the field **keeps** the forecast and scores itself against it. That is the whole difference. It also forces two things the vendors do not do: the covers term is **non-linear**, and the forecast's weight **decays with horizon** rather than being drawn identically on day 2 and day 14 |
| **External calendars** | Every operating product either publishes a read-only feed or does a full two-way sync and hopes. Notion Calendar's chrome was already ruled out in §6 as the wrong idiom for a wall calendar in a kitchen | Four directions built in an order — push, pull, two-way, expose — where each earns the trust the next spends, and **two-way ships with its conflict rules written down first**: last-writer-wins *per field*, a delete that never wins silently, the loser kept as a note, the echo closed by request-id stamping |

#### 3. The two facts that decide everything downstream

- **The keyless weather source is not commercially licensed.** Open-Meteo's free tier is
  CC-BY 4.0 and explicitly non-commercial, naming subscription apps as commercial use
  [^om]; API Standard is ~$29/month for 1M calls [^omp], and one coordinate per house
  refreshed hourly is ~10k calls/month for fourteen houses. **Cost is never the constraint;
  the licence is.** The genuinely free alternative, NWS `api.weather.gov`, is open data for
  any purpose with no key — and United States only [^nws]. Design answer: a
  `WeatherProvider` interface, three implementations chosen by environment, and the row
  states which issuer answered.
- **Five of the six inputs the overlay needs are empty in production.** 0 of 14 restaurants
  carry a coordinate; the best-covered tenant has 22 observed service days;
  `vendor_price_observations`, `team_certifications`, `recurring_orders` and
  `procurement_documents` are all at zero rows; and there is no shelf-life column anywhere.
  A beautiful overlay shipped today would be a page of dashes — which is why the build
  order starts with **the coordinate**, not with the maths.

**The placement question is already answered.** §6b decides *where* a connection lives by
whose credential it is; a calendar connection is the third row of that table — the house
permits the connector, the person connects their account — so it is **two tiers with a
governance link**, never one. ADR 0111 fork D asks the consequence §6b's rule raises and
does not answer: `integration_oauth_connections` is keyed on `user_id`, but the day-book is
per restaurant, so when a manager leaves, whose Google calendar was the house's?

[^7sf]: https://kb.7shifts.com/hc/en-us/articles/14620377028627-7shifts-Sales-Forecast
[^tzwx]: https://www.gotenzo.com/resources/insight/how-does-weather-affect-restaurant-sales/
[^bh20]: Badorf & Hoberg, *The impact of daily weather on retail sales: An empirical study in brick-and-mortar stores*, Journal of Retailing and Consumer Services **52** (2020) — https://www.sciencedirect.com/science/article/abs/pii/S0969698919303236
[^bbp17]: Bujisic, Bogicevic & Parsa, *The effect of weather factors on restaurant sales*, Journal of Foodservice Business Research **20**(3) (2017) 350-370 — https://www.tandfonline.com/doi/abs/10.1080/15378020.2016.1209723
[^om]: https://open-meteo.com/en/terms · https://open-meteo.com/en/docs
[^omp]: https://open-meteo.com/en/pricing
[^nws]: https://www.weather.gov/documentation/services-web-api
