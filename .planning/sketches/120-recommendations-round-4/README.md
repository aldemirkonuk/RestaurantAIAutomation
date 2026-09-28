---
sketch: 120
name: recommendations-round-4
question: "The founder chose 108-A (the Morning Letter) and then said the Wave Four page he already has is the bar — 'find a way to improve functionality without disrupting UI experience currently'. So: how does the letter's functionality get bound INTO the built page, now that a real digest sender exists, without redrawing the page he likes?"
winner: null
tags: [recommendations, morning-letter, digest, digest-sender, subscription, send-log, receipts, subject-account, catalogue-view, day-strip, scoped-dismissal, day-exclusion, wave-four, adr-0112, adr-0138, adr-0147, adr-0149, sketch-only]
---

# Sketch 120 · The Letter, Bound In — `/recommendations`, round 4

## Design question

Three rounds are behind this one. 094b (the docket, filed by the act) is built with the
house day strip above it; 108 drew three identities past the docket and the founder chose
**A, the Morning Letter, with C's quiet tier grafted**. Then, on 2026-09-17, with the
Wave Four gallery in front of him:

> "Mudavym wave four artifact has the best reports … /recommendations rework needs one
> more time, (but still the mudavym wave four seems to be great compared to others find a
> way to improve functionality without disrupting UI experience currently), bestt /calendar"

Read literally, that changes the question. 108-A redrew the page as a letter — new
masthead, a postmark, a margin, its own ribbon glyphs. The founder's newer instruction
is that the **page as built** (`apps/web/src/pages/recommendations/next/`, the Wave Four
capture) is the visual bar alongside `/reports` and `/calendar`, and what is missing is
**functionality**. So this round draws **one direction**: the built page, unchanged in its
skeleton, with the letter's behaviour bound into it — and every addition is a thing the
gateway can serve today or a named new read, never a redraw.

Two things changed on the ground since 108, and both are load-bearing here:

1. **The digest sender is built** (`feat/finish-digest`, worktree `wt-fin-digest`,
   committed and unmerged as of 2026-09-17 — `e43374fdf`, `13b30a59e`;
   `apps/api-gateway/src/analytics/digest/`). It is
   per-person (`recommendation_digest_subscriptions`: frequency daily or weekly with an ISO
   weekday, no default), reads the house's hour and urgency floor from
   `recommendation_digest_prefs`, honours `restaurants.timezone` (UTC when unset, said in
   the mail), claims every send in `recommendation_digest_sends` before mailing, and
   ships **off** behind `DIGEST_SEND_ENABLED`. Its status read —
   `GET /recommendations/digest/subscription` — returns every reason a copy would not
   reach the caller, in words (`recommendation-digest.service.ts:792-905`,
   `DigestSubscriptionStatus` at `:1344-1378`). 108 drew the post as a house address and a
   `last_sent_at`; both are now wrong. `recipient_email` is stored and **never mailed**.
2. **The feed now says which sources did not answer** — `sourcesUnread: string[]` on
   `GET /analytics/recommendations/:rid` (same branch, `recommendations.service.ts`
   diff at `:129-149`). That is the honest substitute for 108-C's "could not read" tier
   until a per-rule reading exists.

Direction B of 108 (subject accounts) and C (instruments) are not redrawn. B's account
sheet appears here as what a subject opens into, on the two rules that carry one; C's
quiet tier is **not drawn** — see founder question 2.

## How to view

```
open .planning/sketches/120-recommendations-round-4/direction-a.html
```

Renders from `file://` on Warm Charcoal (ADR 0138). Top to bottom: the page at 1440 for
**Meyhouse Palo Alto** (US · USD · Pacific), a past day selected on the strip, the post
(two side sheets — the house's post, and your copy with the mail as the sender's template
renders it — then the rail alternative for question 5), a subject's account
with the dismissal open and the seven receipts, **Sim Vanilla Kaleiçi** (Antalya · TRY ·
Europe/Istanbul) with no till and no post, the catalogue leaf, five states, and a 390
mobile frame generated from frame 1's own markup. Fonts load from Google Fonts here; the product self-hosts Fraunces and
JetBrains Mono. The house header is a stand-in for `HouseHeader` (ADR 0047 mark); the
app sidebar is not drawn, as in 090/094/108.

## The example house, so every frame agrees

One clock, one house, as in 108, re-numbered to the docket's order (`ACT_ORDER` in
`rec-docket.ts:52-61`: order · price · stock · vendor · floor · schedule · goal). Read
**Wed 16 Sep 2026, 06:58 PT**. **14 rules evaluated** (12 rules + 2 goals); **8 of 8
sources answered** (`sourcesUnread` empty); **5 stand**; **1 withheld** by a dismissal
(`suppressed: 1`).

| # | Act | Rule | Urgency | Standing | Notes |
|---|---|---|---|---|---|
| 01 | Order it | `stockout_imminent` | now | 3 days (Sun 13 06:57) | goal door held (`GOAL_REFUSAL`, `rec-forward.ts:197-206`); acted 06:59 |
| 02 | Price it | `plowhorse_repricing` | this week | 11 days (Sat 5) | register **The floor** (`efficiency` → floor, `rec-format.ts:82`) |
| 03 | Call a vendor | `vendor_concentration` | this month | 17 days (Sun 30 Aug) | below the post's floor; both doors held |
| 04 | Brief the floor | `sales_below_weekday_baseline` | now | today | **new since the last post**; subject Tuesday, period `d:2026-09-15` — the only entry with an account door and a live day exclusion |
| 05 | Schedule it | `weekday_gap` | this week | 24 days (Sun 23 Aug) | names Tuesday in its sentence only — no subject, no account |

Ruled off Tue 15 18:12: `dead_stock_capital` ($6,140). Dismissed Tue 15 17:40:
`pairing_promotion`, rule scope (it carries no subject). Tue 8 Sep is out of the analysis
("Closed"); Sat 12 and Sun 13 have no till rows. The post: house daily at 07:00
Pacific, floor `this_week`; AK subscribed daily since Mon 7 Sep; last send Tue 15,
`sent` 07:00:41, 4 entries; next due today 07:00. The sentence on 04 is the verbalizer's
own template (`apps/api-gateway/src/analytics/insights/insight-verbalizer.ts:118`): *"Tuesday sales came in 38% lower than your
average Tuesday ($1,940 vs $3,120, over 6 past Tuesdays)."* The two goals fall due Wed 30.

## The direction — A · The Letter, Bound In (`direction-a.html`)

**Idea.** Keep the page the founder likes exactly as it is — masthead, denominator voice,
leaves, the house day strip, the register rail, the docket by act, the entry with its
three facts and two classified control rows, the working, the dark *Change a rule* — and
let the Morning Letter arrive as **functionality inside that skeleton**:

1. **A delta cutting above the docket — "Since yesterday's letter".** The reports sheet's
   card shape, one cutting, five lines: *New* (feed entries whose `firstSeenAt` is after
   the last send's `sentAt`), *Ruled off* and *Dismissed* (history rows since then, with
   the stored scope in words and a *Return it* door), *No record* (days the sparse till
   series skipped), and *Withheld* — dismissed · below the floor · sources that did not
   answer, in the same k/v shape as the other four. That fifth line is 108-A's "What this
   letter withholds" panel made a line of the delta **on purpose**: the founder's
   instruction was not to disturb the surface, so the three reasons are still given in
   one read, but as a line of a cutting the page already has rather than a panel of
   their own (03's *not posted* chip and the read-at denominator stay as the per-entry
   and per-source echoes). For a house with no send ever, it reads *Since your last
   visit* — see new field 4 — and its *Withheld* line says there is no floor because no
   post is set, and that an unconnected till was never asked.
2. **The post, in the rail, where the dark "Daily digest" block stood.** One cutting:
   the house's hour and floor, *your copy* (cadence, next due), *last* (outcome, count).
   Two doors, two sheets. **The house's post** — a side sheet (440) that writes the three
   stored house fields. The first draft of this round drew it as an anchored popover; that
   is withdrawn, because it is a *form that commits* and ADR 0112 allows exactly one
   anchored form — `InviteTeamDialog` on `Popover modal` — with founder answer F2
   recording that "a second **component** needing `Popover modal` is still the signal that
   collapses the policy" (`0112-one-modal-policy-three-shapes-one-primitive.md:109-114,
   193-195, 209-211`). A sheet is the shape the ADR gives a form; the fork (sheet · a
   second `Popover modal` · `/settings` row 26) is founder question 5, with the rail
   alternative drawn as frame 2c. **Your copy** — a side sheet (440) with the cadence
   controls, the sender's blockers as a checklist ("will it reach you?"), the last send,
   and the mail **as `buildDigestLetter` lays it out** on the declared paper surface —
   string for string, including the `Why:` line the template renders on every entry
   unconditionally (`recommendation-digest.template.ts:190` text, `:217` html). The `recipient_email`
   field is gone from the UI: the sender never mails it. Every sheet is drawn as the
   primitive builds it: modal by default (`Sheet.tsx:291`), scrim `rgba(0,0,0,0.5)` on
   charcoal (`sheet.css:36-38, 70-80`) — sketch 103's no-scrim sheet predates the ADR.
3. **A receipt under every act.** The built page already writes a one-line `note` with
   Undo; this makes it a ruled receipt under the entry it belongs to, saying exactly what
   was stored and what was not: act (recorded as acted; still standing), dismiss (the
   scope in words + the day exclusion, with the stored key in the working), snooze (the
   wake date, marked on the strip), rule off (sealed; **no outcome is measured**), goal
   (watched), day-book (**nothing was written on this page**), pin (leads the post too).
4. **A subject's account** — a side sheet from an entry whose rule carries a subject:
   standing against it, done, silenced for it (and at what scope), written recently (the
   stored insight feed), can be told (the catalogue by that dimension), and what is *not*
   on the account. Drawn only where the gateway can key it: today that is two rules.
5. **The catalogue as a leaf** — the same rail-and-rows shape, read-only, with the
   server's own coverage numbers and "data present" relabelled as what it measures.
   The reply keeps no edge from an insight type to a rule — `InsightCandidate` carries
   key · dimension · measure · comparator · category · template · requires
   (`insights/insight-catalog.ts:513-522`) and `annotatedCandidates()` adds only
   `implemented` — so no row says which entry it feeds. The last column is the one
   thing the reply does support: a type's `requires` against the house's `available`.
6. **The strip gains one mark** — a dot under every day a post went out to at least one
   member, from the send log; selecting that day also lists which rules the post carried
   and says the words are not stored (the sender keeps provenance, not a copy).
7. **Doors print their reason only when shut.** 108's open question is resolved this way
   because the founder's bar is fewer words on the surface; the non-refused explanation
   moves into the working. (Founder question 9.)

**Optimises for:** the page he already likes with a reason to open it today (the delta),
the digest as a thing you can see and control from the page it is made from, and an
audit line under every act.

### What it costs — exists

- The feed, first-fired, history, actions, exclusions, goals, till window:
  `GET /analytics/recommendations/:rid` (`analytics.controller.ts:915`), `…/history`
  (`:1066`), `…/actions?status=` (`:1044`), `GET/POST/DELETE /analytics/exclusions/:rid`
  (`:1090-1140`), `GET /analytics/goals/:rid?status=active` (`:589`),
  `GET /analytics/pos-revenue/:rid?days=` — all already read by
  `useRecommendationsNextData.ts:372-660`.
- The house's post: the sheet **writes** `PUT /analytics/recommendations/:rid/digest`
  (`analytics.controller.ts:1151`; `setDigestPref` at
  `recommendation-actions.service.ts:309-340` on the digest branch, body `digestEnabled ·
  digestHour · digestMinUrgency`). The rail's tile **reads** `house` on
  `GET /recommendations/digest/subscription` — `{set:false, enabled:false, hour:null,
  urgencyFloor:null}` when no row exists (`recommendation-digest.service.ts:899`, the
  shape's declared on the `DigestSubscriptionStatus` interface at `:1352`)
  — and never `GET …/digest`: `getDigestPref` returns `digestHour: data?.digest_hour ?? 7`
  and `digestEnabled: !!data?.digest_enabled` (`recommendation-actions.service.ts:301-302`),
  so on that read "no row" and "a row set to 07:00, off" are the same payload and a tile
  wired to it re-introduces the `7:00` stand-in this direction removes. `getDigestPref`
  **throws on a failed read** on the digest branch (`:286-299`), which is what the
  refused-state tile draws.
- Your copy: `GET/PUT/DELETE /recommendations/digest/subscription`
  (`recommendation-digest.controller.ts:48-78`; DTO `{frequency, weekday?}`,
  `recommendation-digest.dto.ts`), tenant and person from the token (ADR 0147 shape).
  The GET's `blockers[]`, `willReceive`, `nextDueAt`, `lastSend`, `house`, `timeZone`,
  `preferences` are the sheet's fields verbatim (`recommendation-digest.service.ts:
  1344-1378`). The mail's structure — subject `Mudavym: N recommendations standing at
  <house>`, the lead sentence, per entry urgency · observation · Do · Why · From rule ·
  standing since · Open it in Mudavym, the why-you-get-this and one-click stop — is
  `buildDigestLetter` (`recommendation-digest.template.ts:145-260`, re-measured against
  `13b30a59e`); the sketch's mail is that
  function's output for the example house, string for string, dates as Node 22's `Intl`
  prints them ("16 September 2026 at 06:58").
- The house's clock: the sender reads `restaurants.timezone` (`digest-schedule.ts`
  header, `mostRecentDue`/`nextDue`) — OD-92 is answered **for this sender** (not for the
  nine crons in `scheduled-tasks.service.ts`).
- Scoped dismissal + day exclusion: unchanged from the built `Entry.tsx:957-1058`; the
  keys arrive on the entry (`suppression.keys`, `recommendations.service.ts:400-410`);
  the receipt's first sentence is `dismissalSentence`'s output for the stored key, verbatim —
  "Silenced: this one finding about tuesday on Tue 15 Sep. The rule still reads every
  other day." (`rec-format.ts:262-271`; `readKey` at `:177-188` hands the subject slug
  through as stored, so it prints lowercase — a nit for the page). The exclusion sentence
  after it is the receipt's own: the function reads the key and knows nothing of
  `analytics_day_exclusions`.
- Receipts: client-side over the existing writes (`setDisposition`, `dismiss`, `bulk`,
  `createGoal`, `ruleOutDay` in the hook); the day-book door writes nothing here by
  design (`rec-daybook.ts`, `?new=` handed to the calendar).
- The account sheet's reads: `subject`/`periodKey` on `sales_below_weekday_baseline` and
  `weekly_demand_slide` (`recommendations.service.ts:163,182`); the stored feed
  `GET /analytics/insights/:rid` (`analytics.controller.ts:300`; rows below
  `INSIGHT_GENERATOR_VERSION` are absent, `insight-generator.service.ts:265-293`) — one
  current row per candidate, never a history: `persist()` deletes a category's rows
  before it inserts the fresh ones (`insight-generator.service.ts:347-360`), and no
  insight-history table exists (the only insight migration is `20260903130000`); the
  frame draws the block as the single stored row, dated by its own `computed_at`;
  dismissed keys and exclusions as above; the catalogue by dimension.
- The catalogue leaf: `GET /analytics/insight-catalog/types?restaurantId=`
  (`analytics.controller.ts:266-287`) → `candidates[]` with `implemented`, `available`,
  and `coverage` `{catalogued 573, implemented 24, computable, blockedOnData, notBuilt
  549}` (`insight-implementations.ts:105-156`; the four partition exactly). "Data
  present" is the client's count of candidates whose `requires` ⊆ `available`; the
  leaf's *Here* column is the same comparison, per row, in words. No field in the reply
  links a type to a rule, and none is drawn.
- `sourcesUnread` on the feed — **digest branch only**, not on `main`.
- Which rules the Antalya frame can blame on the till, and how: two of the twelve —
  `staff_spread` and `pairing_promotion` — read `ctx.insights` rows the checks family
  writes from `pos_checks` (`recommendations.service.ts:310-328`, commented "fire only
  with POS check data" at `:310`; family at `insight-generator.service.ts:870-877,
  1134, 1159`) directly. Three more are answered independently of it —
  `vendor_concentration` (vendor spend shares from `procurement_orders`,
  `analytics.service.ts:705-722`), `spend_acceleration` (`getCashflow`'s outflow is
  `delivered procurement_orders`, its own basis string says "revenue inflow needs POS
  feed", `advanced-analytics.service.ts:464-509`), and `revenue_concentration` (its
  `gini` is `E.risk.giniCoefficient` over `unitPrice × qty` on hand, from `inventory`,
  not `consumption` — `analytics.service.ts:724-727`; the same function's separate
  `consumption`-fed `revRows`/`dailyDemand` at `:729-732` feed VaR/Sharpe fields no rule
  reads). Two of those three — `vendor_concentration` and `spend_acceleration` — are the
  entries the Antalya docket shows; `revenue_concentration` is equally till-independent
  but is not standing today, for its own threshold's reasons, unrelated to the till.
  Every other rule on the page reads `wine_consumption_log` — the same table two
  independent `loadConsumption` helpers query (`analytics.service.ts:204-226`,
  `advanced-analytics.service.ts:107-123`) for `weekday_gap`'s `getSeasonality`
  (`advanced-analytics.service.ts:373-388`, zero-filling every day it holds no row for,
  `:387`), `stockout_imminent`'s reorder science (`analytics.service.ts:678`),
  `dead_stock_capital`'s consumption join (`:489-527`),
  `plowhorse_repricing`/`puzzle_activation`'s menu engineering
  (`advanced-analytics.service.ts:184-188`), and `sales_below_weekday_baseline` /
  `weekly_demand_slide`'s comparator match on `ctx.insights`
  (`recommendations.service.ts:145-171`, fed by the consumption family's
  `overall.bottles.*`, `insight-generator.service.ts:603-613, 652, 887-895`, which
  returns before writing either row when nothing was recorded, `:591`).
  `wine_consumption_log`'s only writer is the POS hub's per-sale mirror
  (`pos-hub.service.ts:993-1055`, called from the closed-check path at `:887`) — so
  with no till, nine of the twelve rules have no clean silence: two are refused outright
  on checks data, and seven read a log a missing till leaves at zero rather than
  absent.

### What it costs — new, each named with its shape

1. **`lastSend.ruleKeys`** (+ `rulesEvaluated`, `engineGeneratedAt`) on
   `GET /recommendations/digest/subscription`. The columns exist
   (`recommendation_digest_sends.rule_keys`, migration `20260917010100`); `statusFor`'s
   select (`recommendation-digest.service.ts:820-828`) does not fetch them. Needed for
   the delta's *carried / not carried* and for frame 1b. Without it the delta still
   works from `sentAt` alone (new · ruled off · dismissed · no record).
2. **`GET /recommendations/digest/sends?month=YYYY-MM`** — the house's send log for the
   session's house: `[{periodKey, dueAt, sentAt, outcome, entriesCount, ruleKeys,
   rulesEvaluated, engineGeneratedAt, recipients: number}]`. Counts only, never
   addresses or user ids (a member should not learn who else subscribes). Feeds the
   strip's *posted* dot and the selected day's *The post that morning*. Index
   `idx_recommendation_digest_sends_house` already serves it.
3. **`GET /recommendations/digest/preview`** — composes the caller's letter now through
   `buildDigestLetter` with `recordImpressions: false` (the option the digest branch
   added, `recommendations.service.ts` diff `:89-101`), returning `{subject, html, text,
   standing, entries, sourcesUnread}`. Never sends. The sheet's mail block reads this;
   without it the sheet can show only the structure, not the house's own sentences.
4. **`previousReadAt`** on `GET /analytics/recommendations/:rid` — the latest
   `recommendation_impressions.shown_at` for `surface = recommendations_page` before this
   request. Gives *Since your last visit* a clock for a member with no send row (the
   Antalya frame). One indexed query on the existing table.
5. **A `subject` (and `periodKey`) on the ten rules that carry none**
   (`recommendations.service.ts:186-330`) — the 108-B graft, unchanged: without it the
   account door exists on two rules and the sheet's *Done* cannot be keyed per subject.
   Founder fork (question 3), not a default.
6. **Currency-aware rule sentences** — `recommendations.service.ts:211,299` hard-code
   `$`; the Antalya frame draws ₺ and says so. Unchanged from 108.
7. **The act-verb map** (page note §13.20) — *Mark as briefed* on 04 writes `acted:
   true` and does not navigate; today's label is the hand's `Open Reports →`
   (`rec-format.ts:123-160`). Only the verb changes: the *Whose hand* fact on 04 and
   05 prints `Yours, in Reports` exactly as `handOf` returns it —
   `sales_below_weekday_baseline` and `weekday_gap` are not in `byRule` and neither
   starts with `goal_behind`, so both fall to `byCategory.sales` (`rec-format.ts:146`,
   the fallback return at `:152`), and `Entry.tsx:721` renders `Yours, in {e.hand.where}`. The hand and
   the act disagreeing on a floor entry is the third axis by design
   (`rec-docket.ts:12-25`); no hand map keyed by act is proposed. Founder question 4.

Not proposed: open tracking (the sheet prints "whether it was opened is not recorded" as
a fact); a stored copy of the mail's prose (the sender's own decision, honoured on frame
1b); an outcome measurement behind *rule off* (094c's roadmap; the receipt says none is
measured); a type→rule mapping on the catalogue (`feedsRules`) — corrected from the first
pass of this round, which said the rules never consume insight types by key at all. Two
do: `sales_below_weekday_baseline` matches any comparator containing `vs_same_weekday` and
`weekly_demand_slide` matches `vs_prev_period_7d` plus category `sales`
(`recommendations.service.ts:145-171`). Two more match on category alone —
`staff_spread` on `staff`, `pairing_promotion` on `basket`, whichever type wrote it
(`:311-328`). `stockout_imminent` fires on `reorderList[0].stockoutProbability > 0.4`
and touches no insight row at all (`:189-192`). None of that is a stored edge from one
catalogue row to one rule — it is a comparator or a category shared by several rows —
so `feedsRules` would still have to name a class, not a candidate, and would cover 4 of
12 rules; the same thing frame 3 refuses when it keeps 05 off Tuesday's account; a hand
map keyed by act (cost 7 says why).

## Honesty traps, and where each is handled

| Trap | Where |
|---|---|
| A preview is not a post; sent is not read | sheet foot; "whether it was opened is not recorded" on the cutting and the sheet |
| A stored default is not a setting | the post-off tile prints no hour and no floor when no row exists, read from `house.set === false` on `GET /recommendations/digest/subscription` (`recommendation-digest.service.ts:899`) — never from `GET …/digest`, whose `getDigestPref` returns `digest_hour ?? 7` (`recommendation-actions.service.ts:301-302`); the built page's `7:00` stand-in is gone |
| A member's copy is not the house's post | two doors, two sheets, two writes; "it subscribes nobody" on the house's sheet; *Stop my copy* stops one copy |
| A form that commits is not a picker | the house's post is a side sheet, not a popover: ADR 0112 F2 makes a second `Popover modal` component the collapse signal; question 5 |
| A built string is printed whole | `GOAL_REFUSAL` and `CUTTING_REFUSAL` verbatim under 01 and 03 (`rec-forward.ts:197-206, 372-380` — the backticks around `/analytics/risk` print literally, as `Entry.tsx:860-865` prints them today, a nit for the page); the mail's `Why:` on every entry; `dismissalSentence` on the dismiss receipt |
| A silent "no" | the blockers checklist prints the sender's own sentence for every failed condition |
| A deployment fact the page assumes | the first blocker line ("built and switched off on this deployment") is read from the status, never hard-coded |
| "As posted" from a log that stores no prose | frame 1b lists rule keys and counts and says the words are not stored |
| A schedule is not a run | the strip's dot comes from `recommendation_digest_sends`, never from the hour |
| Nothing fired ≠ nothing could be read | `8 of 8 sources answered` in the read-at line; the partial tile names the two that did not |
| A closure is not zero | hatched days; Sat 12 · Sun 13 in the delta; the dismissal's exclusion checkbox live only on a dated entry |
| A text match is not a key | 05 is excluded from Tuesday's account and the sheet says why |
| A type→rule edge with no key | the catalogue's last column is `requires` against `available`, never a rule name; four of twelve rules do key on a comparator or a category (not a candidate), and the *Two lists* note now says which, and why that still isn't a storable edge |
| A full source count beside an absent source | the Antalya read-at line: "8 of 8 connected sources answered · the till is not connected, so it was never asked"; `sourcesUnread` counts sources that were asked, and the rail says the till was never one |
| What is withheld, in one read | the delta's fifth line — dismissed · below the floor · sources that did not answer — 108-A's panel as a line, on purpose (direction item 1) |
| A refused door prints its reason | 01 and 03 print `GOAL_REFUSAL` / `CUTTING_REFUSAL` under the controls; live doors print nothing |
| A handoff is not a save | the day-book receipt: "nothing was written on this page" |
| A seal is not an outcome | the rule-off receipt: "no outcome is measured yet" |
| An unknown is never a zero | `History —` on the leaf; `—` at stake on every heading; the refused tile's post reads "unknown, not off" |
| Money in a sentence is not a field | the docket note, unchanged |
| ₺ drawn where $ is printed | the Antalya entry's caption and cost item 6 |
| A dismissal store that cannot be read | the partial tile's suppressed line, the built sentence |
| Captions on paper use `--ink-4` | the mail's "From rule …" and footer lines are `--ink-4` here; **the sender's template uses `PAPER.ink3` (#7c7365) for both** (`recommendation-digest.template.ts:41` defines it; `:218` the "From rule" line; `:248-251` the footer, re-measured against `13b30a59e`) — a nit for the digest lane, not this page; frame 2b's heading now says so on the frame, not only here |

## Founder questions this direction embodies

1. **Where does the delta live** — a cutting above the docket (drawn), a leaf of its own
   ("The letter"), or the first section of *Standing*? The cutting keeps the docket the
   spine; a leaf would give the letter its own address.
2. **The C graft.** 108's recommendation grafted *Read and quiet* into the margin; it needs
   a per-rule `reading · threshold · state` field on the feed, which changes every rule's
   condition (`recommendations.service.ts:133-139`). This round draws the substitute the
   branch already has — `sourcesUnread` — and no quiet tier. Fund the field, or accept
   the substitute?
3. **The account door.** Put a subject on the ten rules that carry none so the sheet opens
   from every entry, or leave it on the two baseline rules where the gateway can key it
   (drawn)?
4. **The act verb.** *Mark as briefed* (acted, no navigation) on floor entries, or the
   built *Open Reports →*? The hand and the act disagree on this rule by design
   (`rec-docket.ts:12-25`). Either way the hand fact stays `Yours, in Reports` — the
   sketch prints what `handOf` returns and lets the verb carry the disagreement; a hand
   keyed by act is neither drawn nor costed.
5. **Where, and in what shape, the house's post is edited.** Three paths, and ADR 0112
   constrains one of them: (a) **a side sheet from the rail** (drawn, frame 2) — a form that
   commits, in the shape the locked ADR gives a form; (b) **an anchored `Popover modal` in
   the rail** (the first draft of this round) — anchored beside the figures it changes, but
   a second *component* needing `Popover modal`, which founder answer F2 names as "the
   signal that collapses the policy" (`0112-*.md:209-211`), so choosing it means
   superseding 0112, not working around it; (c) **`/settings` row 26** (sketch 109) with a
   read-only tile and a link here (frame 2c) — one surface fewer on this page, a rare edit
   made beside the house's other settings, one navigation. Recommendation: (a); (c) if he
   wants this page to carry no house-level write at all; never (b) without a superseding
   ADR.
6. **The digest builder's five choices** (recommendations.md §9, review D3) are owed a
   founder confirmation before migration `20260917010100` merges — per-person
   subscriptions with per-house hour and floor, `categories.ai` as the gate,
   `recipient_email` never mailed, the 12-hour late limit, the D1 gate. The page as drawn
   assumes all five.
7. **The house-level send log** (new read 2) tells a member that *someone* got a post on
   a given day. Counts only — is even that more than a member should see?
8. **Should the delta be per subscriber?** For a weekly copy it reads "since Monday's
   letter"; for a member with no copy, "since your last visit" (new field 4). One delta
   per person, or one per house (the last send to anyone)?
9. **Refusal copy trimmed to shut doors only** — 108's open question, resolved toward the
   style bar here. Confirm, or restore the non-refused explanation on every entry.

## Recommendation

**Build this direction, in this order.** (1) The post cutting and its two sheets on the
existing reads and writes — ready the day `feat/finish-digest` merges, with the mail block
waiting on new read 3. (2) Receipts — client-only, over writes that already land.
(3) The delta cutting from `lastSend.sentAt` today, upgraded with new field 1. (4) New
read 2 and the strip's dot with frame 1b. (5) The catalogue leaf. (6) The account sheet on
the two rules that carry a subject; question 3 decides whether it grows.

Why this and not a second direction: the founder's instruction is a constraint on the
surface, and every genuinely different idea (the letter as the page, accounts as the
unit, instruments as the spine) is a redraw he has already declined. The one open shape
inside the constraint — delta as cutting or as leaf — is question 1 rather than a second
file, because the two differ by a click and not by an identity.

## Screenshots

`shots/direction-a-1440.png` (full page, desktop, 1440 × 20518 — past Chrome's 16,384 px
cap, so the script took it in three 8000 px bands and stitched them; `banded: true`) and
`shots/direction-a-390.png` (390 × 6915, one capture), rendered with
`p4-scratch/render-sketch.mjs`; both runs report `errors: []`, `horizontalOverflow:
false`. Every PNG was cut into 1600 px (desktop) / 1200 px (mobile) bands with Pillow —
13 and 6 — and every changed band was re-read on this round's recheck (round-4's
initial capture and read of the unchanged bands still stands).

Changed on the 2026-09-17 critique, all re-read: the house's post is a side sheet with
the charcoal scrim (frame 2), not a popover; your copy's sheet (2b) and the account
sheet (3) sit over the same `rgba(0,0,0,0.5)` scrim the primitive paints; the dismissal
and the receipts moved to their own undimmed frame (3b) because they are inline, not
overlays; the four built strings are pasted whole (`GOAL_REFUSAL` on 01 and 03,
`CUTTING_REFUSAL` on 03, `Why:` on all four mail entries with the full `Do:` sentences,
`dismissalSentence` on the dismiss receipt) and the 2b stage grew for the taller letter;
the built page's foot note is a visually hidden `role="status"` region, so one act has one
Undo at 1440 and at 390; frame 2c draws question 5's settings-link alternative.

Changed on the second 2026-09-17 critique (the pass was cut off by a usage limit with
the page edited and the README not; finished 2026-09-18, every band re-read): (1) the
390 frame is frame 1's own markup laid out at 390 — the `3 more … Show them` fold is
deleted (the built page has no fold), the three facts stand in one column, both `Carry
it out` / `File it` rows keep their labels as full-width headings, `The working` and
`Select` stand on every entry, the register, out-of-analysis and Keys blocks are drawn
above the book as `rc-shell` stacks the rail, and the strip is frame 1's whole month —
the first resume of this pass had left a ten-day strip with its own sentence in place
of the built one, which the second caught by diffing the two strips' text; (2) the catalogue's *Where it shows* column is gone — the
reply has no type→rule edge and the two edges it drew were wrong (`stockout_imminent`
never reads `ctx.insights`; `pairing_promotion` keys on a category) — replaced by
*Here*, `requires` against `available`, with the *Two lists* note rewritten as the
reason; the leaf row no longer calls itself "the reading behind entry 01"; the
invented "missing: cost on 61 of 118 wines" row is replaced by one whose missing source
is a `DataRequirement` the reply can name (`tables`); (3) the hand on 04 and 05 prints
`Yours, in Reports` as `handOf` returns it; (4) this section's shortened-list is
rewritten to what the render trims at 390 — nothing on frames 1 and 7, named below for
frame 4; (5) frame 2b's heading discloses the
caption hue; (6) the Antalya read-at line and rail say the till was never asked; (7)
the delta gains its fifth line, *Withheld*, on frames 1, 2, 2b, 4 and 7.

Nothing is trimmed at 390 on frames 1 and 7 — the claim below is about those two only.
Frame 4 (Antalya, 1440) does trim: it leaves out the act-say line under each section
head and the dark *Change a rule* section that the built page renders
(`RecommendationsNext.tsx:766, 828`); frame 4 was drawn before those existed on this
sketch and was not brought back into parity, since redrawing a second house's full
docket is outside this grounding pass. The 390 frame is generated from frame 1's markup
(the same `<header>` … `</footer>`, strip included, with only the `aria-labelledby` id
renamed), so its strings cannot drift from the desktop's — a text diff of the two
frames' strips is now empty; what differs is layout only, and each difference is the
built page's own rule — `rc-shell` one column below 900 (`rec-next.css:76-77`),
`rc-facts` one column below 640 (`:151-155`), the control label `flex: 1 0 100%` below
640 (`:176-178`), and the strip scrolling sideways below its 30 px cell floor rather
than shrinking the day number (`day-strip.css:48, 126`), with the legend, the hint and
both sentences rendered at every width (`Ribbon.tsx:131-158`). Two things the frame
shows are nits for the page, drawn as built and not corrected here: the Keys block,
which the built page renders at every width; and the strip opening on the 1st with
today off to the right — `homeIdx` seats the roving focus on today and nothing calls
`scrollIntoView` or sets `scrollLeft` (`DayStrip.tsx:110-113`; `grep scroll` on the
component finds only the comments and the CSS `overflow-x`). The fade at the strip's
right edge is the sketch's hint that it scrolls; the built strip shows a scrollbar. One
sketch-side change reaches every frame: a section head's count and its stake clause
(`1 entry — at stake · not carried`) are one flex item, so at 390 they wrap together
under the title instead of splitting across two lines; at 1440 nothing moves.

Earlier fixes still standing from the first pass: the *Carry it out* label wrapped in its
74 px gutter (widened to 88, `nowrap`); the catalogue's *Says* column was starved
(colgroup + `table-layout: fixed`) and then the mono state text overran its column
(`nowrap` removed); the paper mail's two caption lines were `--ink-3` (now `--ink-4`,
nit filed above). `grep -c 'var(--ink-3)'` returns 6, all rules, borders, dots and glyph
strokes.

Changed on the 2026-09-18 recheck, a grounding pass (direction and layout unchanged;
all changed bands re-rendered at 1440 and 390 and read): (1) the Antalya "till" claim
was overstated at three spots — corrected from "five rules need till checks" to the two
that actually read POS-check data (`staff_spread`, `pairing_promotion`); the other three
read consumption or seasonality data instead, named in a new "exists" bullet with
citations; (2) the "No record" delta line no longer claims 05 *skips* a missing day —
`getSeasonality` zero-fills every missing day unconditionally
(`advanced-analytics.service.ts:387`), so the line now says that plainly, on frames 1
and 7 both; (3) frame 1b's *not carried* line no longer claims the send log counts
below-floor entries — it does not, so the line now states only what's derivable (11 of
14 rules did not carry) and says the floor breakdown isn't kept; (4) the subject
account's "Written recently" block no longer shows three weeks of history the store
does not keep — `persist()` deletes a category's rows before every insert, so it now
shows the one current row, dated by its own `computed_at`; (5) the catalogue's *Two
lists* note and leaf-row rationale no longer say the twelve rules never key on an
insight type — two do, by comparator substring, and two more by category, corrected in
the note, the leaf row, the README's *Not proposed* paragraph and the honesty-traps
table; (6) the leaf row's row-count parenthetical (`consumption 42 rows in 30 days;
count Mon 14 Sep`) is dropped — `available` says presence only, never a count or a
date; (7) "Nothing is trimmed at 390 or at 1440" is narrowed to frames 1 and 7; frame 4
does trim the act-say lines and the dark *Change a rule* section, now named rather than
denied; (8) the digest template's re-cited line numbers (`:216`/`:246-249` →
`:218`/`:250-251`, `:143-257` → `:145-260`) are re-measured against the branch's current
tip, `13b30a59e`. The full defect list is in the recheck this pass answers, not
reproduced here.

Changed on the 2026-09-18 round-3 recheck (grounding only; subtraction preferred over new
figures throughout; all changed bands re-rendered at 1440 and 390 and read): (1) the
Antalya "Could not read" block and the delta's *Withheld* line still reported the
consumption-driven rules' silence as clean — corrected, and then re-checked a second time
after the first correction itself undercounted (it said "5 of 12" from the three rules the
old text named plus the two checks rules; `wine_consumption_log` also feeds
`stockout_imminent`'s reorder science, `dead_stock_capital`, and both menu-engineering
rules, `analytics.service.ts:204-226, 678, 489-527`, `advanced-analytics.service.ts:
107-123, 184-188` — nine of the twelve, not five). Only three rules are answered
independently of the till: `vendor_concentration` and `spend_acceleration` (purchasing
data, the docket's two standing entries) and `revenue_concentration` (its `gini` is over
inventory value, not consumption — `analytics.service.ts:724-727` — confirmed separately
from the `consumption`-fed fields the same function also returns, `:729-732`, which no
rule reads). `wine_consumption_log`'s only writer is the POS hub's per-sale mirror
(`pos-hub.service.ts:993-1055`, called at `:887`); both frame and README (the till-blame
bullet) now give the fuller count; (2) frame 2 and 2b's "No record" line still read
"the till sent nothing; skipped, not zero", contradicting frame 1's corrected zero-fill
line — shortened on both frames to "no till rows for either day", a claim that holds without
restating frame 1's longer one; (3) Antalya entry 02, "₺41.200 is locked in inventory that
has not moved in 90 days", cannot be served for a no-till house — `dead_stock_capital`
requires `deadStockCapital > 0`, and that figure is a consumption join
(`analytics.service.ts:489-527`) fed by the same consumption log only a till writes; the
entry is dropped rather than replaced with an invented substitute (no other inventory rule
is till-independent — `stockout_imminent`'s reorder science reads the same log,
`analytics.service.ts:678`), so Antalya's docket now shows 2 entries, renumbered 01/02, and
every count that named 3 (the voice line, the Standing leaf, the register's *All*, the
delta's *Unchanged* line) now says 2; (4) the catalogue leaf row said "two other rules" key
on a comparator or a category — the *Two lists* note and the README both say four (two of
each); the leaf row now says four; (5) the *Two lists* note's "matches any comparator
ending `vs_same_weekday`" overstated a substring test as a suffix match
(`candidateKey.includes(...)`, `recommendations.service.ts:147`) — reworded to "containing"
in both the frame and the README's *Not proposed* paragraph; (6) three citations were
re-measured against `13b30a59e` and were off: the digest branch is **committed**, not
staged (`e43374fdf`, `13b30a59e`); the `Why:` line is `recommendation-digest.template.ts:190`
(text) / `:217` (html), not `:53, 215` (a type field and the observation div); the footer's
`PAPER.ink3` span is `:248-251`, not `:250-251`; `DigestSubscriptionStatus` is declared at
`:1344`, and the `set:false` shape the rail's tile reads is returned at `:899` (declared in
the interface at `:1352`), not `:1344-1348` (armed/served/unsubscribeLinkReady, unrelated
fields); (7) two nits are named for the first time rather than left unstated: the Antalya
rail's built string "days with no records were never counted as zero" (`RecommendationsNext.tsx:645-648`,
drawn as built) is now false for a house whose weekday spread *does* zero-fill — a nit for
the page, not this sketch's to fix; and the frames' claim that 05's zero-fill is "an engine
defect this page does not paper over" is accurate but was filed nowhere — it is still not
filed in `.planning/v3.0-TECH-DEBT.md` (filing it is outside this directory, which this
round's brief restricts edits to) and both frames now say so in the same sentence, so the
page no longer implies the gap is tracked when it is not. The full defect list is in the
recheck this pass answers, not reproduced here.

## What I could not verify

- No dev server was run. Every endpoint claim is read from source in
  `wt-finish` (`feat/mudavym-finish`) and from the **committed, unmerged** digest branch
  in `wt-fin-digest` (`feat/finish-digest`, tip `13b30a59e`, base `60ed83a7e`); the subscription endpoints,
  `sourcesUnread`, `recordImpressions` and the two new tables exist only there. If that
  branch changes before merge, the shapes cited here move with it.
- The example figures are invented: the 38% Tuesday, the send times, the four-entry
  post, the 412 "data present". The per-dimension catalogue counts (62 · 48 · 40 · 51 ·
  51 · 44 · 96 · 70 · 58 · 53 = 573) are carried from 108 and were not re-derived from
  `buildCandidates`. The reach suite measures 34 · 132 · 573 only.
- "48 types for a day of the week, none built" and "the baseline is filed under Overall
  (`overall.revenue.vs_same_weekday`)" are read from the dimension list and the
  verbalizer's entity handling, not from a live `candidates[]` payload.
- The catalogue's example rows are illustrative, not a live payload. The "missing:
  tables" row (`wine.revenue_per_seat.trend_direction`) is a key the
  dimension.measure.comparator scheme can form, and `revenue_per_seat` does require
  `checks` and `tables` (`insight-catalog.ts:150-153`), but whether `buildCandidates`
  emits that exact key was not checked; the *Here* words are what a client would print
  from `requires` against `available`, not a server string.
- The "unknown" catalogue row is a client-side state for a payload that omits
  `implemented`; `annotatedCandidates()` always sets it, so the row is drawn to show the
  word exists, not because the server produces it.
- The founder's 2026-09-17 note is relayed by the harness; the ruling that the catalogue
  is a view of this page (F10) is still relayed, not recorded.
- The mail's date form ("16 September 2026 at 06:58") is what `Intl.DateTimeFormat`
  prints on the Node 22 this sketch was checked with; older ICU builds print "16
  September 2026, 06:58". The gateway's `engines` says `>=18`; the deployed Node was not
  checked.
- ADR 0112's text was read, not re-litigated: the sheet is drawn because F2's ruling is
  explicit, and the popover path is offered only as a superseding fork.
- How many day cells show before the strip scrolls at 390 (eleven whole cells in the
  render) is measured on this sketch's copy of the strip CSS — the same 30 px floor and
  2 px gap as `day-strip.css:48, 121` — not on the built component in a browser.
- Line numbers are as of these two worktrees on 2026-09-17; they move when the files do.
