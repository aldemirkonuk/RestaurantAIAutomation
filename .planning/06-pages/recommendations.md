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
  thirteen rules map to one of the gateway's six metrics, three map to none and render the control
  disabled with the reason, and the `goal_behind_*` family refuses because it already *is* a goal.
  **See it in reports** deep-links to the one cutting of the reports sheet's eleven whose register
  answers this rule, saying whether that is the same register the rule read or a different one that
  plots the same quantity; four rules have no cutting and say so. Mapping, bases and refusals:
  `apps/web/src/pages/recommendations/next/rec-forward.ts`.
- **The controls are themselves classified** into two labelled rows — **Carry it out** (act · make
  a goal · see it in reports) and **File it** (the working · snooze · dismiss · pin · select) —
  the control-side half of the founder's "everything in a categorized classified section".

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_recommendations`)

Canonical source with curves: `apps/web/src/pages/recommendations/next/MOTIONS.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `rc-work-settle` | The working opens | an entry's rationale/rule/assignment/seal panel, `grid-template-rows: 0fr → 1fr` on `settle` (320ms house curve) — the row-expand the founder named by hand in the wave-1 review |
| `rc-leaf-turn` | A leaf turns | changing leaf (Standing → Snoozed → Dismissed → Ruled off → History) — `turn`, 420ms, fade + 5px rise, once per leaf |
| `rc-ink` | Ink micro-state | entry left-rule warming to the seal ring on hover/focus, quiet-button borders — `ink`, 160ms; nothing moves |
| `rc-hold-pour` | The hold fills | `HoldToApprove` on **Hold to rule off** — `pour`, linear 620ms; an early release retreats on `tuck` and says what did not happen |
| `rc-seal-stamp` | The seal lands | the hold completing and the entry being ruled off — `stamp`, ~11% overshoot, the only wax on the page |

(Second pass, 2026-09-03: the dismissal sheet adds **no** motion — it is the one
control that stores a standing instruction, and a panel that slides while someone
decides what to silence is asking them to hurry. See MOTIONS.md §"Second pass".)

(Fourth pass, 2026-09-03: the goal sheet adds **no** motion either, for the same reason —
it is the page's second standing instruction, and a target is a number a house is judged
against afterwards. The two classified control rows add none: they are a layout, and a
label that animates into place is a label that was not there when the eye arrived.)

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
  `MOTIONS.md`, and three test files
  (**67 tests** after the fourth pass: 41 render, 14 transport, 12 mapping).
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
| GET | `/analytics/goals/:rid?status=active` | **new 2026-09-03** — the goal sheet's "you already hold a goal on this figure" line; lazy, on first sheet open; `analytics.controller.ts:485` |
| POST | `/analytics/goals/:rid` | **new** — *Make this a goal*; body `{name, metricKey, targetValue, deadline, period, direction}`, **no `createdBy`** (the controller passes the body through unfiltered at `:507`, so a client-supplied actor id would be an unverified claim); `analytics.controller.ts:497` |

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

## 11. Data flow

### Calls out

Corrected 2026-09-02: every row below now sends the bearer — the legacy page through
`apiClient` since `58113e26`, the Mudavym build by construction (§10). Controller
line numbers are the decorators as they stand today.

| Method · Path | Auth **sent** | Auth **required** | Gateway controller | Returns |
|---|---|---|---|---|
| GET `/analytics/recommendations/:rid` | ✅ via `apiClient` | JWT (class) | `analytics.controller.ts:728` → `recommendations.service.ts:58` | ranked rule hits with observation / action / rationale, merged with dispositions |
| GET `…/:rid/history`, `…/:rid/actions?status=` | ✅ | JWT | `:879`, `:857` | leaf contents (dismissed / snoozed / done / history) |
| GET/PUT `…/:rid/digest` | ✅ | JWT | `:894`, `:902` | digest preference — **stored, never sent** (§9) |
| POST `…/:rid/action` | ✅ | JWT | `:754` | act/dismiss/snooze/done/pin/assign/feedback write |
| POST `…/:rid/bulk-action` | ✅ | JWT | `:808` | bulk write |
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
5. Correct the stale `v3.0-TECH-DEBT.md:493` line ("Recommendations entirely read-only")
   — actions shipped; the page's real problem was auth, and that is now fixed.
6. **Build the digest sender, or retire the preference.** `recommendation_digest_prefs`
   is written and read by nothing else (§9); the redesign shows the control disabled
   with that reason. Either a job in
   `analytics/insights/insight-scheduler.service.ts` reads `digest_enabled` /
   `digest_hour` / `digest_min_urgency` and sends (writing `last_sent_at`), or the
   endpoints and the table go. *Blocker: founder call on whether the product mails.*
7. ~~**Expose first-fired time so "standing" stops being an em dash.**~~ **Done
   2026-09-03** — `attachFirstSeen` in `recommendations.service.ts`, rendered by
   `standingOf()` with the clock it read named on the row (§1b second pass).
8. **Decide whether the platform may ever act on a recommendation itself** — the
   founder's own third axis, and today the honest answer on every entry is "not built"
   (§9). It is an ADR, not a ticket: what may be done unattended, under whose
   permission, with what audit trail. `enable_ai_autonomous_send` is the precedent for
   the shape of the switch.
9. **Add `apps/web/src/pages/recommendations/next` to `SCAN_ROOTS` in
   `scripts/check_no_seeded_defaults.py`** (§9) — measured to pass with it added.
10. **Point the legacy page's path param at `activeRestaurantId`**
    (`Recommendations.tsx:153`) so it agrees with the JWT and the `X-Restaurant-Id`
    header after a restaurant switch (§9).
11. Emit signals — dispositions are operational state, but *which rules get dismissed*
    is the highest-value UX signal in the product and nothing records it (§5). The
    impressions log now covers what was *shown*; what is missing is the reporter.
12. **Give the page a way to mint a link.** It reads `?insight=<ruleKey>` but has no
    `Copy link` control, so the deep links it honours can only come from elsewhere.
13. If the book ever grows past a screen, restore search / sort / category filters
    (§1b names them as deliberately dropped) — they are cheap, and the register alone
    stops scaling somewhere around twenty entries.
14. **Show the standing silences in Settings** (§9). A panel listing every stored
    suppression key with its scope in words and a Return control — the founder asked for it
    if the hook were trivial; it is not, from this page's paths.
15. **Apply the observed-day distinction to the per-wine demand series** (§9), so a closure
    stops counting as zero demand for a stockout probability the way it used to count as
    zero revenue for a baseline.
16. **Make the generator version un-forgettable.** `INSIGHT_GENERATOR_VERSION`
    (`insight-generator.service.ts`) is bumped by hand; a change to the arithmetic that forgets
    it reintroduces the retracted-sentence bug with no symptom. The shape that would close it is
    a checksum test over the files that decide what a sentence claims
    (`insight-verbalizer.ts`, `timeSeriesInsights`, `engine/comparisons.ts`) that fails until the
    constant moves. §9.
17. **Two directions drawn out for the founder's choice** —
    `.planning/sketches/090-recommendations-directions/`: `run-sheet.html` (banded
    Tonight / This week / This month, register demoted to a filter strip) and
    `two-pane-docket.html` (register · list · the working pinned open). Both carry the new
    dismissal dialogue so its weight can be judged in place. The shipped build is neither;
    the fork is the founder's.
18. **Make the reports sheet read `?cutting=<id>`** (§9). *See it in reports* mints
    `/reports?cutting=…&rec=…&from=recommendations`; the reports page reads no query parameter at
    all, so the link opens the sheet and the entry says the cutting's name instead of landing on it.
    The honest full version also *adds* the cutting when it is not on the reader's sheet — which is a
    write to another page's stored arrangement (`reportsSheet` in user preferences), and therefore a
    founder's call before it is a ticket.
19. **Give a goal its provenance** (§9). One nullable `source_rule_key text` on `analytics_goals`
    would let the entry say "this is already being watched" instead of "you already hold a goal on
    this figure", and would let the case-ledger direction (094c) exist at all. Migration, so a
    founder's call. While there: the `goal_behind_*` family should link to
    `GET /analytics/goals/:rid/:goalId/progress` rather than refusing both doors — it is the one
    rule family whose deep link is a goal, not a cutting.
20. **Return a structured `moneyAtStake` on each recommendation, and an act key** (§9) — the two
    fields the action-docket direction needs and the only two it needs. Both are additive on
    `recommendations.service.ts`; neither changes a sentence.
21. **Decide whether a rule can be retuned, and by whom** (§9). The dismissal reasons are already a
    taxonomy and nothing reads them as one. DESIGN-FOUNDATION §6 rates this need-it-now for this
    page; it is an ADR (what may be tuned, under whose hand, with what threshold history), not a
    ticket.
22. **Make `GoalsService.computeMetricWithSeries` distinguish a measured zero from an unread table**
    (§9) — the same fault the second pass removed from `toDaily`, still live one module over. A goal
    whose baseline could not be read should say so, not report 0.
23. **Sketch set 094 is the shape fork** —
    `.planning/sketches/094-recommendations-directions-2/`: `calendar-strip.html`,
    `action-docket.html`, `case-ledger.html`. The recommendation on the index is 094b as the spine
    with 094a as a ribbon above it and 094c as the roadmap; nothing of it is built.
