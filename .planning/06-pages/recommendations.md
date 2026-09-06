---
type: page
route: /recommendations
slug: recommendations
softwares: [recommendations]
component: apps/web/src/pages/Recommendations.tsx
audience: owner
tier: plus
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-09-03
links: ["[[PAGE-CONTRACT]]", "[[orders]]", "[[promotions]]", "[[reports]]", "[[providers]]", "[[inventory]]", "[[team]]", "[[recommendations-catalog]]"]
---

# /recommendations — Recommendations

> **Part of** [[08-softwares/recommendations|Recommendations]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Act** (per card; label varies — "Draft PO", "Create promo", …) → [[orders]], [[promotions]], [[reports]], [[providers]], [[inventory]] or [[team]] by rule/category
- **Browse every insight type** → [[recommendations-catalog]] `/recommendations/catalog`
- **Enable more insight types** / **Open Reports** (empty state) → [[reports]] `/reports`
- **Dismiss / Snooze / Assign / Pin** → API `POST /api/v1/analytics/recommendations/:restaurantId/action`
- **Copy link** → clipboard deep link
- **Make this a goal** (redesign, per entry) → API `POST /api/v1/analytics/goals/:restaurantId`; the goal is then read in [[reports]]
- **See it in reports** (redesign, per entry) → [[reports]] `/reports?cutting=<analysisId>&rec=<ruleKey>&from=recommendations`

## 1. Purpose

"The translation layer page, now actionable. Each card = one deterministic rule
that fired: the observed number, the concrete action, and why the action follows …
(no LLM — auditable rules)" (`Recommendations.tsx:1-7`). Cards support act / dismiss
with reason / snooze / done / pin, bulk actions, keyboard flows, digest settings,
history, and assignment to team members (UX paths NEW-284…NEW-308, header comment
:8-14).

## 1a. Features
- Recommendation cards, one per fired deterministic rule: the observed number, the concrete action, and why (no LLM — auditable)
- Per-card: act / dismiss with reason / snooze / done / pin; bulk actions; keyboard flows
- Assign a recommendation to a team member
- Tabs: active / history / dismissed / snoozed / done
- Digest frequency settings
- 🚧 Not in the sidebar — reachable only via command palette or the catalog (§9)
- **Mudavym redesign behind `mudavym_design_recommendations` (OFF)** — *the standing
  book* (§1b): entries filed under **what acting on them would change** (Money ·
  Stock · Vendors · The floor · Unfiled), every entry stating the same three facts —
  what it would change · whose hand does it and where the work lands · how long it has
  stood; the head prints the **denominator** ("17 rules were read. 4 entries stand");
  leaves for standing / snoozed / dismissed / ruled-off / history; act · dismiss with a
  reason · snooze · pin · assign · feedback · bulk all kept, and **ruling an entry off
  is the one hold-to-seal act** on the page
- **The docket has seven headings, since 2026-09-04** — *Order it · Price it · Move
  stock · Call a vendor · Brief the floor · **Schedule it** · **Goals slipping***, plus
  *Not yet filed* for a rule this page does not recognise and the dark *Change a rule*.
  Every entry under **Schedule it** carries *Put it on the day-book*, which prints the
  drafted calendar line (title · date · type · note naming the rule) and opens
  `/calendar?new=<json>` — which the calendar **reads** since 2026-09-04, so the entry
  arrives already filled in and the manager only checks and saves it
  (`pages/calendar/next/CalendarNext.tsx:66-106`; the draft stays printed here so a
  person sees what is being carried across). Every entry under **Goals slipping** carries *See where the
  goal stands* — a deep link to the reports desk, naming the goal in words — plus the
  levers the rule points at, taken from the gateway's own metric→category table.
- **The day strip is the house's, and shows a full calendar month** (2026-09-04):
  `components/mudavym/DayStrip.tsx`, shared with `/notifications`. Previous/next month
  controls, the month containing today by default, the future half drawn empty rather
  than hatched, and the keyboard map (arrows · Home/End · Enter/Space · Escape) in one
  place for both pages.
- The redesign authenticates **by construction and is held there by a test** — the only
  build of this page whose transport is asserted: `useRecommendationsNextData.test.tsx`
  proves the read goes through `apiClient` and that `fetch` is never called. (The
  legacy page's own repair landed earlier, in `58113e26`, with no test — §10.)
- 🚧 **Daily digest (NEW-303) renders DISABLED in the redesign.** The preference stores
  (GET/PUT `…/digest` work), but nothing sends it: no scheduler anywhere reads
  `recommendation_digest_prefs` — verified by grep across the repo on 2026-09-02, and
  stated in [[08-softwares/recommendations]]:101-103. The legacy page's toggle says
  "top actions to your inbox"; no inbox receives anything.
- 🚧 **"Let Mudavym do it" renders DISABLED** on every entry, with the reason: no
  autonomous execution path exists in the gateway for any recommendation, with or
  without permission. The only autonomous switch in the product
  (`enable_ai_autonomous_send`) belongs to vendor email, not to this feed.
- `?insight=<ruleKey>` (NEW-759) opens and focuses that entry, and says in words when
  the rule asked for is **not** standing (ruled off, dismissed, snoozed, or no longer
  firing) instead of landing silently on a book that does not contain it
- **"Standing" is the real first-fired date** (second pass, 2026-09-03). The gateway now
  attaches `firstSeenAt = min(shown_at)` per rule key from `recommendation_impressions`
  (`recommendations.service.ts` `attachFirstSeen`), and the entry says which clock it read
  — "since it was first shown to you" vs "since the book last recorded a decision on it".
  An em dash only where nothing recorded either; never 0 days, never today. Closes §13.7.
- **Dismissal is a durable, SCOPED suppression the insight generator honours**
  (second pass). Dismissing writes a key of the shape `rule#subject#period` — three scopes
  offered per dismissal, defaulting to the exact finding — and both the recommendations
  feed *and* `InsightGeneratorService.generate()` withhold anything it matches, on every
  subsequent run. Before this, `dismiss` was read by exactly one consumer and the sentence
  kept reappearing wherever else insights are shown.
- **"Also exclude this from the analysis"** — the second choice at dismissal time, stored
  separately in `analytics_day_exclusions` and consulted by every daily series the engine
  builds. Hiding a sentence and correcting an average are different acts.
- **The head prints what a dismissal withheld** — "3 entries were withheld because you
  dismissed them" — and says so plainly when the dismissal store could not be read at all.
- **Two forward doors on every entry** (fourth pass, 2026-09-03). **Make this a goal** writes a
  real goal — `POST /analytics/goals/:rid` — with the metric, the direction, the period and the
  name derived from the rule that fired and **only the target asked of the manager**; nine of the
  thirteen rules map to one of the gateway's supported metrics (six when this was measured;
  a seventh, `days_of_inventory`, landed 2026-09-04 under ADR 0120), three map to none and render the control
  disabled with the reason, and the `goal_behind_*` family refuses because it already *is* a goal.
  **See it in reports** deep-links to the one cutting of the reports sheet's eleven whose register
  answers this rule, saying whether that is the same register the rule read or a different one that
  plots the same quantity; four rules have no cutting and say so. Mapping, bases and refusals:
  `apps/web/src/pages/recommendations/next/rec-forward.ts`.
- **The controls are themselves classified** into two labelled rows — **Carry it out** (act · make
  a goal · see it in reports) and **File it** (the working · snooze · dismiss · pin · select) —
  the control-side half of the founder's "everything in a categorized classified section".
- **THE DOCKET — the page is filed by the act your hands perform** (rework, 2026-09-03).
  Top level is now **Order it · Price it · Move stock · Call a vendor · Brief the floor**, plus a
  **Not yet filed** heading for any rule whose prescription is none of the five (the
  `goal_behind_*` family asks you to *choose* a lever, not perform one) and for any rule this
  page does not recognise. Each section carries its **count**, a line on what doing the whole
  section looks like, and a **money-at-stake line that is withheld in words** — the register
  (Money · Stock · Vendors · The floor) survives as the ordering *inside* a section and as the
  rail that cuts across all of them. One spine, one cross-cut. Mapping and the sentence each
  filing was read from: `apps/web/src/pages/recommendations/next/rec-docket.ts`.
- 🚧 **No section can say what it is worth.** The engine states each entry's money inside its
  sentence, not as a field, and the figures are not the same quantity from rule to rule (spend
  accelerating is not exposure; capital locked in idle stock is not margin foregone). Every
  heading shows an em dash and the page says why, once, above the docket. §9 files the gateway
  field that would fix it.
- 🚧 **"Change a rule" is drawn dark** — the founder's own fifth heading, rendered with the
  reason rather than left out: no rule threshold can be tuned from anywhere in the product
  (they are constants in `recommendations.service.ts`), and the only feedback the engine takes
  from a manager is a dismissal, which silences a finding rather than moving a threshold.
- **THE RIBBON — the day strip, as a selector above the docket** (rework). 29 cells: 21 days
  behind, today, and the 7 ahead a deadline can fall in. It draws **when an entry first fired**
  (`firstSeenAt`), **what falls due** (a goal's deadline, a snoozed entry's wake date) and
  **which days carry no record at all — hatched, never a bar of zero**. Selecting a day narrows
  the docket to the entries that touch it (first fired on it, waking on it, or watched by a goal
  falling due on it); selecting nothing leaves the whole book. Keyboard: ← → a day, ↑ ↓ a week,
  Home/End the ends, Enter selects, Esc clears, roving tabindex and a visible focus ring.
- **"No records" comes from the till, and has four states, not two.** The ribbon reads
  `GET /analytics/pos-revenue/:rid?days=22`, whose `dailySeries` is **sparse** — only days that
  carried a non-voided check appear (`goals.service.ts` `computeMetricWithSeries`). A day inside
  the answered window that is absent is `none` (hatched); a window that could not be read, or a
  house with no till at all, is `unknown` (nothing hatched, and the page says so); a day that has
  not happened is `future`. **A dated measurement, not a fact:** on 2026-09-03 the local tenant
  carried 12 of 22 days, so ten drew hatched. The demo seed ends 2026-08-24 and the window is
  relative to today, so the count falls by one each day this is left unre-seeded — read the
  figure as of its date, never as the page's steady state.
- **The day-exclusion control lives on the strip.** Striking a day rules it out of every baseline
  (the existing `POST /analytics/exclusions/:rid` write) and still asks for a reason first; an
  excluded day is struck through on the strip and can be counted again from there. When the
  exclusion store cannot be read, the control is not offered and the page says why.
- **A goal records the recommendation it came from** (rework) — one nullable column,
  `analytics_goals.source_rule_key` (migration `20260903161000`), validated in the gateway
  against the rule catalogue. An entry whose rule a live goal names now says **"this entry is
  being watched — goal X, due …"** and carries a `watched` stamp; the goal sheet warns about the
  exact duplicate rather than only about the figure. A goal with a NULL source was set by hand
  and watches nothing — the page never infers a watch from a shared metric.

### Added 2026-09-04 — the book of scenarios on the goal sheet (ADR 0120)

- **Start from a scenario**, above the "Held on" block. On this page the measure
  is already chosen — the rule knows which figure its own prescription moves — so
  the book is an OVERRIDE rather than the starting point, and the default option
  is *"This entry's own measure: <label>"*.
- **It states what the override costs.** A goal held on a different figure is not
  this rule's goal, so the write drops `source_rule_key`; the sheet says so
  before the button is pressed (*"this goal will not record which entry it came
  from — so this entry will not show as watched"*), and the duplicate warnings
  below it switch to the new figure. Keeping the provenance across a swap would
  make the "this entry is being watched" line a guess.
- **It never fills the target.** Same rule as `rec-forward.ts` already carried:
  the rule states a gap, not a number the house should be held to. The scenario
  adds the operator RANGE beside it — quoted in the source's own words with the
  source's URL and date — plus the standing caveat that a range is a fact about
  the houses in that report and not about this one.
- **A quarter scenario keeps the period the manager chose**, and says so: this
  sheet only mints a week or a month (`deadlineFor`), and silently narrowing a
  quarterly scenario to a month would change what the goal means.
- **A scenario naming a measure this page does not carry is REFUSED with a
  sentence**, never coerced onto the nearest one — that is the two catalogues
  having drifted, and a drift must read as words rather than as a different
  write.
- **Dark, honestly:** `scenarios === undefined` reads "Reading the book of
  scenarios"; `null` reads one line saying it could not be read and that the
  entry's own measure is still offered. There is no bundled copy to fall back
  to.

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_recommendations`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, the theme menu and the account menu. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.

Canonical source with curves: `apps/web/src/pages/recommendations/next/MOTIONS.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `rc-work-settle` | The working opens | an entry's rationale/rule/assignment/seal panel, `grid-template-rows: 0fr → 1fr` on `settle` (320ms house curve) — the row-expand the founder named by hand in the wave-1 review |
| `rc-leaf-turn` | A leaf turns | changing leaf (Standing → Snoozed → Dismissed → Ruled off → History) — `turn`, 420ms, fade + 5px rise, once per leaf |
| `rc-ink` | Ink micro-state | entry left-rule warming to the seal ring on hover/focus, quiet-button borders — `ink`, 160ms; nothing moves |
| `rc-hold-pour` | The hold fills | `HoldToApprove` on **Hold to rule off** — `pour`, linear 620ms; an early release retreats on `tuck` and says what did not happen |
| `rc-seal-stamp` | The seal lands | the hold completing and the entry being ruled off — `stamp`, ~11% overshoot, the only wax on the page |
| `rc-ribbon-ink` | A day fills | a ribbon cell hovered, focused or selected — `ink`, 160ms. A day fills; it never grows, slides or bounces |
| `rc-docket-tuck` | The docket settles | the ribbon selecting or clearing a day, or the register changing what the docket holds — `tuck`, sampled spring 380/32, 300ms, once for the whole docket. Rows never fly between sections: in a day selection no row moved, the set of rows is a different set |

(Second pass, 2026-09-03: the dismissal sheet adds **no** motion — it is the one
control that stores a standing instruction, and a panel that slides while someone
decides what to silence is asking them to hurry. See MOTIONS.md §"Second pass".)

(Fourth pass, 2026-09-03: the goal sheet adds **no** motion either, for the same reason —
it is the page's second standing instruction, and a target is a number a house is judged
against afterwards. The two classified control rows add none: they are a layout, and a
label that animates into place is a label that was not there when the eye arrived.)

(The rework, 2026-09-03: the whole change of spine added **one** motion, `rc-docket-tuck`.
A hatched day does not shimmer, a bar never grows from zero, and the day panel appears at
once like both sheets before it. See MOTIONS.md §"The rework".)

Deliberate non-motions: the seal is rationed to ruling off (every other action is the
same die pressed dry); a dismissed entry leaves at once and the undo line — not an
animation — is what makes it recoverable; unknowns never animate (a static em dash and
a moving skeleton are different claims); the register does not animate when filtered.

### Design used, and why (ADR 0044 p4 wave · MAKEOVER-VERDICTS: REWORK)

**The verdict, verbatim** (`MAKEOVER-VERDICTS.md:183-185`): *"`/recommendations` —
REWORK / find another way. Likes the new version but wants **more structure and more
uniqueness**. 'Maybe we should find another way.'"*

**The structure that enforces it.** The legacy page is a flat feed ranked by a hidden
`score`, filtered by coloured category chips — the shape the founder said to leave. The
rebuild is ruled by **consequence**: the page's organising axis is *what acting on an
entry would change*, and the left-hand **register** (Money · Stock · Vendors · The floor
· Unfiled) is both the table of contents and the filter. Under it, every entry carries
the same three facts in the same place — **would change · whose hand (and where the work
lands) · standing** — which are exactly the three axes the founder named and the three
the legacy feed never showed. Urgency stays the engine's own word ("Tonight" / "This
week" / "This month") and the score stops being the page's organising principle.
`unfiled` exists on purpose: a rule category this page has no register for shows up as
unfiled rather than being absorbed into a bucket it was never sorted into.

**Uniqueness, and where it comes from.** Three things exist on no other surface: the
**denominator in the opening line** ("17 rules were read. 4 entries stand — the rest did
not fire, or you have already ruled them off"), which turns a short book into a proven
absence instead of a silence (ADR 0020); **the working**, where the rule key is printed
in mono with "a deterministic rule … no model wrote this sentence"; and **ruling an
entry off** — the one hold-to-seal act, chosen because the double rule *is* the house's
sign that an account is closed, and because asserting "the work was done" is the only
claim on this page a manager makes about the world rather than about the feed.

**Honesty rules applied.** (1) Standing is an em dash wherever nothing recorded it.
(2) 401 ("your session has expired"), 403 ("this account is not allowed") and everything
else ("could not be read (…) — this is not an empty book") are three different
sentences; the legacy page rendered all three as `Request failed (401)`. (3) A failed
read never renders as an empty list, and a write that did not land puts the entry back
and says so. (4) The two controls whose backend does not exist — the digest sender and
autonomous execution — are rendered **disabled with the reason**, not as working
buttons. (5) The empty book says why it might be short (rules needing till data stay
silent without a POS) and links the catalogue.

**Two directions considered and NOT built — the founder's fork.**
*(a) The run-sheet.* One sheet banded by time-to-act (Tonight / This week / This month)
with the register demoted to a filter, printed and carried to the pass. It is the more
operational page and probably the better one on a Friday — but it re-centres the page on
urgency, which is the axis the legacy already had, so it answers "more structure" and
not "more uniqueness". *(b) The two-pane docket* (the archetype in this note's
frontmatter, `list+detail`): a narrow list of entries left, the full working pinned
right. It reads beautifully with a long book and is dead space with a short one — and
short is what a restaurant without POS coverage actually gets (§11). Both are one
refactor away from the current build; the register and the three-fact line survive
either.

**Substituted / left out, disclosed.** *Search, sort and category filters* (NEW-288/289/
290) are not rebuilt: the standing leaf never holds more entries than rules that fired,
and with the register doing the filing a search box is furniture at that length — if the
book grows past a screen the founder should have them back, and they are cheap. *The
context menu and double-click paths* (NEW-305/306) are dropped in favour of visible
controls; every action on the page is a real button and a key. *`Copy link`* is not
rebuilt — the page reads `?insight=<ruleKey>` (NEW-759: it opens and focuses that entry,
and says so plainly when the rule is not standing) but nothing on it mints a link
(§13.12). *The digest editor* (hour, minimum urgency, recipient) is not built at all,
because its sender is not built either.

### Second pass, 2026-09-03 — dismissal that holds

**What the founder asked, verbatim.** *"I expect all of the endpoints to be profoundly
solid, such as 'Wednesday sales came in 100% lower than your average Wednesday'. If the
person says dismiss, then it should be avoided at all costs — and then we're going to let
them know about this as well; or they have the opportunity to either cancel it and discard
it from the analysis or not."* Plus, by message during the pass: **ask per dismissal**,
default *this exact finding*, offer all three scopes, keep the exclusion checkbox separate,
and make every choice undoable from the History leaf.

**The sentence he quoted was real, and it was a bug.** On 2026-09-03 the local gateway
returned it verbatim from the live rule engine, along with its sibling:

```
GET /api/v1/analytics/recommendations/550e8400-…
  "Wednesday sales came in 100% lower than your average Wednesday ($0 vs $104)."
  "sales fell 100% vs the previous week ($0 vs $2.4k)."
```

Neither is a measurement. `InsightGeneratorService.toDaily` bucketed rows by day and filled
every gap with a literal `0`, so a closure, a POS outage and a genuinely dead day were the
same number to every baseline downstream. The restaurant had not lost 100% of its Wednesday
trade — the system had no records for that day and called it zero. Absence reported as a
measurement, which is the same fault as absence reported as health, told with a percentage.

**What was built in the gateway** (file:line):

| Change | Where |
|---|---|
| A day with no rows is `observed: false`, not a zero; a day the manager excluded is too | `analytics/insights/insight-generator.service.ts` `toDaily` (:463) |
| The weekday baseline compares the latest **observed** day, drops unobserved days from the same-weekday history, re-applies `MIN_BASELINE_N = 3` **after** that filter, and dates the sentence whenever it had to skip back | same file, `timeSeriesInsights` §1 |
| Week-over-week withholds unless both windows carry ≥ `MIN_PERIOD_OBSERVED = 4` observed days and differ by ≤ 1 | same file, §2 |
| The 28-day trend needs `MIN_TREND_OBSERVED = 14` real days; the anomaly scan skips unobserved days as candidates *and* as comparison set | same file, §3–§4 |
| A baseline of zero yields no sentence — asserted at both guards (`groupBaseline` reports `in_line` with a null `deltaPct`; `verbalize('baseline')` returns null) | `engine/comparisons.ts:37`, `insights/insight-verbalizer.ts:99` |
| The support count travels with the claim: "…over 11 past Wednesdays" | `insight-verbalizer.ts` `baseline` case |
| **Suppression keys** — `rule#subject#grain`, three scopes, the bare rule key as the canonical `rule#*#*` so every dismissal written before today keeps meaning what it meant | **new** `analytics/insights/suppression.ts` |
| `InsightGeneratorService.generate()` now reads the dismissal set and withholds what it matches, returning `suppressed` and `suppressionsReadable` | `insight-generator.service.ts` (the "dismissals, honoured HERE" block) |
| `RecommendationsService` attaches `suppression.{key,scope,keys}` to every entry and filters on the same target the UI dismisses with | `analytics/recommendations.service.ts` |
| `firstSeenAt` per rule from `recommendation_impressions` | `recommendations.service.ts` `attachFirstSeen` |
| `readDispositions()` / `listSuppressions()` carry a `readable` flag — an unreadable actions table is no longer an empty one | `analytics/recommendation-actions.service.ts` |
| **The exclusion store** and its three routes (`GET/POST/DELETE /analytics/exclusions/:rid`) | **new** `analytics/insights/day-exclusions.service.ts`, `analytics.controller.ts` |
| **The insight cache carries its arithmetic** — `INSIGHT_GENERATOR_VERSION`, `persist()` stamps it, `getStored()` treats anything below as absent, `staleVersionCategories()` finds tenants still holding superseded rows | `insight-generator.service.ts` (the version constant + `getStored` + `staleVersionCategories`) |
| The hourly sweep replaces superseded rows regardless of the configured cadence | `insights/insight-scheduler.service.ts` `runSweep` |
| `act` awaits the write and stays put when it did not land — `navigate()` unmounted the page before a rollback could be seen | `RecommendationsNext.tsx` `act`; `setDisposition` now returns whether it landed |
| Migrations | **new** `supabase/migrations/20260903091000_days_the_engine_must_not_count.sql` and `20260903130000_insight_rows_carry_their_arithmetic.sql` |

**The key, written down.** A suppression key is `<ruleId>#<subject>#<grain>`:
`ruleId` is the rule as the engine emits it (`sales_below_weekday_baseline`, or
`insight:<candidateKey>` for a raw insight); `subject` is the slugged thing the sentence is
about (`wednesday`, `table-4`) or `*`; `grain` is the period at its own grain (`d:2026-09-02`,
`p7:2026-09-02`, `t28:2026-09-02`) or `*`. Three scopes, and only three:
`insight` = `rule#subject#grain`, `subject` = `rule#subject#*`, `rule` = `rule#*#*`, which
normalises back to the bare rule key. Matching is set membership over the five keys that
could suppress a target — never a prefix scan — so a key nobody can generate cannot hide
anything, and a key that IS generated can never be silently unmatched.

Two honesty consequences, both built: a rule that names no subject and no period collapses
all three keys, so the sheet offers **one** choice and *names it* "This rule entirely" plus
a line saying why there is nothing narrower; and the sheet never constructs a key — the
gateway sends all three, because "the same insight" must mean exactly one thing on both
sides of the wire.

**What the page does with it.** `Dismiss` opens a sheet: a reason (required — the button
stays dark and says why), a scope radio group defaulting to the exact finding, and a
separate checkbox "Also exclude Wed 2 Sep from the analysis" that is disabled with its
reason when the entry names no day or the exclusion store cannot be read. Under them, in
words, what will never be shown, and where to undo it. After the write, the status line
repeats the promise and offers Undo; the Dismissed and History leaves render the stored key
back as a sentence ("Silenced: this one finding about wednesday on Wed 2 Sep. The rule still
reads every other day.") beside **Return it to the book**. The `d` key now *opens* the sheet
rather than dismissing — a keystroke cannot choose a scope on the manager's behalf. Bulk
dismiss cannot ask per entry, so it takes the widest scope and says so on the control itself:
**"Dismiss them — whole rules"**.

**Verified, not asserted — and which endpoints.** Against the running local gateway on :4000,
for `550e8400-…`, **both** readers of this generator were checked, because the first attempt at
this paragraph checked only one and was wrong (see "The cache was still serving it" below):

| Checked | Result |
|---|---|
| `GET /analytics/recommendations/:rid` (fresh compute every request) | 0 sentences claiming 100%; `firstSeenAt` real ISO timestamps; `suppressed`/`suppressionsReadable` present |
| `GET /analytics/insights/:rid` (prefers the `analytics_insights` cache) | 0 sentences claiming 100%; answers with a **fresh compute**, not `"source":"stored"` — the version gate is refusing rows whose provenance cannot be established |
| `GET /analytics/exclusions/:rid` | `readable:false`, *"Could not find the table 'public.analytics_day_exclusions'"* — the page renders exactly that sentence rather than an empty list |
| `POST …/action` dismiss → re-read → restore | feed 3 → 2 (`suppressed:1`, counts agree) → 3; tenant left as found |
| `analytics_insights`, read directly with the service key, **all tenants** | 0 rows whose stored sentence still claims 100% |

The withholding tests were run against a pre-fix control (the observed-day distinction removed):
**6 of 18 fail** on it. The cache-version tests were run against their own pre-fix control (the
version filter and the sweep's stale check removed): **4 of 9 fail**. The `act` test was run
against the fire-and-forget original: it fails.

**The cache was still serving it.** The first pass of this section claimed "both 100% sentences
are gone from the live feed" on the strength of one endpoint. The audit checked the sibling and
found the founder's exact sentence still live:

```
GET /api/v1/analytics/insights/550e8400-…   → "source": "stored"
"Tuesday sales came in 100% lower than your average Tuesday ($0 vs $72)."
computed_at 2026-09-02T06:00 — the hourly sweep, with the old arithmetic
```

`analytics_insights` is a write-through cache that `getStored()` read with **no freshness and no
version check**, and three readers prefer it over a fresh compute
(`analytics.controller.ts:318`, `advanced-analytics.service.ts:613`, `goals.service.ts:217`).
Fixing the arithmetic fixed every fresh compute and nothing else. Age could not have decided it
either — an hour-old row can be right and a minute-old one wrong. Only provenance can:

- `INSIGHT_GENERATOR_VERSION = 2` (`insight-generator.service.ts`), bumped whenever a change
  alters what a sentence *claims*, with the version history written next to it.
- Migration `20260903130000_insight_rows_carry_their_arithmetic.sql` adds
  `analytics_insights.generator_version integer not null default 0` — the default is the point:
  every row already in the table predates the fix, so all of them are stale from the moment the
  migration applies, with no backfill, no purge and no deploy hook.
- `persist()` stamps the version; `getStored()` filters `gte(generator_version, CURRENT)` and
  treats anything below as **absent**, so the caller falls through to a fresh
  `generate({persist:true})` and the cache corrects itself on first read. `gte` not `eq`, so a
  rolling deploy's newer rows are served rather than thrashed over.
- The hourly sweep is cadence-gated (a `daily @ 06:00` category refreshes once a day), which
  would have left superseded rows in the table for up to 24 hours — measured, that is exactly
  what happened. `staleVersionCategories()` scans every tenant in one read and makes such a
  category due **now, even if the operator set it to `manual` or disabled it**: those
  preferences govern how often we look for new findings, not whether the product may keep
  serving a sentence it has retracted.
- A failed version read serves nothing rather than rows of unknown provenance, and a failed
  stale scan is logged as "this sweep refreshes on cadence only", never absorbed.

Nine tests pin it (`insights/insight-cache-version.spec.ts`), including the load-bearing
negative: a row from superseded arithmetic is never returned.

**What is still open.** The scoped suppression path is proven by 76 gateway tests but only
the *rule* scope could be exercised end-to-end on the local tenant, because the only entries
that fire there name no subject — the subject/period scopes are unit-proven, not
curl-proven. And `analytics_day_exclusions` does not exist in the database until this
migration merges, so the exclusion checkbox is disabled in the running app today; that is
rendered as the reason, not hidden.

### Fourth pass, 2026-09-03 — the two forward doors, and the shape question re-opened

**What the founder asked, verbatim.** *"I need your help (I said rework new design but not sure),
what would you select I also liked the day strip a lot. But I need your expertise maybe create 2-3
more sketch to understand behaviour and what would work the best. Especially some brainstorming
ideas — a calendar strip that we can select and see that is highly advanced and elegant looking, or
sth else. The need is that we need to everything in a categorized classified section in order for
people to understand what to do as action"* and *"maybe add couple buttons — that will let them set
the recommendations as goals, or have them see this changes in reports (research the possible
endpoints it can reach to give them better insight)."*

**What was built.** The two buttons, for real, on every standing entry — nothing about the page's
shape was changed, because the shape is the founder's fork and the sketches are how it is put to him.

| Change | Where |
|---|---|
| The rule → goal-metric map (9 of 13 rules), the three refusals, the goal-behind refusal, the period and deadline derivation, and the percent→fraction conversion | **new** `apps/web/src/pages/recommendations/next/rec-forward.ts` |
| The rule → reports-cutting map (9 rules), its `same-register` / `same-question` basis, the four "no cutting answers this" refusals, and which cuttings lie on an unarranged sheet | same file |
| `goals` / `loadGoals` / `createGoal` — a lazy per-tenant read of `GET /analytics/goals/:rid?status=active` and the `POST` write, with the gateway's own 400 handed back verbatim | `useRecommendationsNextData.ts` |
| The goal sheet (metric · basis · editable name · required target · period radio · derived deadline · duplicate warning), the two classified control rows, and the forward sentence under them | `Entry.tsx` (`GoalSheet`), `RecommendationsNext.tsx`, `rec-next.css` |
| 29 new tests: 12 on the mappings, 12 on the two buttons' render contract, 5 on the goal transport | `rec-forward.test.ts`, `RecommendationsNext.test.tsx`, `useRecommendationsNextData.test.tsx` |

**The goal mapping, and its basis.** A goal is `{name, metricKey, targetValue, deadline, period,
direction}` (`analytics.controller.ts:497`, `goals.service.ts` `createGoal`). Everything except the
target is derived from the rule that fired; the target is typed, because **a rule states a gap, not
a number a house should be held to**, and `EntryVM` carries the observation as a formatted sentence,
so any figure scraped back out of it would be invented.

| rule | metric | direction | why that metric |
|---|---|---|---|
| `sales_below_weekday_baseline` | `wine_revenue` | at least | the rule compares a day's wine sales with the same weekday's baseline |
| `weekly_demand_slide` | `wine_revenue` | at least | the same quantity at a longer grain |
| `weekday_gap` | `wine_revenue` | at least | it prescribes an offer on the weakest weekday |
| `dead_stock_capital` | `bottles_sold` | at least | the act is bottles leaving the shelf; the capital figure is not a supported metric |
| `plowhorse_repricing` | `wine_revenue` | at least | a price rise at constant volume lands in revenue |
| `puzzle_activation` | `bottles_sold` | at least | the by-the-glass test is whether the bottles move |
| `spend_acceleration` | `purchase_spend` | **at most** | the same number the rule read — the one goal here that counts down |
| `staff_spread` | `avg_check` | at least | the insight behind it is `waiter.avg_check.peer_rank` (`insight-generator.service.ts:1134`) |
| `pairing_promotion` | `wine_attach_rate` | at least | a pairing at the table is an attach-rate move |
| `stockout_imminent` · `vendor_concentration` · `revenue_concentration` | **none** | — | availability, an HHI and a Gini are not among the six figures `SUPPORTED_METRICS` holds (`goals.service.ts:32-70`) |
| `goal_behind_*` | **none** | — | it already *is* a goal; a second one would double-count the target |

Period comes from urgency: `this_month` → `month`, everything else → `week`. `now` is deliberately
**not** mapped to `day` — "tonight" is a window for acting, not one a figure can be read over — and
the manager can widen week→month in the sheet. The deadline is +7 or +30 days and is **stated before
the write** because it can never be changed afterwards: the gateway's only post-creation goal write
is `PUT …/status` (`analytics.controller.ts:536`). `wine_attach_rate` is stored as a **fraction**
(`goals.service.ts:387-398`), so a typed 60% is written as `0.6` and the sheet says so.

**The reports mapping, and its basis.** The reports sheet lays down eleven analyses
(`apps/web/src/pages/reports/next/rp-catalogue.tsx`); each rule is sent to the one whose register
answers it, labelled `same-register` (the cutting reads the endpoint the rule read) or
`same-question` (a different register that plots the quantity the rule names):

| rule | cutting | endpoint | basis |
|---|---|---|---|
| `weekday_gap` | The week's shape | `/analytics/seasonality` | same register |
| `sales_below_weekday_baseline` | The week's shape | `/analytics/seasonality` | same question |
| `weekly_demand_slide` | Through the till | `/analytics/pos-revenue` | same question |
| `stockout_imminent` | What to buy back | `/analytics/inventory-science` | same register |
| `dead_stock_capital` | Figures of record | `/analytics/financial` | same register |
| `plowhorse_repricing` · `puzzle_activation` | Margin against movement | `/analytics/menu-engineering` | same register |
| `spend_acceleration` | Spend pacing | `/analytics/cashflow` | same register |
| `staff_spread` | Who served it | `/analytics/waiters` | same question |
| `vendor_concentration` · `revenue_concentration` | **none** | `/analytics/risk` is not one of the eleven | — |
| `pairing_promotion` | **none** | basket affinity reaches the sheet only as a sentence inside "The reading" | — |
| `goal_behind_*` | **none** | goal progress is not one of the eleven | — |

Two of the mapped cuttings (`restock`, `service`) are **not on an unarranged sheet**
(`rp-sheet.ts` `DEFAULT_ON`), and the entry says "add it with Add a cutting" rather than implying it
will be there. The link is `/reports?cutting=<id>&rec=<ruleKey>&from=recommendations`; **the reports
page does not read that parameter yet** — grepped 2026-09-03, no `useSearchParams` and no
`URLSearchParams` anywhere under `apps/web/src/pages/reports/` — so the entry says the sheet does not
open on a named cutting. §13.18.

**Verified, not asserted.** Against the running local gateway on :4000 for `550e8400-…`:

| Checked | Result |
|---|---|
| `GET /analytics/goals/:rid?status=all` | 200, real rows |
| `POST /analytics/goals/:rid` with a derived body | **201**, row returned with `baseline_value` computed |
| `POST` with `metricKey: "nope"` | **400** `Unsupported metric 'nope'. Supported: wine_revenue, bottles_sold, …` |
| `POST` with `targetValue: 0` | **400** `targetValue must be > 0` |
| `GET …/:goalId/progress` | 200, with pace, `onTrack` and `projectedAtDeadline` |
| the probe goal | archived via `PUT …/status`, so the tenant is left as found apart from one archived row |

The mapping tests were run against a mutated control (the `spend_acceleration` direction flipped to
`at_least`, the percent conversion made an identity, one refusal removed): **4 of 29 fail** on it.
No web dev server was running in this worktree and the brief forbids starting one, so the page-level
evidence is the render contract, not a screenshot; the three sketches are screenshots of the shapes.

**The shape question, and the recommendation.** Three new directions are drawn full of data in
`.planning/sketches/094-recommendations-directions-2/`: **094a the calendar strip** (28 days across
the top, what fired · what falls due · what it is worth · which days have **no records at all**,
hatched not zeroed; select a day and the book becomes that day; hover an entry and a hairline draws
its life back to the day it was first shown; double-click a day to strike it from the analysis),
**094b the action docket** (filed by the act — order it · price it · move stock · call a vendor ·
brief the floor — each with count, money at stake and one line on what doing the section looks like;
the founder's fifth heading *change a rule* drawn dark because nothing is behind it), and **094c the
case ledger** (opened → acted → watching → closed-with-a-result, plus *refused* as a state that keeps
its reason; a goal is the instrument that moves a case into watching).

The recommendation is **094b as the spine, 094a above it as a ribbon rather than the axis, 094c as
the roadmap** — the argument and its strongest counter are on the sketch index. Nothing of it is
built: the founder decides.

### The rework, 2026-09-03 — the docket, with the day strip as a ribbon

**What the founder decided.** Shown three shapes (sketch 094 a/b/c), the founder chose
**094b, the action docket, as the spine, and 094a's calendar strip above it as a selector
ribbon rather than the axis.** His words for the need, verbatim: *"we need everything in a
categorized classified section in order for people to understand what to do as action"*, and
*"a calendar strip that we can select and see that is highly advanced and elegant looking"*.
094c (the case ledger) stays the roadmap — §13.

**Why 094b won.** The page already carried two classifications, and the act was neither:

| axis | question it answers | where it lives |
|---|---|---|
| the register (`stakeOf`) | what acting on it would CHANGE | now the ordering inside a section, and the rail |
| the hand (`handOf`) | which SURFACE the work lands on | unchanged, on every entry |
| **the act** (`rec-docket.ts`) | **what the person DOES** | **the docket's sections** |

They disagree, and the disagreement is the argument. The Wednesday shortfall changes *money*
and is sent to `/reports`, but what a manager does with it is stand in front of the floor
before service; `staff_spread` changes *the floor* and is sent to `/team`, and it is the same
job. Filing by either older axis puts two identical jobs in two sections and one section's
worth of jobs in four. Nine entries collapse to five sittings.

**Retire-to-write.** This retires **the standing book's register-as-spine layout** — the page's
sections were `Money · Stock · Vendors · The floor · Unfiled` from the first pass to the fourth.
The register is not deleted: it is demoted to the in-section ordering and the cross-cutting
rail, which is what sketch 094b's own note proposed ("one spine, one cross-cut — not two
tables of contents").

**The act mapping, and its basis.** Each row was read off that rule's own `recommendation`
sentence in `recommendations.service.ts:150-372`, and the sentence fragment is carried in the
code and shown in the entry's working under "Why it is filed under …":

| rule | act | read from |
|---|---|---|
| `stockout_imminent` | Order it | "Place the order today — reorder point is N bottles" |
| `spend_acceleration` | Order it | "Audit open orders against days-of-cover before the next PO run" |
| `revenue_concentration` | Order it | "Protect the top sellers' stock first (raise their service level to 98%)" — buying deeper cover; its second half (pairing prompts) is a floor act, and the filing says so |
| `plowhorse_repricing` | Price it | "Raise those prices 5–8% or renegotiate cost on the next PO" |
| `pairing_promotion` | Price it | "Print that pairing on the menu insert" — a menu insert is a pricing decision, though its hand is Promotions. Judgement, stated |
| `weekday_gap` | Price it | "test a `<weakest day>`-only offer (corkage-free, flight special)"; its scheduling half is a calendar act the docket has no heading for |
| `dead_stock_capital` | Move stock | "Build a weekend flight or staff-pick feature from the top three idle wines" |
| `puzzle_activation` | Move stock | "Put one puzzle wine by-the-glass this week" |
| `vendor_concentration` | Call a vendor | "Request quotes from one alternative vendor … move 10–20% of volume" |
| `sales_below_weekday_baseline` | Brief the floor | "brief the floor on top-margin picks … pair your strongest server with the weakest section" — its hand is Reports, because the hand keys on the rule's *category* |
| `weekly_demand_slide` | Brief the floor | "Schedule a staff tasting … add a pairing prompt to the specials script" |
| `staff_spread` | Brief the floor | "Have the top seller run a 15-minute pre-shift on their pitch" |
| `goal_behind_<id>` | **Not yet filed** | "Pick the single biggest lever from the insight feed" — a choice, not an act |
| anything else | **Not yet filed** | a rule this page does not recognise is shown, never absorbed |

**The money a section is worth is withheld, in words.** Seven of the twelve rules state a
figure inside their sentence; none states one as a field. The figures are also not the same
quantity — `spend_acceleration`'s `$14,820` is spend, `dead_stock_capital`'s is capital locked
— so a column of them cannot be added. Every heading shows an em dash and the docket says why
once, above the sections. The founder was told this is the cost of the shape and chose it; a
section with one entry still carries its count and its money line. §9 files the fix.

**The ribbon, and what it cannot show.** It draws three things and refuses the rest:

- **first fired** — `firstSeenAt`, attached by the gateway from `recommendation_impressions`.
  It is **capped at forty rule keys** and **null for any rule with no impression row**; an
  entry with no first-fired date is on **no day of the strip**, and the page says how many are
  in that state rather than drawing them on today. Today is exactly the wrong answer.
- **falls due** — a goal's `deadline` and a snoozed entry's `snooze_until`. **Vendor cutoffs do
  not exist anywhere in the gateway**, so nothing draws one.
- **no records** — from the till window's sparse `dailySeries`, in four states (`yes` · `none` ·
  `unknown` · `future`), never as a zero. When `posConnected` is false, or the window could not
  be read, **nothing is hatched at all**: an absence of a POS is not an absence of trade.
  One measured limit stated on the page: if a connected till returns an empty series, the
  gateway's own `computeMetricWithSeries` swallows a query error into the same empty map
  (`goals.service.ts` — the `catch` logs and returns), so "the house was shut throughout" and
  "the till read failed" are indistinguishable. The page claims neither.
- **money per day** is money **through the till**, from the POS window. It is never shown as
  "money at stake", which the feed does not carry.

**`source_rule_key` — the provenance a goal now keeps.** Migration `20260903161000` adds one
nullable column to `analytics_goals`. Before it, the strongest true sentence the goal sheet
could show was "you already hold a goal on Wine revenue" — a match on `metric_key`, which
cannot tell two recommendations apart, and which left an entry that had ALREADY been turned
into a goal looking exactly like one that had not (an absence read as "nothing has been done",
ADR 0051). The gateway validates the key against a catalogue of the twelve `rule("…")` keys
plus `goal_behind_<uuid>` (`GoalsService.RECOMMENDATION_RULE_KEYS` / `isRecommendationRuleKey`)
and refuses an unknown one with words — deliberately **not** a CHECK constraint, because the
catalogue is code and a constraint would make adding a rule a migration. NULL means **set by
hand**, never "unknown", and the page never infers a watch from a shared metric.

**Verified, not asserted** (local gateway :4000, tenant `550e8400-…`, 2026-09-03):

| Checked | Result |
|---|---|
| `POST /analytics/goals/:rid` with `sourceRuleKey: "wine_sales_dive"` | **400** "Unknown recommendation rule 'wine_sales_dive'. A goal's source must be a rule the engine evaluates: …" |
| the same with a **suppression** key (`rule#subject#grain`) — the likeliest near-miss | **400**, same refusal |
| the same with `sourceRuleKey: "plowhorse_repricing"` | **400** "Could not find the 'source_rule_key' column of 'analytics_goals' in the schema cache" — the migration is not applied to this database, and migrations auto-apply on merge. The validator and the insert path are proven; the stored round-trip is **not yet measured against a real DB** |
| `GET /analytics/pos-revenue/:rid?days=22` | 200, `posConnected: true`, window `2026-08-13 → 2026-09-03`, **12 of 22 days** in `dailySeries` — ten days hatched, none drawn as a zero. Dated: the seed ends 2026-08-24 and the window rolls with today, so this count falls by one a day |
| `GET /analytics/exclusions/:rid` | 200 with `readable: false` ("Could not find the table 'public.analytics_day_exclusions' in the schema cache") — so the strip refuses to offer the strike and says why. The honesty branch is exercised live, not only in a test |
| `GET /analytics/recommendations/:rid` | 200, `rulesEvaluated: 15`, 3 standing (2 × `goal_behind_*`, 1 × `staff_spread`) → the docket renders **Brief the floor** and **Not yet filed** |

The tests were run against a mutated control (an absent day made a zero, an unrecognised rule
absorbed into the first heading, the money line made `$0`, the watched state matched on the
metric instead of the source): **8 of 117 fail** on it, in the three files that carry the new
claims.

### Fifth pass, 2026-09-04 — six headings became eight, and the strip left the page

Four decisions, all the founder's, all binding.

**1 · A sixth heading, "Schedule it", for calendar acts.** The founder named
`weekday_gap` and asked for a sweep of the rest. All twelve static rules were re-read
(`apps/api-gateway/src/analytics/recommendations.service.ts:150-330`) against one test —
*does the sentence's LEADING clause put a thing on a day?* Two pass, and the working is
on each entry:

| rule | verdict | the clause it was read from |
|---|---|---|
| `weekday_gap` | **Schedule it** (the founder's own call) | "Move staff training, deliveries, and inventory counts to `<worstDay>`" — three things put on a named day. Its second half is a day-only offer, which is why it used to sit under *Price it*. |
| `weekly_demand_slide` | **Schedule it** (the sweep's call, not the founder's — said so on the entry) | "**Schedule** a staff tasting on the two highest-margin slow movers this week". The verb is literally the heading. Its second half, a pairing prompt in the specials script, is a floor act and is named. |
| `staff_spread` | stays *Brief the floor* | "Have the top seller run a 15-minute pre-shift" — a pre-shift IS the briefing. Arranging one is not the act; delivering it is. |
| `puzzle_activation` | stays *Move stock* | "rotate weekly" is a cadence attached to an act of moving stock. |
| `dead_stock_capital` | stays *Move stock* | "if untouched after two weeks, discount to cost" is a review date attached to an act of moving stock. Real, named on the entry, and not the act. |
| `sales_below_weekday_baseline` | stays *Brief the floor* | "Tonight: brief the floor…" names a time; nothing in it goes on a day-book. |

Each entry there carries **Put it on the day-book** (`rec-daybook.ts`). It prints the
drafted line in full — title, date, type, note naming the rule — and then opens
`/calendar?new=<url-safe JSON>`. **What it claims, and what it still does not.** The
calendar reads that link since 2026-09-04: `readNewParam`
(`pages/calendar/next/CalendarNext.tsx:66-106`) validates every field and the create arm
of `SheetTarget` carries a `prefill` (`EventSheet.tsx:63-76`) that seeds title, type and
note (`:112-115,134`). So the copy now says the entry arrives *already filled in, for
you to check and save* — filled in, never *filed*: nothing is written until the manager
saves, and a type outside the gateway's enum is dropped rather than seeded. Second, the
date is the day the strip has
selected, or today — **not** the weekday named inside `weekday_gap`'s observation.
Reading "Tuesday" back out of "Friday is reliably your strongest day; Tuesday the
weakest" would be parsing a sentence written for a reader as if it were a field, which
is the move `rec-forward.ts` already refuses for targets. The entry says so.

The `eventType` is a member of the gateway's `CalendarEventType` (`calendar.dto.ts:44-59`).
`weekly_demand_slide` gets `tasting` because its sentence names exactly one calendar
object; `weekday_gap` gets `custom` because it names three (training, deliveries,
counts) and picking one would be this page choosing the manager's evening for them.

**2 · Goal-behind entries get "Goals slipping".** They were parked under *Not yet filed*
on the argument that "pick the single biggest lever" is a choice rather than an act. That
was a mis-filing: *not yet filed* means **this page does not recognise the rule**, and
this page recognises this family exactly. A heading whose meaning is "unknown to us"
cannot also hold the one family we understand best. `unfiled` is now reachable only by a
rule that did not exist when `rec-docket.ts` was written — asserted.

Each entry links to the goal's progress in the reports desk. **There is no query
parameter to address one goal**: re-grepped 2026-09-04, `apps/web/src/pages/reports/`
contains no `useSearchParams`, no `URLSearchParams` and no `location.search` — the sheet
reads nothing off the URL. So the link is `/reports?cutting=goals&goal=<id>&rec=<key>&from=recommendations`
(the ids ride along for the day the sheet learns to read them) and **the control names
the goal in words**, because that is how a person actually finds the row. The desk it
lands on is real: `rp-sheet.ts` `ANALYSIS_IDS` holds `goals`, `rp-registers-goals.tsx:456-460`
reads `GET /analytics/goals/:rid/progress`, and `goals` is on `DEFAULT_ON`, so it is
standing on an unarranged sheet. The per-goal route the founder named,
`GET /analytics/goals/:rid/:goalId/progress` (`analytics.controller.ts:583`), is what
that desk's *Ask the book* control calls per row.

The levers are not a list this page wrote. The rule says *"the insight feed for this
goal's category"* — and a goal row carries a `metric_type`, never a category. The join
exists in exactly one place, the gateway's `GoalsService.SUPPORTED_METRICS`
`insightCategories` (`analytics/goals.service.ts`), copied verbatim into
`rec-daybook.ts` `METRIC_CATEGORIES`. The levers are the standing entries in those
categories. When the goal list cannot be read, the section names **no** lever and says
why — "we could not look" and "there are none" are different facts.

**The refusal stays**: no goal is ever made from a goal. *Make this a goal* is dark on
these entries with `rec-forward.ts`'s own reason, and the slip block repeats it in words.

**3 · One shared day strip.** `components/mudavym/DayStrip.tsx` (+ `dayStripDates.ts`,
`day-strip.css`, `DayStrip.test.tsx`), extracted from this page's `rec-days.ts`/`Ribbon.tsx`
and `/notifications`'s `DayRail.tsx`. **Deleted:** `apps/web/src/pages/notifications/next/DayRail.tsx`
(152 lines) — its tests moved into `DayStrip.test.tsx` and the page's own
`NotificationsNext.test.tsx`. The measured cause for making it house-level: the two
strips had already drifted. This page's carried four record states, the hatched-not-zero
rule and a full keyboard map; the rail carried none of the three. Same object, two
contracts, one missing the rule the other exists to enforce.
`DESIGN-FOUNDATION.md` §3 item 4 is amended with the dated line.

What the strip owns: the month, the cells, the four states, the hatch, the strike, the
today ring, selection as a controlled prop, and the keyboard. What a page owns: the
marks inside a cell, the clause added to its title, and everything above and below.
**One rule a page cannot override** — `records` supplied for a day after `today` is
ignored and the cell is drawn `future`, because the one way this component fails is a
page deciding that tomorrow held nothing.

**4 · The window is a full calendar month.** Replacing 21-behind/7-ahead. A rolling
window has no name; nobody says "the last twenty-one days" to a colleague, and every
other record in the house is kept by month. The future half is drawn **empty, not
hatched**, and the cell's title says *"this day has not happened yet — that is neither a
record nor an absence"*.

**Width, measured in the live browser 2026-09-04** (`$SP/shoot-daystrip.mjs`, which
reads `getBoundingClientRect` off the rendered cells):

| viewport | `/recommendations` strip | cell | `/notifications` strip | cell |
|---|---|---|---|---|
| 1440 | 1088px | **33.9px** | 1132px | **35.4px** |
| 1280 | 988px | **30.6px** | 972px | **30.1px** |

Neither scrolls (`scrollWidth === clientWidth`), and the day number stays 11.5px at
both. The floor enforced is `--mdv-ds-min: 30px` (`day-strip.css`). Below it the strip
scrolls horizontally rather than shrinking the number.

**Corrected 2026-09-04** (`$SP/p4v-measure-floor.mjs`, same tenant and month): the floor
figure this section carried — *"about 1034px"* — was **derived, and wrong**. It counted
`.rc-wrap`'s 32px of padding but not the app's fixed **260px sidebar**
(`md:pl-[260px]`), which is what governs the line at every width under 1380. Measured by
walking the viewport down instead of deriving it, September (30 cells) scrolls on
`/recommendations` from **1260px down** — 1262px is the last width that does not — and
on `/notifications` from **1276px down** (1278px is the last). A 31-day month costs one
more cell and one more gap; that arithmetic — unmeasured, because September was on
screen — puts the two at about **1294px** and **1310px**. The
trade is unchanged: a legible 30px number behind a scrollbar beats an illegible 24px one
that fits.

Walking the month re-asks the till: `posDaysFor(month, today)` sends
`GET /analytics/pos-revenue/:rid?days=N` back to the 1st of the month on screen (the
gateway clamps N to 1–365, `analytics.controller.ts:792-795` — the clamp itself on
`:794`, inside `getPosRevenue` (`:788`, routed at `:773`); re-measured 2026-09-04, the
`:757-760` cited here before is the Wine-360 `@ApiOperation`), so a month more than a
year back comes back **entirely `unknown`, never `none`**. Selecting a day does not
survive a month change — a day selected in September is not a day in August.

**Verified in the live browser, 2026-09-04** (gateway :4000, web :5274, tenant
`Meyhouse Palo Alto`, captures in `$SP/shots-daystrip/`):

| Checked | Result |
|---|---|
| the strip on both pages, both grounds | 30 cells (September), month label "September 2026", month controls live |
| the hatch | `/recommendations`: **4 hatched** (Sep 1–4, the days the till window covers and holds nothing), **26 future**, 0 unknown, 0 with a record |
| the future half | 26 cells `data-records="future"`, drawn empty; title reads *"neither a record nor an absence"* |
| a day selected | *"Wednesday 2 September — 3 first fired · 0 falls due — no record at all on this day — not a zero, nothing was written"* |
| **Goals slipping, on live data** | two real `goal_behind_*` entries ("P3PROOF checks served", "P3PROOF average check"); the levers block named the gateway's own categories (*sales and tables* / *efficiency, staff and basket*) and listed `weekday_gap`, `weekly_demand_slide`, `staff_spread` |
| **Schedule it** | the live tenant fires **neither** calendar rule today, so it cannot appear in a live capture. Captured with the two rules injected into the `/analytics/recommendations/:rid` response (`$SP/shoot-daystrip2.mjs`), the strings copied verbatim from the gateway. **Filed as a fixture**, both grounds: `whole-book-recommendations-fixture-{paper,charcoal}.png` |
| `/notifications` | day 1 selected, cell title *"1 line on this screen, 1 still open — a record landed on this day"*; the note names the day filter as the reason every other day is blank |

### Overlays, 2026-09-05 (sketch 102 · ADR 0112)

<!-- sketch-102-overlays -->
Generated by `.planning/sketches/102-modal-census/build.py --docs` from `census.py` — edit the census, not this table.
The rule: an object gets a sheet, a question a panel, a choice a popover; the seal never sits in a popover.

**`/recommendations`** — The docket dismisses inline and schedules through a route. The old assignee picker is rebuilt as the popover drawn here — the fifth F4 act, confirmed by the founder 2026-09-06.

| Page | Overlay | Shape | Status | Where the act lives or went | Source |
|---|---|---|---|---|---|
| `/recommendations` | Who takes this? | popover | Owed · fork F4 | A choice from a short list, anchored to the entry's control. **Confirmed by the founder 2026-09-06**: the fifth F4 act is built like the other four — the docket keeps assignment, and the roster it reads is the team's. | `pages/Recommendations.tsx:980 — not on the rebuilt docket` |

Drawn in sketch 102 (`.planning/sketches/102-modal-census/index.html`); the policy is [[0112-one-modal-policy-three-shapes-one-primitive]].

## 2. Entry

**Not in the sidebar.** Entries are:

- Command palette "Recommendations" / "View recommendations"
  (`components/command/commands.ts:77,100`).
- Back-link from `/recommendations/catalog` ([PAGE_MAP](../foundation/PAGE_MAP.md):90).
- Outbound edges to `/recommendations/catalog` and `/reports` (PAGE_MAP:88-89).

## 3. Files

- Route binding: `apps/web/src/App.tsx:262` (lazy import :85).
- `apps/web/src/pages/Recommendations.tsx` (1,099 lines) — self-contained; only
  shared imports are Header, toasts, the team API and `apiClient` (:49-52).
- Mudavym redesign (flag `mudavym_design_recommendations`, gated by `PageGate` at
  `App.tsx:307`): `apps/web/src/pages/recommendations/next/` —
  `RecommendationsNext.tsx` (the book, register, leaves, keyboard),
  `Entry.tsx` (one ruled entry + the working), `useRecommendationsNextData.ts`
  (every read/write through `apiClient`), `rec-format.ts` (the three axes + the
  failure shape), `rec-next.css` (all styling — Mudavym tokens only, with the
  motion tokens written out at the bottom), **new (fourth pass)** `rec-forward.ts` (the
  rule → goal-metric and rule → reports-cutting maps, their bases and their refusals),
  **new (the rework)** `rec-docket.ts` (rule → act, with the sentence each filing was read
  from, and the withheld-money words), `rec-days.ts` (the ribbon's pure day model — the four
  record states, `touchesDay`, the bar heights) and `Ribbon.tsx` (the strip, its keyboard, its
  legend, the day panel and the exclusion control),
  `MOTIONS.md`, and five test files
  (**117 tests** after the rework: 61 render, 17 transport, 12 mapping, 18 days, 9 docket).
  3,384 lines of source + 1,399 of tests — well past
  the brief's ~900-line guideline, and disclosed rather than hidden: roughly a third of the
  source is the honesty prose (four real states per read, three failure sentences, the
  disclosure lines on every disabled control and every scope choice), and it is the part of
  the page the founder's review was about.
- Gateway, second pass (2026-09-03): **new** `analytics/insights/suppression.ts`
  (the key grammar) and `analytics/insights/day-exclusions.service.ts` (the engine's
  exclusion hook), plus edits to `insights/insight-generator.service.ts`,
  `insights/insight-verbalizer.ts`, `recommendations.service.ts`,
  `recommendation-actions.service.ts`, `analytics.controller.ts`, `analytics.module.ts`.
  Five gateway specs, **76 tests**: `insights/suppression.spec.ts` (23),
  `insights/baseline-honesty.spec.ts` (18), `insights/day-exclusions.service.spec.ts` (11),
  `recommendation-suppression.spec.ts` (15), `insights/insight-cache-version.spec.ts` (9).
  Migrations `supabase/migrations/20260903091000_days_the_engine_must_not_count.sql` and
  `20260903130000_insight_rows_carry_their_arithmetic.sql`.
- Gateway, the rework (2026-09-03): two **additive hunks in one file** —
  `analytics/goals.service.ts` gains `RECOMMENDATION_RULE_KEYS` / `GOAL_BEHIND_KEY` /
  `isRecommendationRuleKey`, a `sourceRuleKey?` field on `createGoal`'s input, its
  validation, and `source_rule_key` in the insert; plus one documentation line on the
  `@ApiOperation` of `POST goals/:restaurantId` in `analytics.controller.ts`. No other
  gateway file was touched (the reports builder was editing both files concurrently). One
  spec, **7 tests**: `analytics/goal-source-rule.spec.ts` — including a catalogue-parity
  test that reads `recommendations.service.ts` as text and fails when a rule is added or
  renamed without the list following it. Migration
  `supabase/migrations/20260903161000_a_goal_records_the_recommendation_it_came_from.sql`.
- Gateway, fourth pass: **none.** The goal write needs `{name, metricKey, targetValue,
  deadline, period, direction}` and `GoalsService.createGoal` already takes exactly those
  (`goals.service.ts` `createGoal`), so nothing in the goals module was edited and no
  migration was written. What the module *lacks* — provenance, and a metric read that can
  fail out loud — is filed in §9 and §13 rather than built.
- Sketches, fourth pass: `.planning/sketches/094-recommendations-directions-2/` —
  `index.html` (the fork, the recommendation and its counter-argument, the competitive
  sources), `calendar-strip.html`, `action-docket.html`, `case-ledger.html`. Screenshots
  only; nothing there is wired.

## 4. Endpoints

Raw `fetch` against `${VITE_API_GATEWAY_URL}/api/v1/analytics/recommendations`
(`Recommendations.tsx:54,155`). Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):10
(`analytics` — atlas's **⚠ unguarded** is stale; guarded at class level since
2026-08-24 (#31), `apps/api-gateway/src/analytics/analytics.controller.ts:51`),
:565 (`team`).

| Method | Path | Call site |
|---|---|---|
| GET | `/analytics/recommendations/:rid` | `Recommendations.tsx:196` |
| GET | `…/:rid/history`, `…/:rid/actions?status=` | `Recommendations.tsx:219` |
| GET/PUT | `…/:rid/digest` | `Recommendations.tsx:252,383` |
| POST | `…/:rid/action` | `Recommendations.tsx:263` |
| POST | `…/:rid/bulk-action` | `Recommendations.tsx:404` |
| GET | `/restaurants/:rid/team/members` | assignment picker, `Recommendations.tsx:346` → `services/api/team.ts:124` |
| GET | `/analytics/insights/:rid` | **not called by this page** — listed because it reads the same generator through the `analytics_insights` cache, and served the retracted sentence until `20260903130000`; `analytics.controller.ts:318` |
| GET | `/analytics/exclusions/:rid` | **new 2026-09-03** — the days ruled out of every baseline, with a `readable` flag; `useRecommendationsNextData.ts` tenant effect |
| POST | `/analytics/exclusions/:rid` | **new** — `{businessDate, reason}`; `excludeDay()` |
| DELETE | `/analytics/exclusions/:rid/:businessDate` | **new** — `includeDay()`, "Count it again" |
| GET | `/analytics/goals/:rid?status=active` | **new 2026-09-03; EAGER since the rework** — read once per tenant, because an entry has to say "this one is being watched" on first paint and the ribbon needs the deadlines; `analytics.controller.ts:485` |
| GET | `/analytics/pos-revenue/:rid?days=22` | **new (the rework)** — the ribbon's record marks. Its `dailySeries` is SPARSE (only days that carried a non-voided check), which is the one signal in the gateway that separates "shut" from "took nothing"; `posConnected:false` means nothing may be claimed about any day. `analytics.controller.ts:773` (re-measured 2026-09-04; the `:737` cited here before is the seasonality `@ApiOperation`) |
| POST | `/analytics/goals/:rid` | **new** — *Make this a goal*; body `{name, metricKey, targetValue, deadline, period, direction, sourceRuleKey}` — `sourceRuleKey` validated against the gateway's rule catalogue, an unknown key a 400 with words (curl-verified 2026-09-03) — and **no `createdBy`** (the controller passes the body through unfiltered at `:536`, so a client-supplied actor id would be an unverified claim); `analytics.controller.ts:524`, the pass-through on `:536` (re-measured 2026-09-04; the `:497`/`:508` cited here before are inside the `goal-scenarios` doc comment) |

**Endpoints researched for "see it in reports", and what each would give.** The founder asked which
endpoints this page can reach "to give them better insight". The reports sheet's eleven cuttings are
the shortlist, because each is already a rendered answer rather than a raw payload:
`/analytics/insights/:rid` (The reading) · `/analytics/pos-revenue/:rid` (Through the till) ·
`/analytics/cashflow/:rid` (Spend pacing) · `/analytics/seasonality/:rid` (The week's shape) ·
`/analytics/forecast/:rid` (What's coming) · `/analytics/menu-engineering/:rid` (Margin against
movement) · `/analytics/financial/:rid` (Figures of record) · `/analytics/table-performance/:rid`
(The room) · `/analytics/waiters/:rid` (Who served it) · `/analytics/inventory-science/:rid` (What to
buy back). Nine rules reach one of them. Three further endpoints exist and are **deliberately not
linked**: `/analytics/risk/:rid` (HHI/Gini — real, but no cutting draws it, so a link would land on a
sheet that cannot show it), `/analytics/goals/:rid/:goalId/progress` (real, and the natural target for
the `goal_behind_*` family — §13.19), and `POST /analytics/consult/:rid` (the toggle-gated LLM layer, which
this page will not send anyone to: the whole claim of `/recommendations` is that no model wrote its
sentences).

Same six read endpoints in the Mudavym build, all through `apiClient`, all keyed by
`activeRestaurantId`: `useRecommendationsNextData.ts` — feed and leaves in `load()`,
digest in the tenant effect, `…/action` in `setDisposition`/`restore`,
`…/bulk-action` in `bulk`, `getTeamMembers(rid)` in `loadTeam` (lazy, on first
assign). No endpoint outside this table is called, and no figure on the page comes
from anywhere else.

## 5. Signals

**None.** Dispositions (act/dismiss/snooze) are *server writes to the
`recommendation_actions` store* — operational state, not telemetry. No `uxSignals`,
no `data-ux-key` (reporter dark, `lib/uxSignals.ts:15`).

## 6. Tier cut

**Plus** — this is where "understand" becomes a to-do list; drafted-action rows in
S10/S02 Plus land here ([TIER-MAP](../03-scenarios/TIER-MAP.md):38,46). Rule-based
"optimize" proposals stop short of Pro's forecast-backed versions (TIER-MAP:84-90).

## 7. Rebrand surface

**0 user-visible strings** (no `wineops` hits in the file). Layout chrome per
dashboard.md §7.

## 8. State & config

- Tabs (active/history/dismissed/snoozed/done) fetch on demand (:219); digest
  frequency is a server-side setting via GET/PUT digest (:252,383).
- Legacy: no client flags or env gates beyond `VITE_API_GATEWAY_URL`.
- **Feature flag `mudavym_design_recommendations`** — registered ACTIVE, `defaultValue:
  false` (`apps/api-gateway/src/settings/feature-flag-registry.ts:155-159`), read by
  `useMudavymDesign` through `PageGate` (`App.tsx:325`). OFF ⇒ the legacy page renders
  byte-for-byte.
- **Per-browser override `mudavym.design.recommendations`** in `localStorage`
  (`1|true|on` forces the redesign, `0|false|off` forces legacy) — precedence over the
  flag, one machine only (`lib/mudavym/useMudavymDesign.ts:31-45`).
- Redesign client state (none of it persisted): leaf, register filter, expanded set,
  selection, keyboard cursor, and — second pass — the open dismissal sheet's reason, scope
  and exclusion checkbox, which reset to the default (the exact finding, no reason, no
  exclusion) every time the sheet opens rather than remembering the last choice; and — fourth pass —
  the open goal sheet's name, target, period and the gateway's last refusal, which likewise start
  from the derived defaults with an **empty** target every time it opens. Every
  query is keyed by `activeRestaurantId` and a sequence number, so a restaurant switch
  clears the previous tenant's entries before the new read lands (asserted in
  `useRecommendationsNextData.test.tsx`).
- **Two server stores back the page's standing state**, deliberately apart:
  `recommendation_actions` (a dismissal's scoped suppression key, plus snooze/done/pin/
  assign/feedback) and `analytics_day_exclusions` (business dates out of every baseline,
  migration `20260903091000`). Hiding a sentence and correcting an average are different
  acts; merging them would make "was this baseline computed over an excluded day?"
  unanswerable later.

## 9. Gaps

- `v3.0-TECH-DEBT.md:493` — the UX-catalog line "Recommendations entirely read-only"
  is **stale**; actions shipped (`recommendation-actions.service.ts`, migration
  `20260720120000`). Do not rebuild from the catalog.
- The page is reachable only through the command palette or the catalog (§2) — a
  primary actionable surface with no sidebar presence; undecided, not accidental as
  far as any record shows (no ADR either way). **The Mudavym build does not add a nav
  entry** — that is a founder decision, not a page-agent one (§13.4); the redesign is
  reached the same two ways, plus the per-browser override in §8.

**Filed 2026-09-04, with the fifth pass (§1b), and why each is not yet closed:**

- ~~**The calendar cannot be prefilled from a link.**~~ **CLOSED 2026-09-04.** The
  calendar reads `?new=` (`CalendarNext.tsx:66-106`, consumed at `:233-250`) and seeds
  the create sheet through `SheetTarget.prefill` (`EventSheet.tsx:63-76,112-115,134`),
  with six tests in `CalendarNext.test.tsx`. `DAYBOOK_LANDING` changed with it, as the
  patch said it would. What is still open is narrower and is filed under `calendar.md`
  §9: the hand-over carries title, type and note only — no time, vendor, repeat or
  reminder — because this page has no measured value for any of them.
- **`/reports` reads nothing off the URL.** No `useSearchParams`, no `URLSearchParams`,
  no `location.search` anywhere under `apps/web/src/pages/reports/` (re-grepped
  2026-09-04). Both forward doors — the cutting link and now the goal link — therefore
  name their destination in words instead of scrolling to it. *Why not yet:* same
  reason; the reports desk is being edited by its own builder, and the ids already ride
  in the query for the day it reads them.
- **The day-book draft cannot name the day the rule means.** `weekday_gap` states the
  weakest weekday inside its observation sentence and nowhere else — there is no
  `subject` on that rule. *Why not:* this is a refusal, not a gap. Parsing a weekday out
  of a sentence the gateway can reword would be the same class of error as scraping a
  target out of prose, and the entry says which day it will actually open on.
- **A month more than 365 days back cannot be read at all.** The till window is
  `?days=N` counting back from today, clamped to 365. Every day of such a month comes
  back `unknown`, never `none` — correct, and a real limit on how far the strip is
  worth walking. *Why not yet:* closing it needs a from/to window on
  `GET /analytics/pos-revenue/:rid`, which is a gateway change outside this pass.
- **`/notifications` can only hatch what its loaded pages cover.** The strip's negative
  claim there rests on the register being read newest-first and contiguously
  (`notifications.service.ts:824`), so a day older than the oldest loaded row is
  `unknown`, and every day but one is `unknown` while a day filter is on. Said on the
  page. *Why not yet:* a real per-day count would need a `GET /notifications/counts`
  the gateway does not have.

Outside the page's own paths, and therefore filed rather than built (2026-09-02):

- **The digest has no sender.** `recommendation_digest_prefs` is written by
  `analytics.controller.ts:908` and read back by `:898`; grepping the whole repo for
  the table finds only that service, the two migrations and planning docs — no
  scheduler, no job, no mail. `last_sent_at` is never written. The redesign renders the
  digest control disabled with that reason; the fix belongs in
  `apps/api-gateway/src/analytics/insights/insight-scheduler.service.ts` (or a sibling)
  and is §13.6.
- ~~**Nothing records when a rule first fired**~~ **Closed 2026-09-03.** The feed now
  attaches `firstSeenAt` per rule from `recommendation_impressions`
  (`recommendations.service.ts` `attachFirstSeen`), and the page renders it with the clock
  it came from. Implementation note: a `min()` aggregate is NOT available — PostgREST on
  this project answers `select=rule_key,created_at.min()` with `PGRST123 "Use of aggregate
  functions is not allowed"` (measured 2026-09-03 against the live REST endpoint), so it is
  one indexed `order(shown_at).limit(1)` per visible key, capped at 40 keys; anything past
  the cap stays an em dash rather than becoming a guess.
- **No autonomous execution exists** for any recommendation anywhere in the gateway;
  the product's only autonomy switch, `enable_ai_autonomous_send`, belongs to vendor
  email (`feature-flag-registry.ts:64`). The redesign says so on every entry rather
  than implying a capability. §13.8.
- ~~**A retracted sentence could still be served from the insight cache.**~~ **Closed
  2026-09-03** by `INSIGHT_GENERATOR_VERSION` + migration `20260903130000` (§1b "The cache was
  still serving it"). What remains as a standing obligation, not a defect: **the constant has to
  be bumped by hand** whenever the arithmetic changes what a sentence claims. Nothing enforces
  that — a future generator change that forgets the bump reintroduces exactly this bug, silently.
  The guard that would close it (a test that fails when `insight-verbalizer.ts` or
  `timeSeriesInsights` changes without a version bump) is not built. §13.17.
- **The exclusion store and the version column are both absent from the database until this
  branch merges**, so today the exclusion checkbox renders disabled with its reason, and every
  insight read recomputes instead of using the cache (`getStored()` refuses rows it cannot
  version). Both are the conservative failure and both are said out loud; neither is silent.
- **The rule-wide silences are not visible in Settings.** The founder asked for them to
  appear there "if a settings hook is trivial, else file it" — it is not trivial from this
  page's paths (`apps/web/src/pages/settings/next/` belongs to another builder this wave and
  has no analytics section), so it is filed: a Settings panel listing every stored
  suppression key with its scope in words and a Return control, reading
  `GET /analytics/recommendations/:rid/actions?status=dismissed`. Everything it needs
  already exists; only the panel does not. §13.14.
- **Per-wine demand series still count every calendar day.** The observed-day distinction
  was applied to the three series that feed sentences (revenue, bottles, purchasing spend);
  `demandProfile` in `computeInventoryFamily` still receives a dense per-wine series with
  zeros for closures. It feeds a stockout probability, not a percentage claim, so it does
  not misstate — but it is inconsistent, and worth a second pass. §13.15.
- **Resolved 2026-09-02 — `scripts/check_no_seeded_defaults.py` `SCAN_ROOTS` carries
  `apps/web/src/pages/recommendations/next`** (`check_no_seeded_defaults.py:201`); the
  2026-09-03 audit re-ran the guard and it passes across 19 roots. When the root was first
  added it caught a `{ id, label, days }` snooze list under S1, which is why that list keys
  its duration as `value`. §13.9.
Found by the fourth pass (2026-09-03), all outside this page's paths:

- **A goal made from a recommendation cannot be linked back to it.** `analytics_goals` has
  `id · restaurant_id · name · metric_key · target_value · baseline_value · current_value ·
  direction · period · deadline · status · created_by · created_at · updated_at`
  (`supabase/migrations/20260805000000_baseline_from_production.sql:2157-2172`) and no column
  records provenance. So the goal sheet can truthfully say *"you already hold a live goal on Wine
  revenue"* — a match on `metric_key`, which it states — and can never say *"this entry is already a
  goal"*. One nullable `source_rule_key text` closes it; it is a migration and this pass was not
  granted one. §13.19.
- **The reports page does not read `?cutting=`.** Grepped 2026-09-03: no `useSearchParams` and no
  `URLSearchParams` anywhere under `apps/web/src/pages/reports/`, legacy or rebuilt. The link this
  page mints therefore opens the sheet and names the cutting in words rather than scrolling to it or
  adding it. Two of the nine mapped cuttings (`restock`, `service`) are not even on an unarranged
  sheet, so "add it while arranging" is said out loud. §13.18.
- **A recommendation carries no structured money.** Every rule that has a figure formats it *into*
  its sentence (`recommendations.service.ts` — `$${Math.round(...).toLocaleString()}` and friends),
  so nothing can total a column of "money at stake", which is what the action-docket direction's
  section headings want. A `moneyAtStake: number | null` on the recommendation would close it and
  change nothing else; without it the headings can show a count and an em dash. §13.20.
- **There is no act mapping.** `handOf` (`rec-format.ts`) routes by the rule's *category*, so
  `sales_below_weekday_baseline` — whose prescription is "brief the floor" — is sent to `/reports`.
  A docket filed by the act needs its own nine-row map, one word each. §13.20.
- **No rule can be tuned anywhere in the product.** The thresholds are literals inside
  `recommendations.service.ts`; the only feedback the engine takes from a manager is a dismissal,
  which silences a finding rather than moving a threshold. The founder's fifth docket heading,
  *change a rule*, has nothing behind it and is drawn dark in the sketch. §13.21.
- **`GoalsService.computeMetricWithSeries` swallows its own failure.** A thrown query is caught,
  logged at warn, and the method returns `current: 0` (`goals.service.ts` — the `catch (err: any)`
  around the metric block), so a goal's `baseline_value` and `current_value` can be a measured zero
  or an unread table and nothing downstream can tell them apart. This page does not read those
  fields, but goal progress does, and it is the same "absence reported as a measurement" shape the
  second pass removed from the insight generator. Filed, not fixed: it is the goals module's, and
  this pass only writes goals. §13.22.

- **The legacy page keys its path param on `user.restaurantId`**
  (`Recommendations.tsx:153`) while every other tenant signal — the re-issued JWT and
  the `X-Restaurant-Id` header — follows `activeRestaurantId`
  (`AuthContext.tsx:425-441`, which never updates `user.restaurantId`). After a
  restaurant switch those two disagree. The Mudavym build uses `activeRestaurantId`
  throughout; the legacy page is untouched by this wave. §13.10.

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** none found — "12 rules evaluated · 1 active" matched `GET /analytics/recommendations/:id` exactly; the 11 rules that produced nothing rendered nothing.

## 10. Maturity

**partial** (moved from **broken** on 2026-09-02, ADR 0044 p4 wave). The transport
defect this section was written about is **fixed twice over**, and neither fix is a
promise — both are in the tree:

| What changed | Evidence |
|---|---|
| **The legacy page's six raw `fetch` calls became `apiClient` calls** in commit `58113e26` ("fix: security holes, the honesty sweep, and 46 page dossiers", #70, 2026-08-26) — the same sweep that filed this dossier. The evidence table below is therefore **stale as of that commit**, and is kept for the record, not as a live defect. | `git show 58113e26 -- apps/web/src/pages/Recommendations.tsx`; today the calls are at `Recommendations.tsx:195,217,252,262,382,401`, and grepping the file for `fetch(` returns **no hits** |
| **The Mudavym rebuild is authenticated by construction** and, unlike the legacy fix, is **held there by a test**: `useRecommendationsNextData.test.tsx` asserts the feed read goes through `apiClient` with the tenant id in the path and that `fetch` is never called. That closes §13.2, which asked for exactly this. | `apps/web/src/pages/recommendations/next/useRecommendationsNextData.test.tsx` |
| **401 is now a distinguishable fact** — "your session has expired" vs 403 "not allowed" vs everything else — closing §13.3. | `rec-format.ts` `failureOf`/`failureSentence`; asserted in `RecommendationsNext.test.tsx` |

**Why not `complete`.** Three capabilities the page appears to offer do not exist
behind it: the daily digest stores a preference nothing sends (§9), no entry can be
carried out by the platform itself (§9), and how long an entry has stood is not
recorded anywhere readable (§9). The feed also stays short without a POS (§11), and
still emits no UX signals (§5). The redesign renders all three absences in words rather
than papering over them, which is what moves the verdict to *partial* rather than
*complete*.

### The original evidence (2026-08-26, kept for the record — fixed by `58113e26`)

| Evidence | `path:line` |
|---|---|
| **Six raw `fetch` calls, zero `Authorization` headers.** The only header set anywhere in the file is `content-type: application/json` on the three POST/PUT bodies. | `Recommendations.tsx:196,219,252,263-265,383-385,404-406`; grep for `Authorization` in the file → **no hits** |
| **The target controller is class-guarded.** `AnalyticsController` gained `@UseGuards(JwtAuthGuard)` at class level on 2026-08-24 (#31) — the comment explains it was unauthenticated by omission and `POST /consult/:id` spends money. | `analytics.controller.ts:44-51` |
| **The guard accepts a bearer header only** — `ExtractJwt.fromAuthHeaderAsBearerToken()`, no cookie extractor. A `fetch` without the header cannot authenticate, and cross-origin cookies would not be sent anyway (no `credentials: 'include'`). | `auth/strategies/jwt.strategy.ts:11`; guard `auth/guards/jwt-auth.guard.ts:31-45` |
| **The dev bypass does not rescue it** either: it requires non-production, `DEV_AUTH_BYPASS=true`, localhost, *and* an `X-Dev-Bypass` secret header these fetches never send. So the page is broken in every environment. | `auth/dev-bypass.util.ts:16-45` |
| **Result:** `loadActive` throws `Request failed (401)` and the page renders its error state. Every action (act / dismiss / snooze / done / pin / assign / bulk / digest) 401s identically. | `Recommendations.tsx:193-199` (`if (!res.ok) throw new Error(\`Request failed (${res.status})\`)`) |
| **The backend it cannot reach is complete.** `RecommendationsService` is a deterministic, auditable rule engine (no LLM) merged with the `recommendation_actions` disposition store; the hourly `insight-scheduler` sweep keeps its inputs fresh. None of that is the defect. | `analytics/recommendations.service.ts:35-56`; `analytics/recommendation-actions.service.ts`; `analytics/insights/insight-scheduler.service.ts:42` |
| The fix is one import away — sibling pages use `apiClient`, whose request interceptor stamps `Authorization: Bearer` and `X-Restaurant-Id` synchronously. | `services/api/client.ts:58-73` |

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** the active recommendation (Acılı Muhammara + Köpoğlu, lift 2.24) is grounded in real `wine_consumption_log` co-occurrence from the night's 44 checks — a genuinely healthy surface.

## 11. Data flow

### Calls out

Corrected 2026-09-02: every row below now sends the bearer — the legacy page through
`apiClient` since `58113e26`, the Mudavym build by construction (§10). Controller
line numbers are the decorators as they stand today — **re-measured 2026-09-04**, when
every number in this table was found to be stale by 105 lines (167 for the two digest
rows) because the controller grew above them.

| Method · Path | Auth **sent** | Auth **required** | Gateway controller | Returns |
|---|---|---|---|---|
| GET `/analytics/recommendations/:rid` | ✅ via `apiClient` | JWT (class) | `analytics.controller.ts:833` → `recommendations.service.ts:87` | ranked rule hits with observation / action / rationale, merged with dispositions |
| GET `…/:rid/history`, `…/:rid/actions?status=` | ✅ | JWT | `:984`, `:962` | leaf contents (dismissed / snoozed / done / history) |
| GET/PUT `…/:rid/digest` | ✅ | JWT | `:1061`, `:1069` | digest preference — **stored, never sent** (§9) |
| POST `…/:rid/action` | ✅ | JWT | `:859` | act/dismiss/snooze/done/pin/assign/feedback write |
| POST `…/:rid/bulk-action` | ✅ | JWT | `:913` | bulk write |
| GET `/restaurants/:rid/team/members` | ✅ via `apiClient` | JWT | `team` module (`services/api/team.ts:124`) | assignment picker — the one call that always worked, which is why the assign menu populated on a page where nothing else did |

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| Rule inputs | hourly `@Cron(EVERY_HOUR)` insight sweep across all restaurants and 11 categories, honouring `analytics_insight_prefs` | `analytics/insights/insight-scheduler.service.ts:42-70` |
| Metrics behind the rules | `AnalyticsService` / `AdvancedAnalyticsService` over `pos_checks`, `wine_consumption_log`, `restaurant_inventory`, `procurement_orders` | `analytics/analytics.service.ts:18,133-138`; `advanced-analytics.service.ts:86` |
| Goal-pace rules | `GoalsService` | `analytics/goals.service.ts:312` |
| Dispositions | this page's own writes plus `ContextualInsights` on [[orders]]/[[inventory]] — both authenticated through `apiClient` today (`ContextualInsights.tsx:28,120,123,201,224`) | `analytics/recommendation-actions.service.ts` |

The producers are healthy and running, and **the transport is no longer the defect**
(§10 — the 2026-08-26 sweep fixed it, and the Mudavym build has a test holding it).
What survives is the second-order effect: many rules need `pos_checks`, so a restaurant
without a POS sees a much shorter list than the catalogue implies (see
[[recommendations-catalog]] §10). The redesign answers that by printing the
denominator — "17 rules were read. 4 entries stand" — so a thin feed is legible as
*rules that did not fire* rather than as a page with nothing to say.

### Writes

| Write | Lands in | Downstream reacts |
|---|---|---|
| Act / dismiss / snooze / done / pin | `recommendation_actions` (migration `20260720120000`) | the card's disposition on this page **and** the hidden/pinned set that `ContextualInsights` applies on [[orders]] and [[inventory]] (`ContextualInsights.tsx:125-138`) |
| Assign to a teammate | `recommendation_actions.assigned_to` | assignee's view |
| Digest frequency | `recommendation_digest_prefs` | 🚧 **nothing** — no scheduler reads the table and no mail is sent (§9) |

**All of these land today.** The 2026-08-26 note that "all of these are 401" is
superseded: the writes reach `recommendation_actions`, and the only write with no
consumer is the digest preference.

## 12. Design intent

**Gaps the rework opened or could not close (2026-09-03):**

- **A section cannot be totalled.** `recommendations.service.ts` puts each entry's money
  inside its `observation` sentence, formatted for reading. There is no `moneyAtStake` field,
  and the figures are not one quantity: `spend_acceleration` states 30-day spend,
  `dead_stock_capital` states capital locked, `stockout_imminent` states none. The docket's
  headings therefore show an em dash. **Why not yet:** the fix is a gateway field on a service
  this pass was not scoped to edit (§13.20), and inventing the number page-side by parsing the
  sentence is the fabrication ADR 0020 forbids.
- **The ribbon's "no records" inherits one gateway ambiguity.** `getPosRevenueWindow` returns a
  sparse `dailySeries`, which is exactly the signal the strip needs — but the query that builds
  it, `GoalsService.computeMetricWithSeries`, wraps its read in a `catch` that logs a warning
  and returns an empty map. So a connected till whose query FAILED and a house that was shut
  for the whole window produce the same payload. The page refuses to choose: when a connected
  till returns an empty series it says both are possible and claims neither. **Why not yet:**
  the repair is in `goals.service.ts`, one module over, and belongs with §13.22, which names
  the same `catch` for the goal-baseline half.
- **A goal's deadline can never be edited.** The ribbon draws goal deadlines, and the entry
  states the deadline before the write, because the only post-creation goal write in the
  gateway is `PUT …/status` — nothing moves a date. (The reports builder is adding an edit path
  in the same wave; if it lands, the ribbon's due marks become editable objects and this line
  should be retired.)
- **`firstSeenAt` is capped at forty rule keys** (`recommendations.service.ts` `attachFirstSeen`)
  and is null for any rule with no impression row, so the ribbon cannot place every entry on a
  day. The page states the count of entries in that state rather than drawing them on today.
- **No vendor cutoff exists anywhere in the gateway**, so "falls due" is only ever a goal
  deadline or a snooze wake. Sketch 094a drew a third source; nothing backs it.
- **`analytics_day_exclusions` was unreadable on the local database** on 2026-09-03
  ("Could not find the table … in the schema cache"), so the strip's strike control renders
  refused with the reason. That is a database-provisioning gap, not a page gap — but it is the
  state a reader of the captures will see.

**Should be:** the to-do list a manager works down before service — each row a
deterministic rule that fired, with the number, the action, and why the action follows.
Auditable, never an LLM.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ | legacy `setLoading(true)` in `loadActive` (`:192`); redesign: static ruled ghost rows and "Reading the standing book…" — never a shimmer that could be mistaken for an unknown |
| empty | ✅ | legacy: dedicated empty state routing to [[reports]] (§0). Redesign: the denominator sentence ("17 rules were read, and none of them stands") plus why the book may be short, and the catalogue link |
| error | ✅ | legacy `setError` is populated and rendered (`:168,193-199`). Redesign: the failure is a sentence naming the register that could not be read, plus a retry — never an empty list |
| permission-denied | ❌ legacy · ✅ redesign | legacy: 401 renders as a generic "Request failed (401)". Redesign: 401 → "Your session has expired — sign in again and the standing book will read", 403 → "This account is not allowed to read the standing book", anything else → "could not be read (…) — this is not an empty book", each with a retry (`rec-format.ts:failureSentence`) |

**Where the UI misleads (2026-08-26, and what is left of it).** The original entry here
read: *"it does not, much — it fails loudly… the misleading part is upstream of the
user: a page that reports as shipped… and that has been non-functional since the guard
landed two days after the actions shipped."* The transport half of that is settled
(§10). What is left is one live misleading control and it is in the LEGACY page only:
the digest toggle says *"Daily digest on — top actions to your inbox"*
(`Recommendations.tsx:385`) when nothing sends a digest (§9). The Mudavym build renders
that control disabled with the reason, and marks the two other absences — no autonomous
execution, no first-fired timestamp — in the same way.

## 13. Roadmap

1. ~~**Replace all six raw `fetch` calls with `apiClient`.**~~ **Done** in `58113e26`
   (2026-08-26) for the legacy page; the Mudavym build never had them (§10).
2. ~~**Add a regression test that a page's analytics call carries a bearer token.**~~
   **Done for this page** — `useRecommendationsNextData.test.tsx` asserts the read goes
   through `apiClient` and that `fetch` is never called. *Still open as a class:*
   nothing generalises this to the next page a guard breaks. A repo-wide check ("no
   `fetch(` under `apps/web/src/pages/**`") is the shape that would, and is not built.
3. ~~Distinguish 401 from other errors in the UI.~~ **Done in the redesign** (§12);
   the legacy page still says "Request failed (401)".
4. **Decide whether this page belongs in the sidebar** (§9). It is a primary actionable
   surface reachable only via the command palette. *Blocker: founder decision — no ADR
   exists either way; add to `OPEN-DECISIONS.md`.* The redesign deliberately adds no
   nav entry.
5. ~~**Teach the calendar to read `?new=`.**~~ **DONE 2026-09-04** by the calendar
   builder, as specified: `prefill` on `SheetTarget`'s create arm, seeded into
   `EventSheet`'s `title` / `typeName` / `description`, parsed by `readNewParam` in
   `CalendarNext`'s existing deep-link effect. `DAYBOOK_LANDING` was the one string
   that changed here.
6. Correct the stale `v3.0-TECH-DEBT.md:493` line ("Recommendations entirely read-only")
   — actions shipped; the page's real problem was auth, and that is now fixed.
7. **Build the digest sender, or retire the preference.** `recommendation_digest_prefs`
   is written and read by nothing else (§9); the redesign shows the control disabled
   with that reason. Either a job in
   `analytics/insights/insight-scheduler.service.ts` reads `digest_enabled` /
   `digest_hour` / `digest_min_urgency` and sends (writing `last_sent_at`), or the
   endpoints and the table go. *Blocker: founder call on whether the product mails.*
8. ~~**Expose first-fired time so "standing" stops being an em dash.**~~ **Done
   2026-09-03** — `attachFirstSeen` in `recommendations.service.ts`, rendered by
   `standingOf()` with the clock it read named on the row (§1b second pass).
9. **Decide whether the platform may ever act on a recommendation itself** — the
   founder's own third axis, and today the honest answer on every entry is "not built"
   (§9). It is an ADR, not a ticket: what may be done unattended, under whose
   permission, with what audit trail. `enable_ai_autonomous_send` is the precedent for
   the shape of the switch.
10. **Add `apps/web/src/pages/recommendations/next` to `SCAN_ROOTS` in
   `scripts/check_no_seeded_defaults.py`** (§9) — measured to pass with it added.
11. **Point the legacy page's path param at `activeRestaurantId`**
    (`Recommendations.tsx:153`) so it agrees with the JWT and the `X-Restaurant-Id`
    header after a restaurant switch (§9).
12. Emit signals — dispositions are operational state, but *which rules get dismissed*
    is the highest-value UX signal in the product and nothing records it (§5). The
    impressions log now covers what was *shown*; what is missing is the reporter.
13. **Give the page a way to mint a link.** It reads `?insight=<ruleKey>` but has no
    `Copy link` control, so the deep links it honours can only come from elsewhere.
14. If the book ever grows past a screen, restore search / sort / category filters
    (§1b names them as deliberately dropped) — they are cheap, and the register alone
    stops scaling somewhere around twenty entries.
15. **Show the standing silences in Settings** (§9). A panel listing every stored
    suppression key with its scope in words and a Return control — the founder asked for it
    if the hook were trivial; it is not, from this page's paths.
16. **Apply the observed-day distinction to the per-wine demand series** (§9), so a closure
    stops counting as zero demand for a stockout probability the way it used to count as
    zero revenue for a baseline.
17. **Make the generator version un-forgettable.** `INSIGHT_GENERATOR_VERSION`
    (`insight-generator.service.ts`) is bumped by hand; a change to the arithmetic that forgets
    it reintroduces the retracted-sentence bug with no symptom. The shape that would close it is
    a checksum test over the files that decide what a sentence claims
    (`insight-verbalizer.ts`, `timeSeriesInsights`, `engine/comparisons.ts`) that fails until the
    constant moves. §9.
18. **Two directions drawn out for the founder's choice** —
    `.planning/sketches/090-recommendations-directions/`: `run-sheet.html` (banded
    Tonight / This week / This month, register demoted to a filter strip) and
    `two-pane-docket.html` (register · list · the working pinned open). Both carry the new
    dismissal dialogue so its weight can be judged in place. The shipped build is neither;
    the fork is the founder's.
19. **Make the reports sheet read `?cutting=<id>`** (§9). *See it in reports* mints
    `/reports?cutting=…&rec=…&from=recommendations`; the reports page reads no query parameter at
    all, so the link opens the sheet and the entry says the cutting's name instead of landing on it.
    The honest full version also *adds* the cutting when it is not on the reader's sheet — which is a
    write to another page's stored arrangement (`reportsSheet` in user preferences), and therefore a
    founder's call before it is a ticket. **Extended 2026-09-04:** the *Goals slipping*
    heading mints `/reports?cutting=goals&goal=<id>&rec=<key>&from=recommendations` for
    the same unread query, so the same one change would land both doors. Owned by the
    reports builder.
20. ~~**Give a goal its provenance.**~~ **Done 2026-09-03** — `analytics_goals.source_rule_key`,
    migration `20260903161000`, validated in `GoalsService.createGoal` against the rule catalogue;
    the entry now says "this entry is being watched — goal X, due …" (§1b rework). *Still open:*
    the `goal_behind_*` family should link to `GET /analytics/goals/:rid/:goalId/progress` rather
    than refusing both doors — it is the one rule family whose deep link is a goal, not a cutting,
    and it is also the family the docket has to file as **Not yet filed**. *Also still open:* the
    column is not yet applied to any database — the write was measured 400ing on the schema cache
    locally, and applies on merge.
21. **Return a structured `moneyAtStake` on each recommendation** (§9) — the one field the docket
    still needs and cannot compute. Additive on `recommendations.service.ts`; it changes no
    sentence. The *act key*, the other half of this item, is now built page-side in
    `rec-docket.ts` rather than in the gateway, deliberately: the act is a reading of the rule's
    prescription for a human, not a property of the rule's arithmetic, and a page that files by it
    should be able to change its mind without a deploy. If a second surface ever needs the same
    filing, that judgement is worth revisiting.
22. **Decide whether a rule can be retuned, and by whom** (§9). The dismissal reasons are already a
    taxonomy and nothing reads them as one. DESIGN-FOUNDATION §6 rates this need-it-now for this
    page; it is an ADR (what may be tuned, under whose hand, with what threshold history), not a
    ticket.
23. **Make `GoalsService.computeMetricWithSeries` distinguish a measured zero from an unread table**
    (§9) — the same fault the second pass removed from `toDaily`, still live one module over. A goal
    whose baseline could not be read should say so, not report 0.
24. ~~**Sketch set 094 is the shape fork.**~~ **Decided and built 2026-09-03** — the founder chose
    **094b (the action docket) as the spine with 094a (the calendar strip) above it as a selector
    ribbon**; both are shipped behind the flag (§1b "The rework"). The register-as-spine layout is
    retired. **094c (the case ledger) remains the roadmap:** opened → acted → watching → closed,
    with *refused* as a state that keeps its reason. `source_rule_key` was its first prerequisite
    and is now in place; what it still needs is a stored `acted_at`-to-outcome link and a way to
    close a case with a result rather than only with a seal.
25. **Let the ribbon draw a range, and a lineage hairline.** Sketch 094a drew shift-click for a
    range (Fri to Sun) and a hairline from an entry back to the day it was first shown. Neither is
    built: the range needs the docket's filter to take an interval rather than a day, and the
    hairline needs per-entry hover state on a strip that is deliberately a plain selector. Both are
    cheap and neither is load-bearing; they were left out to keep the ribbon a selector rather than
    a second page.
26. ~~**Decide whether the day strip belongs on other pages.**~~ **Decided 2026-09-04**
    — one shared `components/mudavym/DayStrip.tsx`, rendered by `/recommendations` and
    `/notifications`; `pages/notifications/next/DayRail.tsx` deleted. The page brief's
    one-directory rule is amended in `DESIGN-FOUNDATION.md` §3 item 4. *Still open as a
    class:* nothing decides which of the remaining 45 page notes should adopt it, and
    nothing stops a third page growing its own again — a guard ("no `data-testid` ending
    `-day` outside `components/mudavym`") is the shape that would, and is not built.
27. **Give the till window a from/to.** `GET /analytics/pos-revenue/:rid` takes `?days=N`
    counting back from today, clamped 1–365, so the strip cannot read a month more than a
    year back at all — every day of it is `unknown`, correctly and uselessly. A
    `from`/`to` pair on that route would close it. Gateway change, outside this pass.
28. **Give `/notifications` a per-day count from the register.** The strip there can only
    hatch what its loaded pages cover, because there is no `GET /notifications/counts`;
    a day older than the oldest loaded row is `unknown`, and while a day filter is on
    every other day is. Said on the page; closing it is a gateway route.

29. **The eleven scenarios this page can offer but not hold** (ADR 0120;
    twelve until `days_of_inventory` was funded on 2026-09-04 — it is now the
    seventh goal metric, so *Hold fewer days of stock* is selectable here and
    `METRICS`/`UNIT_SUFFIX` in `rec-forward.ts` and `METRIC_CATEGORIES` in
    `rec-daybook.ts` carry it; the daybook's parity test caught that copy the
    moment the gateway grew the metric, which is what it is for). The
    book lists them greyed, each naming the measure it would take, so the gap is
    visible on the sheet rather than only in a note: prime cost, food-cost
    ratio, labour ratio, pour cost, waste, table turns, RevPASH, vendor
    concentration, on-time delivery, cash days, staff turnover. Two of
    them already have a rule on this page that fires about them —
    `vendor_concentration` and `staff_spread` — so the entry can name the
    problem and the sheet cannot hold a goal on it, which is the sharpest
    version of the gap. Closing order and the measured state of each is in
    `reports.md` §13.22.
30. **A scenario chosen here cannot record that it came from this entry.**
    Dropping `source_rule_key` on a swap is honest but lossy: the goal keeps no
    trace of the recommendation that started it. A second column
    (`origin_rule_key`, "where the conversation started", distinct from "what
    this goal watches") would keep both facts. New column, new decision — filed,
    not built.
31. **A thirteenth rule is planned and not built: `commodity_exposure_rising`**
    (2026-09-05). The founder's call — *"a seperate table for index series"*, and
    *"triggers of a uprise might give our assistant to alert owners to stock up"* —
    is researched and planned in
    [`.planning/07-reference/commodity-signals-plan.md`](../07-reference/commodity-signals-plan.md).
    It would sit in this service's `rule(key, fired, make)` loop beside the twelve
    that exist today, with a producer beside the eight in
    `notifications/producers/`, modelled on `market-signal.ts`. **Three findings
    from that plan land on this page and are the reason it is not a ticket.**
    (a) `market-signal.ts`'s shape — one global constant, one env override
    (`DEFAULT_DROP_THRESHOLD = 0.1`, `MARKET_SIGNAL_DROP_PCT`) — **does not
    generalise to an index series.** Backtested on 2026-09-05 over three real
    series pulled the same day, the threshold that yields about two alerts a year
    is **8.5 %** on the FAO Food Price Index, **35.7 %** on BLS `APU0000708111`
    (retail eggs) and **67.8 %** on BLS `WPU017107` (wholesale eggs) — a factor of
    eight. A 15 % threshold fires in **34.5 % of all months** on retail eggs. So
    the operator sets a *budget* (how often to hear about a series) and the code
    derives the percentage from that series' own measured history, storing the
    window it was computed over. (b) The same measurement kills a global
    implausibility ceiling: a 35 % single-step guard, the analogue of
    `IMPLAUSIBLE_DROP_CEILING = 0.6`, **refused 25 of 114 evaluated months** on the
    wholesale egg series, whose p99 month-on-month move is 82 %. Per-series again.
    (c) The rule's storability condition **has no input**: measured on this tree,
    `grep -rn -i "shelf_life" supabase/migrations/` returns **zero** shelf-life
    columns, so *"stock up"* on a perishable cannot be gated. Blocked on that and
    on the plan's Q1 (whether `api.bls.gov`'s `Disallow: /` bars a documented,
    key-issuing API) and Q2 (whether this should be an interruption at all, given
    that Kansas City Fed RWP 24-16 puts row-crop pass-through at about a year and
    calls it *"small and imprecisely estimated"* even with futures in the model).
    **Founder decision, not a ticket.**

- **Correction to a commit message (recorded 2026-09-05).** Commit `f45ada70` ("the small defects the audits of 2026-09-04 named") claimed the six citation corrections in this note and said providers/next "no longer imports settings/next"; the six citation fixes landed in `71916602`, and only the formatters were hoisted — `pages/providers/next/{TermsSection.tsx,TermSection.test.tsx,useProviderTerms.ts}` still import `../../settings/next/useSettingsNextData` (a coupling still to hoist). The message also said "eight" fixes and enumerated six.

- **`commodity_exposure_rising` is BUILT and is DARK (2026-09-05).** The founder answered the
  plan's Q2 with *"both: the line now, the alert behind a flag"*, so this rule exists in
  `apps/api-gateway/src/commodity/` and **is not a rule in this engine's twelve**. It has no
  entry in `analytics/recommendations.service.ts` and no producer in
  `notifications/producers/`, and that is the shape of "dark": `CommodityModule` imports no
  `NotificationsModule`, so there is no service it could notify with, and a test asserts that
  rather than a comment claiming it. Behind `COMMODITY_ALERT_DARK` (off) it writes one
  `neural_footprint_event` row per evaluation with `outcome` NULL. **Where it will land when
  it is judged** — after a quarter, by a person — **is here or beside `market-signal.ts`, and
  that placement is still the open half.** Two of its nine conditions cannot be evaluated at
  all today (coverage, and storability: measured, **zero shelf-life columns across every
  migration**), they are named on every decision and every ledger row, and the plan's Q3 is
  what unblocks them. Its thresholds are per-series and derived from each series' own history
  rather than global — measured, the "twice a year" rise ranges from **8.5 % to 67.8 %** across
  three real series, so a single constant would mean eight different things. Full record:
  `06-pages/notifications.md` §13.34 and `07-reference/commodity-signals-plan.md` phase 0.

- **Q4 ANSWERED (2026-09-05, the founder: *"a producer, as you recommended"*).**
  When `commodity_exposure_rising` is judged after its quarter dark, it lands as
  a **producer beside `market-signal.ts`** and NOT as a thirteenth rule in
  `analytics/recommendations.service.ts`. The reason is what the two engines are
  for: a recommendation is a standing thing a manager reads when they choose to,
  and this is an interruption about a moment — a series moved, this week, and
  the house has an item mapped to it. It also already shares that producer's
  shape: pure decision function, thresholds that state their own provenance,
  and every "no" carrying a reason. **Nothing has moved yet** — the rule still
  imports no notifications service and still writes only to the footprint
  ledger, and the move is what "judged" means. Recorded here so the placement is
  a decision on the record rather than a choice somebody makes later by
  reaching for whichever file is open.
- **Its unevaluated list is now ONE, not two (2026-09-05).** The founder's
  batch-51 answer put `shelf_life_days` on the house item — person-typed,
  nullable, **no category defaults** — so the rule's condition 8 is evaluated
  and storability left `UNEVALUATED_CONDITIONS`. The direction matters: a typed
  shelf life can only ever REMOVE an item from the firing set, so this shrank
  the rule rather than loosening it. **Coverage — the house's days of inventory
  for the item — is still not evaluated**, is still named on every decision and
  every footprint row, and is what a producer here would have to solve before it
  could speak to anybody.
