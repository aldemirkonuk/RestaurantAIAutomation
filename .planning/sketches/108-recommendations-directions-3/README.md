---
sketch: 108
name: recommendations-directions-3
question: "After the docket was chosen as the spine (094b) and the founder still said 'rework, not sure, create 2-3 more sketch' — what is the page's IDENTITY, now that the catalogue is a view of it and a real digest sender is being built?"
winner: null
tags: [recommendations, catalogue, digest, ribbon, day-strip, mudavym, rework, directions, morning-letter, subject-accounts, instruments, data-presence, sketch-only, adr-0044, adr-0112]
---

# Sketch 108 · Three identities for /recommendations, past the docket

## Design question

Two rounds are behind this one. Sketch 090 drew the run-sheet and the two-pane docket;
sketch 094 drew the calendar strip, the action docket and the case ledger, and on
2026-09-03 the founder chose **094b (the docket, filed by the act) as the spine with the
strip as a ribbon**. That is built (`apps/web/src/pages/recommendations/next/`, eight act
headings in `rec-docket.ts`, three-scope dismissal in `Entry.tsx`, the two forward doors
in `rec-forward.ts`). His note on it, from the wave-four snapshot's verdict record
(`claude/artifact-pull:.planning/07-reference/artifacts/mudavym-wave-four.md` — the
snapshot lives only on that unmerged branch, not in this worktree or on `main`;
`verdicts/recommendations`, `2026-09-03T15:47Z`, verdict `rework`; spelling normalised,
words his):

> "I need your help (I said rework new design but not sure), what would you select — I
> also liked the day strip a lot. But I need your expertise, maybe create 2-3 more sketch
> to understand behaviour and what would work the best. Especially some brainstorming
> ideas — a calendar strip that we can select and see that is highly advanced and elegant
> looking, or something else. The need is that we need everything in a categorized,
> classified section in order for people to understand what to do as action — maybe add
> a couple of buttons that will let them set the recommendations as goals, or have them
> see these changes in reports."

Three asks are in that note, and each file answers all three:

1. **The day strip, selectable, "advanced and elegant".** It was decided as a *ribbon*
   in 094 and is built (`Ribbon.tsx`). Every direction here draws it under the leaves
   with a legend adapted from the built one (`Ribbon.tsx:159-164`; the built text says
   *no records — not a zero*, the sketches say *no till rows* because the days in
   question are till days) — and each direction gives the day its **own glyph** and
   *selecting a day* a meaning the identity can keep. A: a day is a **letter**, drawn as
   a small ruled sheet whose lines are the entries that post carried; selecting one reads
   the post as it went out (frame 1b, *as posted* / *as recomputed*, plus the refused case
   of a day before the post began). B: a day holds a **dot per account** that wrote, a
   deed on one, a wake; selecting one keeps only the accounts that wrote (frame 1b, with
   the rail printing *—* for the kinds that could not have written on a no-till day).
   C: a day is that morning's **run**, a 14-reading stack of sounding · quiet · could
   not read; selecting one is that run (frame 1b, where the no-till hatching is shown to
   move one instrument into *could not read*). In all three the selected past day is
   drawn in **ink** (solid ring, caret) and today in **seal**, so the two never look
   alike.
2. **Categorised sections so people understand what to do as action.** A files
   *Standing* by the act; B by the subject; C by the instrument's state with the act on
   every entry. The recommendation below weighs which of the three keeps "the action"
   as the spine.
3. **Buttons for goals and reports.** The two doors (`rec-forward.ts`, *Make this a goal*
   · *See it in reports*) are on every entry in all three, desktop and mobile, **drawn
   as the built logic decides them**: the goal door is refused on `stockout_imminent`,
   `vendor_concentration` and `revenue_concentration` (`GOAL_REFUSAL`, `:197-206`), the
   reports door is refused on the two concentration rules and on `pairing_promotion`
   (`CUTTING_REFUSAL`, `:372-380`), and a refused door prints the built reason under the
   controls in words, never only in a `title`. The *Day-book* door is drawn dark with
   its reason on every entry that is not *Schedule it* (the built page does not draw it
   at all there, `Entry.tsx:146-152`; the sketch shows the door so the founder sees why
   it is shut).

And on the catalogue (`MAKEOVER-VERDICTS.md:187-190`): *"I really like this one … I like
the initiative here"* — KEEP+, more sketches asked for anyway.

Two things changed since 094 that make this round a different question:

1. **The catalogue is a view of /recommendations, not a separate page** (relayed ruling,
   2026-09-12, not yet recorded — fork F10 in the census). So every direction has to show
   *where the catalogue lives* on the same page, read-only, with "computable now"
   relabelled as what it actually measures: **data presence**.
2. **A real digest email sender will be built** (decided 2026-09-16). The preference
   already exists — `GET/PUT /analytics/recommendations/:rid/digest`
   (`analytics.controller.ts:1143,1151`) storing `digestEnabled · digestHour ·
   digestMinUrgency · recipientEmail · lastSentAt`
   (`recommendation-actions.service.ts:293-297` read, `:314-325` write) — and nothing
   writes `last_sent_at`: `grep -rl last_sent_at apps/api-gateway/src` returns only that
   reader, and the "feature-flagged scheduler" the controller's own summary names
   (`analytics.controller.ts:1155`) is no file in the gateway that mentions a digest.
   So every direction has to show the preference, **what the mail contains**, and — since
   `getDigestPref` returns `digestEnabled:false` with no row for every house today — what
   the page is **when nothing is posted** (a fifth state tile in each file).

The three files do **not** redraw the docket or the case ledger, and the strip appears
only as the ribbon 094 decided, never as the page. Each asks
what the page *is*, three different ways, and keeps the decided material (act headings,
the ribbon, three-scope dismissal, the two doors, the denominator sentence) as furniture inside it.

## How to view

```
open .planning/sketches/108-recommendations-directions-3/direction-a.html
open .planning/sketches/108-recommendations-directions-3/direction-b.html
open .planning/sketches/108-recommendations-directions-3/direction-c.html
```

Renders from `file://`. Each file shows, top to bottom: the page at desktop width on
Warm Charcoal (ADR 0138 — the decided ground) for **Meyhouse Palo Alto** (US · USD ·
Pacific), the overlays drawn open, **Sim Vanilla Kaleiçi** (Antalya · TRY · tr-TR ·
UTC+3) where locale and a null recipient change the page, the catalogue as a view, a
strip of five states (loading · empty · refused · partial · **post off**), and a 390px
mobile rendering. Below 600px the file shows only the mobile frame. Fonts load from
Google Fonts here; the product self-hosts Fraunces and JetBrains Mono. The house mark in
the header is a stand-in for the trued A+M interlock (ADR 0047); the app sidebar is not
drawn, as in 090/094.

## The example house, so every frame agrees

One house, one clock, in all three files. Read **Wed 16 Sep 06:58**; the post goes daily
at 07:00 and the last post went **Tue 15 07:00 with four entries** (Barolo, the Sancerre
plowhorse, the weekday spread, the pairing promotion); the next goes today in two
minutes. **Fourteen instruments** (12 rules + 2 goals): **13 read, 1 could not read**
(`staff_spread` — the till's checks carry no server id). **Five stand**: Barolo stockout
(first fired **Sun 13, 06:57**, carried in that morning's post), Tuesday sales below the
Tuesday baseline (new today, about yesterday, Tue 8 out of the analysis), the plowhorse
reprice (since Sat 5), the weekday spread (since Sun 23 Aug), vendor concentration
(since Sun 30 Aug, below the post's floor). Dead stock ($6,140) is ruled off Tue 15 18:12.
**One dismissed**: `pairing_promotion`, first fired **Mon 14**, silenced Tue 15 17:40 at
the only scope the rule can keep — the whole rule, because it carries no subject. Puzzle
activation **reads and is quiet** (1 high-margin slow mover against a floor of 2) over the
same 57 priced wines the plowhorse rule reads — `getMenuEngineering` classifies both from
one cost-known set and leaves the 61 unpriced wines unclassified for both
(`advanced-analytics.service.ts:185-250`). Sat 12 and Sun 13 have no till rows. Every
rule sentence is the rule's own template from `recommendations.service.ts` (`:151`,
`:191`, `:211`, `:229`, `:256`, `:283`, `:299`), not a rewording; the HHI prints as
`4686` because the code prints `toFixed(0)` with no separator.

## The three directions

### A · The Morning Letter — `direction-a.html`

**Idea.** The page **is** the letter the house will receive. One document, rendered
twice: on screen it is the letter read now; at the chosen hour it is the same letter
posted. The letter opens **delta-first** — *Since yesterday's letter*: what is new,
what was ruled off (and its result, or "no comparable data yet"), what was dismissed
(with its scope), which days carried no record — and only then *Standing*, filed by
the act (the docket survives as the order inside one section). The digest preference
is the **postmark**, printed where a letter prints its postage: posted daily at
07:00 Pacific · to · carries entries at "this week" and above · last post (with "whether
it was opened is not recorded") · next. An entry below the post's floor wears a
*not posted* stamp. The margin holds *What this letter withholds* (dismissed count,
below-floor count, the rule that could not read — named — and the quiet reading that
proves a clear line is a reading), the numbered *Sources*, and the catalogue as the
*Appendix*. The catalogue is the page's second leaf. The mail preview is a side sheet
with the letter drawn **on paper** (the declared exception, ADR 0104 D9) inside the
charcoal sheet. When the post is off (no preference row — every house today) the
postmark prints *off · no address · never*, with the gateway's stand-in hour marked as a
stand-in, and the headline says *Nothing is posted*: the page is still the letter, read
on screen; the post is its second surface.

**The clock, so every line agrees.** *Since yesterday's letter* means since Tue 07:00,
and the preview is **this morning's** mail, Wednesday's letter, headed *Since Tuesday's
letter*, subject *4 carried of 5 standing, 1 new*. The one new entry is about
**yesterday, Tuesday 15**: Tuesday sales 38% below the Tuesday average over six observed
Tuesdays (Jul 28 – Sep 1), with **Tue 8** out of the analysis (the house was marked
closed) — the ribbon underlines Tue 8 for it. Sat 12 and Sun 13 are hatched because the
till has still sent nothing for them; the 8-week weekday spread skipped them. The
postmark is drawn in **ink**, not seal — seal colour stays rationed to ruling off. In
Antalya, where nothing has ever been posted, the delta section is headed *Since your
last visit*, not *Since yesterday's letter*.

**Optimises for:** a reason to open the page today (the delta), and one truth on two
surfaces (what you read is what was posted).

**Costs.**
- *Exists:* the feed (`GET /analytics/recommendations/:rid`), first-fired from
  `recommendation_impressions` (`attachFirstSeen`, `recommendations.service.ts:527`),
  the history and actions reads, the digest GET/PUT above, `rulesEvaluated`
  (`recommendations.service.ts:92,132-138,500`) for the denominator, the three
  suppression scopes (`analytics/insights/suppression.ts`; labels and promises in
  `rec-format.ts:168-262`), the doors and their refusals (`rec-forward.ts`). The *not
  posted* stamp is client-side arithmetic over `digestMinUrgency` — free.
- *New:* (1) "since the last letter" needs `last_sent_at` to be written — which the
  sender being built will do — plus a small read that diffs the feed against the last
  post (or the last visit when nothing has been posted; the Turkish frame shows that
  fallback); (2) the mail renderer — the decision is whether page and mail share one
  component (recommended; it is the whole point) or the server templates its own; (3) a
  *result* on a ruled-off entry needs the outcome measurement 094c named — until it
  exists the line says "no comparable data yet, window closes …", which is honest and
  drawn; (4) **the sender's clock — OD-92** (`OPEN-DECISIONS.md:59`): every cron today is
  pinned to `America/New_York`, so "07:00 Pacific" and "08:00 TRT" are drawn as the
  intent, and the popover says so; per-tenant scheduling from `restaurants.timezone`,
  plus what the post does for a house whose timezone is null, is a founder decision the
  sender depends on; (5) **currency-aware rule sentences**: `recommendations.service.ts:211`
  and `:299` hard-code `$`, so Antalya's entries would read `$184,500` and `$41,200` today —
  the ₺ in the Turkish frame is a costed change, flagged on the frame, not existing
  behaviour.
- *Not proposed:* open tracking. "Whether it was opened is not recorded" is printed as
  a fact; recording it is a founder decision, not a default.

**Honesty traps handled.** A preview is not a post (the sheet's foot says so; the last
post is the record). Sent is not read. The recipient is never a fallback address — a
null `recipientEmail` renders *not posted* with no post ever made; no row at all renders
*off*, with the gateway's default hour marked as a stand-in. The post carries what
stands at 07:00, not now. Unobserved days are skipped, never $0 (the Wednesday baseline
sentence names them). "Withheld by dismissal: could not be counted" when the dismissal
store fails — never 0. A refused door prints its reason. A dismissal offers only the
scopes the entry can keep — the plowhorse entry offers *this rule entirely* and says why
*every Sancerre* is not on offer — and the day-exclusion is refused with the built
reason for an undated entry ("names no single day"). Every sentence carries a source
number; sources say their window and their clock (menu engineering 90 days; the HHI over
365 days of delivered orders, `analytics.service.ts:181,708`). The appendix relabels the
catalogue: *data present* ≠ computable ≠ sufficient.

**Founder questions it embodies.** Delta-first or state-first as the opening? One
renderer for page and mail, or two? Should the mail carry the sources or only the
links back? One recipient per house, or role-based recipients (a decision, not a
field)? Should open-tracking ever exist? When a past day is picked in the ribbon, is
that the letter *as posted* (a stored record) or *as recomputed* today (the same rules
over records that may have arrived late)?

### B · The Subject Accounts — `direction-b.html`

**Idea.** The unit is **the thing the finding is about**: a wine, a vendor, a weekday, a
server, or the house itself. Every subject gets an account — what stands against it,
what was done and when, what is silenced for it (with the scope), and what the engine
*could* tell you about it. The rail is the catalogue's own dimension list (overall ·
wine · vendor · day of week · server · table · daypart · venue feature), so the
catalogue is not a second page but the **second view of the same accounts**: switch the
view and the same rail filters 573 types instead of standing findings; pin an account
and the type list answers *for that wine* (which types wrote about it, and when). A
rule that names no subject files to **The house** and is never coerced onto the nearest
wine — the vendor-concentration entry says so on its face, and so does Antalya's dead
stock, which names its top wine only inside its sentence. The account opens in a side
sheet (standing · done · silenced · can be told · doors), and the dismissal's middle
scope — *this account* — is the sheet you are standing in. No account is opened by
absence: a rail count of 0 is a proven quiet and says so; a rail count of **—** is a
could-not-read (Servers: `staff_spread` had no server ids) and says that instead; a kind
**no rule can open** (tables, dayparts, venue features) prints *no rule*, never 0.

Five findings now land on **four** accounts — Barolo, Sancerre, **Tuesdays** (two
findings: yesterday's sales below its own baseline, and the weekday spread that makes it
the weakest day) and the house — which is B's idea shown working: two rules, one
subject, one account. Sancerre's cost price is **on the list** ($24.50), so its
below-median margin is measured, not assumed; the finding ranks plowhorses among the 57
priced wines and says the 61 unpriced are not counted, in the sheet and in the mail.
The pairing silence files to **The house**, because the rule carries no wine — the sheet
shows the *this account* scope B wants, tagged as the gateway change it needs. The
catalogue answer uses one set of numbers everywhere: 4 of 96 wine types built ·
91 not built · 1 unknown.

**Optimises for:** how a manager actually names a problem ("the Sancerre", "Tuesdays"),
a natural home for the dismissal scope, and a catalogue that answers per subject.

**Costs.**
- *Exists:* the suppression key shape `rule#subject#period` (`suppression.ts`; read back
  by `readKey` in `rec-format.ts:177-189`) and the scope labels — but **only two rules
  carry a subject today**: `sales_below_weekday_baseline` (`recommendations.service.ts:163`)
  and `weekly_demand_slide` (`:182`). The catalogue's `candidates[].dimension` is the
  rail. `GET /analytics/insights/:rid` (the stored insight feed, per the dossier) is
  where "wrote Sun 13 Sep about this wine" would come from.
- *New — gateway, not client:* (1) a `subject` (and `periodKey`) on the ten rules that
  carry none — `stockout_imminent`, `dead_stock_capital`, `plowhorse_repricing`,
  `puzzle_activation`, `vendor_concentration`, `revenue_concentration`, `weekday_gap`,
  `spend_acceleration`, `staff_spread`, `pairing_promotion` (`:186-330`) — without which
  `buildSuppressionKey` degrades every narrower scope to the bare rule
  (`suppression.ts:97-101`) and `scopeLabel` does not offer it (`rec-format.ts:218-236`),
  so the Barolo and Sancerre **accounts themselves**, not just their dismissal scope, are
  new work; (2) per-subject first-seen — `attachFirstSeen` (`:527`) is keyed per rule,
  so "wrote Sun 13 07:02" per account has no source today; (3) the same OD-92 and
  currency-aware-sentence items as A. *Client:* grouping the feed by subject, the
  per-entity join between insight rows and an account, the account sheet on the `Sheet`
  primitive.
- *Risk, measured:* the live tenant fires mostly house-level rules (page note §1b fifth
  pass: neither calendar rule fires on the live tenant; the vendor and revenue rules
  name no subject). On a real house this page may be two accounts and *The house* — the
  singleton-heading problem 094b already ran into, one level down. The Antalya frame
  draws exactly that: three findings, **one account**.

**Honesty traps handled.** *Vendors 0* is a proven quiet, *Servers —* is a
could-not-read, *Tables no rule* is a kind nothing can open — the rail prints a
different mark for each and says why, on desktop, in the catalogue view and under the
mobile chip row. In the Turkish house every till-dependent kind shows the em dash. "Done:
could not be read" is distinct from "Done: nothing yet" (partial state), and the card and
the sheet agree on what was done (Sancerre: snoozed Tue 15, woke early). A wine whose
cost is not on the list is not ranked as a plowhorse at all — the finding never assumes
a median for it. "Can be told" reads *—* when the catalogue call times out, never 0 of
96. Silenced findings are counted in the mail, never printed. On 1b, *The house 0* means
no account there first wrote that day — the house's standing vendor finding read and was
carried, and the note says so rather than calling it "did not fire".

**Founder questions it embodies.** Is the subject the right unit when most rules are
house-level — and is it worth a subject on ten rules to find out? Should the dismissal
default to the account scope here? Should the page's subject kinds and the catalogue's
dimensions be declared one taxonomy (today they coincide by accident)? Does an account
persist after its findings close?

### C · The Instruments — `direction-c.html`

**Idea.** Every rule that can write to this page is an **instrument** with a reading, a
threshold and a state, and the page shows **all of them**, not only the ones that fired.
Four tiers: **Sounding** (a standing entry under each, filed by its act, the docket's
controls intact; a collapsed row carries an *Open the entry* affordance; a **silenced**
instrument stays here, marked *Sounding · silenced*, with its entry withheld — it never
drops into the quiet tier, because a silence is not a proven absence), **Read and quiet**
(it read this house's records and the reading is under the line — the proof that
"clear" is clear), **Could not read** (no reading, so no needle; what is missing and the
door: map servers — the POS hub is *read*, so a connected till with an empty window gets
a different sentence), and **Not built** — which *is* the catalogue, so the catalogue is
the fourth tier of the same list, opened as a leaf because it is 549 rows (546 not built,
3 unknown). The post's floor is a dashed line drawn across the sounding tier. Every
reading opens to its sources (popover, 320); every instrument opens to its record (sheet:
eight weeks of readings with the threshold drawn, when it sounded, silences and the
scopes it can honour, why it is below the floor, and the printed refusal that the
threshold is the rule's own constant); the post opens to its four stored fields
(popover, 320). The mail carries the sounding instruments above the floor in order, the
quiet ones as one line of proof, the could-not-read named, the silenced one counted.

**The thresholds are the code's, cited to their line** (`recommendations.service.ts`):
stockout `> 0.4` (:190) · weekday baseline `effectPct < −0.08` (:148) · demand slide
`< −0.1` (:171) · plowhorse and puzzle `≥ 2` (:226, :240) · vendor HHI `> 0.4` (:253) ·
revenue Gini `> 0.6` (:265) · spend `> 0.3` at *this week* (:296) · staff spread
`> 0.15` (:312) · goals under 90% of linear pace (:362) · **dead stock fires on any
capital `> 0`** (:204) · **weekday_gap has no constant** — it fires whenever best ≠ worst
(:281) · **pairing_promotion has no constant either** — it fires whenever a basket insight
exists (:324-328). Three consequences are drawn rather than hidden: the weekday-spread and
basket-pairs rows have **no scale** (41% and "1 pair" are readings, not tests), and dead
stock is **Sounding** with its entry **ruled off** (Tue 15) — the instrument keeps reading
$6,140 while the act's outcome window runs to 29 Sep. So the page shows **seven sounding
(one silenced, one ruled off, five with a standing entry), six quiet, one could not read**.
The HHI example is arithmetic that computes (64 · 22 · 9 · 5 → 0.4686, 2.1 vendors,
printed `4686` the way `toFixed(0)` prints it) over **365 days of delivered orders**, the
window `getRiskProfile` actually reads (`analytics.service.ts:181,708`); revenue
concentration is a **Gini over on-hand stock at list price** (`unitPrice × qty`,
`:722-724`), which is why it reads in a house with no till.

**Optimises for:** the strongest honesty position in the product — a clear book is
thirteen visible readings, not a tick — and the tightest catalogue integration
(*not built* is literally the next tier).

**Costs.**
- *Exists:* fired rules and `rulesEvaluated`; the POS hub status
  (`pos-hub.controller.ts:71`, honest under failure); the catalogue's `implemented`
  and `available`; the suppression scopes; the thresholds as constants in
  `recommendations.service.ts` (`:190` stockout 0.4, `:253` HHI 0.4).
- *New, and the largest of the three:* (1) the gateway returns only rules that fired —
  `rule(key, fired, make)` at `recommendations.service.ts:133-139` pushes nothing for a
  quiet rule — so *reading · threshold · state* for quiet and could-not-read
  instruments is a new field on the feed and a change to each rule's condition so it
  exposes what it measured; (2) a per-rule *could not read* reason (today only the
  count of evaluated rules is exposed); (3) eight weeks of readings needs a stored
  reading per run — a new table — or a recompute over windows on demand; (4) the
  threshold-in-the-sheet refusal is free, but the question it raises (house-settable
  thresholds) is not; (5) the same OD-92 and currency-aware-sentence items as A.
- The two-catalogues line is printed rather than solved: the twelve rules plus goal
  instruments and the twenty-four built insight types are different code paths
  (`recommendations.service.ts` · `insights/insight-implementations.ts`); the leaf says "would
  feed" where one is the other's arithmetic and "no link recorded" otherwise.

**Honesty traps handled.** No needle without a reading (hatched track, em dash). Quiet
is shown with its reading, so a silence and a proven absence never look alike — and a
silenced instrument is never counted as quiet. The hub unreadable → the could-not-read
tier says it cannot tell *why* and names neither cause. The dismissal store unreadable →
"silences: unknown", not 0, and the entry is shown rather than withheld on a guess. A
dismissal offers only the scopes the instrument can keep (`weekday_gap` names Tuesday
inside its sentence only; *every Tuesday* is not offered and the row says why). Meters do
not animate on load — `tally` would make a reading perform.

**Founder questions it embodies.** Do quiet instruments belong on the page at all
(proof, or noise)? Should thresholds become house settings? Should the rules and the
insight types become one list? Is a stored reading per run worth a table? Is the page
still "what to do as action" when its spine is the instrument rather than the act?

## Common to all three

- **Catalogue as a view, read-only.** A: a leaf of the letter. B: the second view over
  the same rail. C: the fourth tier, opened as a leaf. All three use four words on every
  row — *built · data present · missing (names what) · not built* — plus *unknown* when
  the API omits `implemented` (trap 7 in the dossier), and all three print the
  relabel: data present means the tables a type reads hold rows for this house, not
  that there are enough of them (sufficiency is fork F10.6, undecided). No watch, no
  mute (F10.5a). **The counts never fold the unknowns into a state**: 573 = 24 built +
  546 not built + 3 unknown, and the day-of-week head reads 0 built · 47 not built ·
  1 unknown. The data-present figure is **412 in Palo Alto** — an example figure for a
  house with a till, labelled as such on the page (24 built + 386 not built + 2 of the
  3 unknown, so the chips and the head reconcile) — and **132 in Antalya**, which is the
  reach suite's measured rung for consumption + orders + inventory with no POS
  (`insight-catalog.reach.spec.ts:69-72`; the sketch's first draft had the rungs on the
  wrong houses).
- **Ribbon.** The strip the founder "liked a lot" is decided as a ribbon (094) and
  drawn in each file under the leaves: sixteen days (**thirteen back, today, two
  ahead** — Thu 3 to Fri 18), a legend adapted from the built one (`Ribbon.tsx:159-164`),
  and three day-states that must never collapse into one — Sat 12 and Sun 13 hatched
  because the till sent nothing (not a zero), **Tue 8** underlined because the weekday
  baseline put it out of the analysis, and the two days ahead dashed because they have
  not happened. First firings are marked on the same days in every file: Sat 5
  (plowhorse), Sun 13 (Barolo, 06:57), **Mon 14 (pairing)**, Wed 16 (the baseline); Tue 15
  carries three deeds (dead stock ruled off, pairing dismissed, Sancerre snoozed). The
  three ribbons are **not** the same drawing: A's days are letters, B's are account
  dots, C's are 14-reading stacks whose proportions follow the tiers (see ask 1 above).
  Each file has a **1b frame with Sun 13 selected**, in a selected style (ink ring,
  caret) distinct from today (seal ring), showing what selection does in that identity
  and, for A, the refused case (no stored post before Mon 7). No *falls due* marker is
  drawn in the window because nothing falls due in it — the built strip's *due* is only
  a goal deadline or a snooze waking (`Ribbon.tsx:181`), the goals close 30 Sep and the
  Snoozed leaf is 0; the legend keeps the item because the built legend has it. On
  mobile it folds to seven days (Fri 11 – Thu 17, so a no-till day and a future day are
  on screen) and the caption names what is off-screen (Sat 5, Tue 8, the days before the
  post). The Antalya, overlay and catalogue frames leave the ribbon out so each stays on
  its own subject — a narrowing, not a claim that it is absent there.
- **Digest.** The stored fields are the only fields drawn; the popover is a plain write
  with no seal (the goal-scenario precedent, `analytics.controller.ts:527-529` per the
  dossier); the mail is on paper; "a preview is not a post"; the floor produces a *not
  posted* stamp on the page; a null recipient means not posted, never a fallback; **no
  row means off**, drawn as its own state tile in each file with the gateway's stand-in
  values (`digestHour 7 · digestMinUrgency this_week`) printed as stand-ins. **The hour is
  not yet the house's clock — OD-92** — and each popover says so. **Two homes for one
  preference:** sketch 109 (settings, row 26; `109-settings-directions-2/README.md:32,149`)
  also draws the digest preference editor in `/settings`; this sketch puts it in the
  page's postmark popover. Which is canonical, or whether one links to the other, is a
  founder fork neither sketch decides.
- **Dismissal** asks scope per dismissal (decided): the three scopes from
  `scopeLabel`/`scopePromise`, **only the scopes the entry can support** — today a
  subject scope exists only on the two baseline rules, so the plowhorse (A), weekday_gap
  (C) and pairing dismissals offer *this rule entirely* and print why the middle scope is
  not on offer; B draws the middle scope as its proposal and tags it with the gateway
  change it needs — the day-exclusion checkbox drawn *refused* with the built reason
  (`Entry.tsx:1012-1013`: an undated entry "names no single day"; the store-unreadable
  refusal belongs only to a dated entry), the promise sentence rewritten in place.
- **Overlays** per ADR 0112: side sheet 440 for one object (the mail, an account, an
  instrument), popover for a choice (the post, a reading's sources), the dismissal
  inline with no motion (MOTIONS.md). No scrim (sketch 103, The Pass).
- **Motion**: `ink` 160 · `settle` 320 · `tuck` 300 only; `prefers-reduced-motion`
  removes all of it; nothing counts up; the seal stays rationed to ruling off.
- **Locale**: the Turkish house prints TRT, dd.mm.yyyy dates and ₺ in the rule
  sentences — **the ₺ is drawn, not existing behaviour**: `recommendations.service.ts:211`
  and `:299` hard-code `$`, so today the house would read `$184,500` and `$41,200`; the
  Antalya frame in each file says so, and currency-aware sentences are in every
  direction's cost. The UI language stays English because the product has none other
  today. Its spend finding reads **+34%** and files at *this week*, because the code
  fires only above +30% and at that urgency (`recommendations.service.ts:294-306`); its
  floor is *this week*, so 1 of its 3 standing entries would be carried — if it had an
  address. Its three findings all file to the house in B (none of the three rules
  carries a subject).
- **The denominator is one sentence in all three:** *14 rules evaluated (12 rules + 2
  goals) · 13 read · 1 could not read · 5 stand*. `rulesEvaluated` counts the twelve
  named rules plus up to three goals (`recommendations.service.ts:133-139, 340-362`);
  the live measurement was 15 (`recommendations.md:630`); the built page's fixture uses
  17, which is where the earlier draft's number came from and why it is gone. The
  empty-state headline reads *Thirteen instruments read (11 rules + 2 goals), none
  stands*, so the goals are not counted as rules.
- **Mobile frames never drop items silently.** Where a frame cuts a list it says so in
  a *N more — …* row (A's entries 03 and 04; B's fourth account; C's two sounding
  instruments below the fold and two on-pace goals), **both doors stay on every entry
  drawn** — short labels, *Goal · Reports*, with the refused ones dark and their reason
  printed — and the scrolling chip rows fade at their right edge.
- **Captions use `--ink-4` on both grounds.** ADR 0042's token table, amended 2026-09-16
  for OD-112 (`0042-iznik-seal-and-warm-charcoal.md:42`), marks `--ink-3` *decorative
  only; never a caption*. The first draft used `--ink-3` for about forty caption rules
  per file on the charcoal page; every caption, legend, note, table head, disclosure and
  label colour has been swept to `--ink-4`, and `--ink-3` remains only on rules, borders
  and glyph strokes (`grep -o 'var(--ink-3)'` in each file now returns only `background`
  and `border` uses). The paper mail's captions were already `--ink-4`.

## Recommendation

**Build A as the page's identity. Graft C's *Read and quiet* tier into A's margin as
the proof beneath *What this letter withholds*, and take B's account sheet as what a
subject opens into — if the founder decides to give the rules subjects.**

Why A: it is the only direction whose uniqueness is a *behaviour* rather than an
arrangement — the page is what arrives in the inbox, and what arrives is what stood —
and it turns today's decision (the sender) into the page's reason to exist instead of a
toggle in a corner. It is also the cheapest to make true: the sender must render these
sections anyway, so one renderer on two surfaces costs less than two that drift. It
keeps the decided docket as the order inside *Standing* rather than re-drawing it, and
delta-first answers the question neither prior round answered — why open this page
today. The ribbon also means most in A: a day *is* a letter, so "select and see" — his
words for the strip — reads a whole morning back, not a filter over a list.

Why not C as the spine: it is the most honest surface here, but its centre —
readings for rules that did not fire, and a reading history — is a gateway change the
founder has not asked for, and it moves the page's spine from the act to the rule,
against his own "understand what to do as action". Its quiet tier is worth having; it
does not need to be the page.

Why not B as the spine: it is the most natural home for the dismissal scope and the
catalogue, but its unit does not exist in the gateway yet — ten of twelve rules carry no
subject, so the accounts are a gateway change before they are a page — and on a real
tenant most rules are house-level and the accounts run thin (the Antalya frame is one
account). Its sheet is the right object for a subject and survives the graft, once a
subject exists.

**What the recommendation costs.** "Build A" is not free of the other two, and the
grafts are the exact gateway changes given as the reasons not to build C or B as the
spine — so they are stated here rather than implied:

- *A alone:* the sender writes `last_sent_at` (it must anyway); a diff of the feed
  against the last post (or the last visit); one renderer on two surfaces (the page and
  the mail); the *result* line on a ruled-off entry waits on the outcome measurement
  094c named and says "no comparable data yet" until then; a stored post per day so a
  past day reads *as posted* (the 1b frame) — a new table or a mail archive, small;
  **and two dependencies the founder must decide before the sender's first post is
  honest: OD-92** (per-tenant scheduling from `restaurants.timezone`, and what the post
  does when the timezone is null) **and currency-aware rule sentences**
  (`recommendations.service.ts:211,299`), without which the Turkish house's letter would
  print dollars.
- *The C graft (Read and quiet in A's margin):* the two items C's own cost list calls
  the largest — a new field on the feed carrying *reading · threshold · state* for
  rules that did not fire, which means changing each rule's condition at
  `recommendations.service.ts:133-139` so it exposes what it measured, plus a per-rule
  *could not read* reason. **Not** taken: C's eight-week reading history (a stored
  reading per run, the table C's sheet needs); the graft is today's readings only.
- *The B graft (the account sheet):* **a gateway change first** — a `subject` (and
  `periodKey`) on the ten rules that carry none (`recommendations.service.ts:186-330`),
  and first-seen keyed per subject rather than per rule (`attachFirstSeen`, `:527`) —
  and only then the client work: the per-entity join between insight rows and a
  subject, a client-side group of the feed by subject, and the sheet component on the
  `Sheet` primitive. The first draft of this README called the graft "no new endpoint";
  that was wrong, and the critique caught it.

Three of those are founder forks, not defaults: whether the gateway should expose
quiet readings at all (it changes every rule); whether a subject is a first-class
object worth putting on ten rules, on a tenant where most rules are house-level; and
where the digest preference lives (this page's postmark, `/settings` row 26 in sketch
109, or both with a link). **If the first two are declined, A still stands on its own** —
the margin box then prints only what it can (dismissed · below the floor · could not
read, named), which is what the A file draws today.

## Screenshots

`shots/direction-{a,b,c}-1440.png` (full page, desktop) and
`shots/direction-{a,b,c}-390.png` (the mobile frame). Re-rendered 2026-09-17 with
`p4-scratch/render-sketch.mjs` after the second critique was applied: each of the six
runs reported `errors: []` and `horizontalOverflow: false` (A 10334 · 2587 px, B 10332 ·
2607 px, C 11485 · 2708 px). Every full-page PNG was cut into fold-sized bands and every
band was read; the C sparkline's end label, the ₺ meter label and A's facts row no
longer collide, and the five-tile state strip fits at 1440.

Re-rendered again 2026-09-17 (revision 3 pass, below): all six runs still report
`errors: []` and `horizontalOverflow: false` (A 10334 · 2587 px, B 10332 · 2626 px, C
11504 · 2708 px). Every full-page PNG was cut into ~1700px desktop / ~1400px mobile
bands with a python/Pillow script (not committed — the render script itself only bands
above Chrome's 16384px cap, which none of these three hit) and every band was read with
the Read tool. No broken layout, overlap, or contrast fault found on either ground.

## Revision 2026-09-17 — first critique applied

Twenty findings (nine major) against the first draft, all applied in the three files
and this README; the substantive ones, so the founder can see what moved:

1. **One clock.** Read Wed 16 06:58 · last post Tue 15 07:00 · next
   *today 07:00, in two minutes* · delta = since Tue 07:00 · the preview is
   Wednesday's letter headed *Since Tuesday's letter*. B's and C's mail headers match.
2. **The sales finding is about yesterday** — Tuesday 15 against six observed
   Tuesdays, Tue 8 out of the analysis — in all three files, the ribbon, the sources,
   the mail. The headline count is *one* new entry, matching the delta and the subject.
3. **C's thresholds are the code's**, cited by line; dead stock moved to *Sounding*
   with its entry ruled off; weekday_gap lost its meter; staff_spread shows 15%; the
   Turkish spend reads +34% at *this week*; the quiet line in the mail and the empty
   state recomputed; the HHI shares, the spark sequence and the Sunday axis compute.
4. **B's numbers agree with themselves**: four accounts, no "blocked built type" on the
   Barolo card, Sancerre's cost on the list so the plowhorse claim is measured,
   *Servers —* on every rail and chip.
5. **Selection is drawn** (frame 1b in each file), the three ribbons are three
   drawings, the mobile fold shows a no-till day and a future day and names what is off
   screen, and dropped mobile items are announced in *N more* rows.
6. **The recommendation states its cost**, the postmark is ink not seal, the popover is
   320, source 1 names the real computation (stockout probability from the wine's own
   demand variance, `recommendations.service.ts:196`), and the denominator is *14
   evaluated (12 + 2)* in every frame.

## Revision 2 · 2026-09-17 — second critique applied

Twenty-one findings (nine major), all applied; what moved, and where the first draft
was wrong against the code:

1. **The doors are the built logic's.** Barolo's goal door and the vendor entry's goal
   and reports doors are refused with the words of `GOAL_REFUSAL` and `CUTTING_REFUSAL`
   printed under the controls; every dark door, Day-book included, prints its reason
   (no reason lives only in a `title`). B's mobile entries now carry both doors.
2. **Scopes the gateway can keep.** Only the two baseline rules carry a subject. A and C
   now offer *this rule entirely* on the plowhorse and weekday_gap dismissals and say
   why the middle scope is absent; the pairing dismissal is at rule scope in every file
   and files to the house in B; B keeps its account scope as a proposal, tagged with the
   gateway change, and its cost line and the recommendation now name a subject on ten
   rules plus per-subject first-seen as a founder fork. "Wrote Sun 13" per account is
   flagged as keyed per rule today.
3. **Puzzle activation reads.** It classifies from the same cost-known set as the
   plowhorse rule, so it is quiet (1 against 2), not could-not-read. The only
   could-not-read is `staff_spread`; the denominator is *13 read · 1 could not read*
   everywhere, the dismissed count is one, and the empty headline counts 11 rules + 2
   goals.
4. **A silence is not a quiet.** C's pairing instrument is *Sounding · silenced* above
   the floor with its reading (1 pair) and no scale (the rule has no constant); the
   quiet tier is six with puzzle in it; the mail counts the silence apart from the proof
   line.
5. **The post-off state** (no preference row, which is every house today) is a fifth
   state tile in each file; **OD-92** is in every popover and in every cost list; the
   **₺ sentences are flagged as a costed change** (`:211,299` hard-code `$`) on every
   Antalya frame and in every cost list.
6. **Sources are the code's:** the HHI window is 365 days of delivered orders
   (`getRiskProfile`), the Gini is over on-hand stock at list price, menu engineering is
   90 days; the prescriptions are the rule templates verbatim; the HHI prints `4686`.
7. **Counts reconcile:** 546 not built · 3 unknown (never folded into a state); 412 data
   present in Palo Alto as a labelled example, 132 in Antalya (the measured no-till
   rung); the day-of-week head reads 47 not built · 1 unknown; B's wine kind reads 91
   not built · 1 unknown.
8. **Cross-file agreement:** pairing first fired Mon 14 (marked on every ribbon; Tue 15's
   post carried four); Barolo first fired Sun 13 at 06:57 in B and C; B's Sancerre card
   and sheet agree on the Tue 15 snooze; Antalya's dead stock files to the house with the
   engine's sentence; the day-exclusion refusal on an undated entry is the built one.
9. **Words and marks:** A's subject is *4 carried of 5 standing, 1 new*; Antalya's delta
   is *Since your last visit*; B's rail prints *no rule* for kinds no rule can open and
   its 1b note no longer calls the house's standing finding "did not fire"; `--ink-3` is
   gone from every caption on the charcoal page.
10. **Visual collisions** fixed: the sparkline end label is right-anchored inside the
    sheet; the ₺0 / $0 meter labels are separated from the constant's caption; A's facts
    row does not wrap; collapsed sounding rows in C carry *Open the entry*; the empty
    tile's mini rows no longer overlap.

## Revision 3 · 2026-09-17 — critic re-check + the founder's style bar

A design critic's pass (21 findings, 9 major — doors drawn live where the built logic
refuses them; subject scopes the gateway cannot key on; `puzzle_activation` shown as
could-not-read; `--ink-3` on captions; B's mobile doors and Sancerre self-contradiction;
C's silenced pairing counted as quiet; the missing post-off state; `$` where the frame
claims `₺`; plus twelve minor counting/sourcing/wording/visual-collision items) was
handed to this session to apply. **Checked each of the 21 against the files as they
stand and all 21 already hold** — they were fixed by Revision 2 above; nothing in that
revision's log overstated what moved. Evidence, spot-checked by grep and by reading
every screenshot band (not just the changed lines):

- Doors: Barolo's goal door and the vendor-concentration entry's goal and reports door
  are `btn dark disabled` with the `GOAL_REFUSAL`/`CUTTING_REFUSAL` wording printed in a
  `<p class="refused">`, in all three files, desktop and mobile (`direction-a.html:347,
  383, 623, 797`; `direction-b.html:295, 348, 389`; `direction-c.html:322, 597`).
- Scopes: only `plowhorse_repricing`/`weekday_gap`/`pairing_promotion` offer *this rule
  entirely*, tagged with the reason the middle scope is absent; B's account scope
  carries `B's proposed scope: needs a subject on … (gateway change, README)`
  (`direction-b.html:465`); dead stock files to The house with the engine's own sentence
  (`direction-b.html:535`).
- `puzzle_activation` reads (1 vs a floor of 2) over the same 57 priced wines as the
  plowhorse rule in all three files (`direction-a.html:395`; `direction-c.html:432,
  665`) — never "could not read".
- `var(--ink-3)` remains only on borders, swatches and rule strokes (8/5/6 uses across
  A/B/C, all in `.lt`, `.rb-legend .sw`, `.postmark .stamp` and siblings) — zero caption
  uses; captions are `--ink-4` throughout, on both grounds.
- B's mobile frame carries `Goal`/`Reports` on every entry (`direction-b.html:668-671`);
  its rail prints `no rule` for Tables/Dayparts and `—` for Servers, not 0
  (`direction-b.html:665`).
- C's pairing instrument sits in **Sounding** (`Sounding · silenced`, 7 of 14), not in
  **Read and quiet** (`direction-c.html:374, 377`); the quiet tier is 6.
- The post-off state (no preference row) is its own state tile in all three files
  (`direction-a.html:731`, `direction-b.html:638`, `direction-c.html:778`).
- Every Antalya frame flags the ₺ as a costed change against the `$`-hardcoded
  sentences, in the frame note and the cost list, in all three files.
- Counts reconcile (546 not built · 3 unknown everywhere; day-of-week head 47 not built
  · 1 unknown, `direction-c.html:697`); sources cite 365-day HHI and Gini over on-hand
  stock everywhere; prescriptions are the rule templates verbatim (`5–8%`,
  `renegotiate cost`, `10–20% of volume`); the day-exclusion refusal is the built
  no-single-day reason, not a store-unreadable one; pairing carries no scale, not an
  invented `≥ 1 pair` threshold; the ribbon marks pairing's first firing on Mon 14 in
  every file; the sparkline end label, the ₺0 meter label and A's facts row do not
  collide in any rendered band.

**One thing the critic did not catch, found on this pass:** three instances in
`direction-a.html` (Barolo, the sales-baseline and the plowhorse entries) printed the
Day-book refusal as *"drawn dark here so the founder can see the door he asked for and
why it stays shut"* — sketch-process language about the founder's own ask, sitting
inside what is meant to be the product's own refusal copy. B and C had already been
written the clean way, *"drawn dark here so the door and its reason are both visible"*
(`direction-b.html:295, 310, 326`; `direction-c.html:322`). Fixed A to match, three
instances (`direction-a.html:347, 356, 365` — file re-rendered, heights unchanged,
`errors: []` on both viewports).

**The founder's 2026-09-17 style bar** (people-facing pages read simpler than the
`08-technical`/admin register; fewer words on the surface, one clear primary act per
view, generous spacing, honesty states kept but quiet, no rationale printed as copy —
read against Wave Four, "The Arrival, Five Ways" and the Documents and Reports Redesign
artifact, and sketch 104's `direction-c.html` on `feat/mudavym-new-pages`) was checked
against what is already built here, not re-derived from scratch:

- All three files already carry the same three-tier type hierarchy those references
  use — a prominent serif claim (`.obs`, 16.5px), a secondary "what to do" line (`.do`,
  13px `--ink-2`), and caption-level honesty/refusal text (`.refused`, `.why`, 11px
  `--ink-4`, `max-width:720px`) — the same register sketch 104 uses for its `.lede` /
  `.ln` / `.note` stack. That register is not new work; it predates this pass.
  Confirmed by CSS (`grep -n "\.refused{" direction-*.html`), not asserted.
- **One clear primary act per view holds**: every entry has exactly one
  `btn seal ink` (the bordered, filled primary) against several `btn ink` (bordered,
  unfilled) secondaries — checked across every entry in every band read for this pass.
- **The one real gap against the bar, and why it was not chased further here:** the
  page is still dense relative to "The Arrival" — every entry prints a full refusal
  sentence for doors that are *not* refused, not only the refused ones (e.g. "Make this
  a goal is held on wine revenue, at least. See it in reports draws…" on an entry with
  no refusal at all). Cutting that would trim real surface area, but it is the exact
  content the *first* critique demanded stop hiding in a `title` attribute — the
  honesty-trap fix and the "fewer words" bar pull against each other here, and which
  one wins is the founder's call, not a default this pass should make silently. Flagged
  as an open question below rather than cut.
- No ADR 0149 violation found: no light/dark toggle is drawn (the file renders one
  ground, `data-ground="charcoal"` on the app shell, `"paper"` only on the declared-
  exception mail sheet per ADR 0104 D9); no sidebar or floating agent button is drawn,
  consistent with 090/094 and row 33's WineAgentFab removal.

**Founder question this pass surfaces, not decided here:** should the non-refused half
of each door's explanation ("held on wine revenue, at least" / "draws the same
register") move to a hover/disclosure instead of sitting in visible text on every entry
— trimming the surface toward the style bar — or does it stay visible because the first
critique specifically asked for reasons in words, not behind an interaction? The refused
half (the actual honesty trap) is not in question either way.

## What I could not verify

- No dev server was run; every claim about endpoints and fields is read from source
  (`analytics.controller.ts`, `recommendation-actions.service.ts`,
  `recommendations.service.ts`, `advanced-analytics.service.ts`, `analytics.service.ts`,
  `suppression.ts`, `rec-format.ts`, `rec-forward.ts`, `Entry.tsx`) or cited to the
  dossier (`p4-scratch/ux/recommendations-catalog.md`), not measured against a live
  gateway.
- The per-house catalogue figures are example data: **412** in Palo Alto is invented to
  sit above the measured no-till rung, because a house with a till has no rung in the
  reach suite (it measures 34 · 132 · 573 only); **132** in Antalya is the suite's rung
  for consumption + orders + inventory (`insight-catalog.reach.spec.ts:69-72`). Neither
  is a live `coverage` payload, and the split of the 3 unknown rows (2 with data present,
  1 without) is chosen so the chips reconcile, not read.
- The founder's "view of /recommendations" ruling is relayed (F10); this sketch draws it
  three ways and does not record it.
- The ribbon's day-states are example data made consistent with the entries (Tue 8
  out of the analysis; Sat 12–Sun 13 no till rows; Barolo first fired Sun 13 06:57; the
  pairing first fired Mon 14; the post began Mon 7) — drawn, not read. A past day's
  letter *as posted* has nothing to read from until the sender writes a post; C's past
  run has nothing to read from until a run is stored; both 1b frames draw the control and
  the shape of the record, not a read. C's stack proportions per day follow the example
  tiers and are not measured.
- The thresholds and the refusal texts are cited to `recommendations.service.ts` and
  `rec-forward.ts` line numbers as of this worktree (`feat/mudavym-finish`); they move
  when the files do.
- Whether the digest hour will be per-tenant (OD-92) and whether the rule sentences will
  become currency-aware are open; the sketches draw the intent and say so on the frame.
