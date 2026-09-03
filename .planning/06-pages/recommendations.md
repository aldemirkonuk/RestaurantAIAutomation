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
| Migration | **new** `supabase/migrations/20260903091000_days_the_engine_must_not_count.sql` |

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

**Verified, not asserted.** Against the running local gateway on :4000: both 100% sentences
are gone from the live feed (they were there an hour earlier, quoted above); `firstSeenAt`
comes back as a real timestamp; a dismiss → re-read → restore round trip moved the feed from
3 entries to 2 and back, with `suppressed: 1` reported in between; `GET /analytics/exclusions/:rid`
returns `readable:false` with *"Could not find the table 'public.analytics_day_exclusions'"*
until the migration applies, and the page renders exactly that sentence rather than an empty
list. The withholding tests were also run against a pre-fix control (the observed-day
distinction removed) and **6 of them fail** on it.

**What is still open.** The scoped suppression path is proven by 67 gateway tests but only
the *rule* scope could be exercised end-to-end on the local tenant, because the only entries
that fire there name no subject — the subject/period scopes are unit-proven, not
curl-proven. And `analytics_day_exclusions` does not exist in the database until this
migration merges, so the exclusion checkbox is disabled in the running app today; that is
rendered as the reason, not hidden.

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
  motion tokens written out at the bottom), `MOTIONS.md`, and two test files
  (**37 tests** after the second pass). 2,446 lines of source + 834 of tests — well past
  the brief's ~900-line guideline, and disclosed rather than hidden: roughly a third of the
  source is the honesty prose (four real states per read, three failure sentences, the
  disclosure lines on every disabled control and every scope choice), and it is the part of
  the page the founder's review was about.
- Gateway, second pass (2026-09-03): **new** `analytics/insights/suppression.ts`
  (the key grammar) and `analytics/insights/day-exclusions.service.ts` (the engine's
  exclusion hook), plus edits to `insights/insight-generator.service.ts`,
  `insights/insight-verbalizer.ts`, `recommendations.service.ts`,
  `recommendation-actions.service.ts`, `analytics.controller.ts`, `analytics.module.ts`.
  Four gateway specs, **67 tests**: `insights/suppression.spec.ts` (23),
  `insights/baseline-honesty.spec.ts` (18), `insights/day-exclusions.service.spec.ts` (11),
  `recommendation-suppression.spec.ts` (15). Migration
  `supabase/migrations/20260903091000_days_the_engine_must_not_count.sql`.

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
| GET | `/analytics/exclusions/:rid` | **new 2026-09-03** — the days ruled out of every baseline, with a `readable` flag; `useRecommendationsNextData.ts` tenant effect |
| POST | `/analytics/exclusions/:rid` | **new** — `{businessDate, reason}`; `excludeDay()` |
| DELETE | `/analytics/exclusions/:rid/:businessDate` | **new** — `includeDay()`, "Count it again" |

Same six endpoints in the Mudavym build, all through `apiClient`, all keyed by
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
  `useMudavymDesign` through `PageGate` (`App.tsx:307`). OFF ⇒ the legacy page renders
  byte-for-byte.
- **Per-browser override `mudavym.design.recommendations`** in `localStorage`
  (`1|true|on` forces the redesign, `0|false|off` forces legacy) — precedence over the
  flag, one machine only (`lib/mudavym/useMudavymDesign.ts:31-45`).
- Redesign client state (none of it persisted): leaf, register filter, expanded set,
  selection, keyboard cursor, and — second pass — the open dismissal sheet's reason, scope
  and exclusion checkbox, which reset to the default (the exact finding, no reason, no
  exclusion) every time the sheet opens rather than remembering the last choice. Every
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
- **`scripts/check_no_seeded_defaults.py` `SCAN_ROOTS` should gain
  `apps/web/src/pages/recommendations/next`** — the guard only binds directories listed
  there, so this rebuilt surface is currently unpoliced by it. Measured 2026-09-02: with
  the root added the guard **passes** on this directory (13 roots, 740,341 chars); it
  first caught a `{ id, label, days }` snooze list under S1, which is why that list now
  keys its duration as `value`. One-line change, but the file is shared by seven page
  agents this wave — parent session's call. §13.9.
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
16. **Two directions drawn out for the founder's choice** —
    `.planning/sketches/090-recommendations-directions/`: `run-sheet.html` (banded
    Tonight / This week / This month, register demoted to a filter strip) and
    `two-pane-docket.html` (register · list · the working pinned open). Both carry the new
    dismissal dialogue so its weight can be judged in place. The shipped build is neither;
    the fork is the founder's.
