---
sketch: 109
name: settings-directions-2
question: "Three genuinely different ways to organise a house's settings — by certainty, by time, or by who obeys them — now that the hours, the sender mapping, the digest and the assistant all have to live here?"
winner: null
tags: [settings, provenance, config-assistant, seal, operating-hours, notification-categories, refusal, digest, blast-radius, charcoal, no-theme-toggle]
---

# Sketch 109 · Settings, drawn again three ways

## Design question

The founder on `/settings`, 2026-09-03: **rework**. On 2026-09-16 (ADR 0149 row 21):
*"Sketch all three again"* — two or three new directions for his review. Sketch 091 drew
the single-page scroll against the vendor-terms register; the built page
(`apps/web/src/pages/settings/next/`, sixteen ids in five groups, one register open at a
time, a provenance line under every row) is the Editorial that was kept and then judged
not enough.

So this sketch does not draw three skins of the register. It draws three different
**organising principles** for the same estate, and every one of them carries what was
decided on 2026-09-16 (ADR 0149 rows 6, 8, 14, 15, 22, 26):

- the light/dark toggle is **retired** — charcoal on every page, declared paper surfaces
  only (ADR 0138); the page says so where the switch used to be;
- the analytics consent panel is **deleted** — the page says plainly that no analytics
  consent is collected yet;
- the **operating-hours editor** (legacy only, `components/settings/OperatingHoursSection.tsx`)
  gets a Mudavym home here;
- **seven recipient lookups** each mapped to one notification category; an unmapped
  category is **refused** — drawn refused, counted, never guessed (OD-121);
- the **recommendations digest** preference, with the sender built (row 26);
- the contact address **support@mudavym.com**;
- the assistant **proposes**, the seal **applies** (ADR 0113, sketch 101);
- provenance per field: **manual · confirmed · inferred · —** (em dash: not stated, not
  defaulted).

## How to view

```
open .planning/sketches/109-settings-directions-2/direction-a.html
open .planning/sketches/109-settings-directions-2/direction-b.html
open .planning/sketches/109-settings-directions-2/direction-c.html
```

Each file renders from `file://` at 1440 with no server, then a Turkish house where
currency and locale matter, the overlays the page opens drawn open (every direction now
draws two: its own, and the hours editor or the seal it would otherwise only name), a
strip of the four key states (empty · loading · refused · partial), and a 390 px
rendering. Screenshots of every file at both widths are in `shots/`
(`direction-a-1440.png`, `direction-a-390.png`, …) — A's and C's 390 renders pass 16,384 px
(21,709 and 20,266 px tall) so `render-sketch.mjs` captured and stitched them in 8,000 px
bands itself (its own guard against the silent top-of-page repeat Chromium produces past
that height); each file is still one whole, correctly-stitched image. Fonts load from
Google Fonts in the
sketch; **the product self-hosts every face** (ADR 0149 row 9). The hold-to-approve
controls and the disclosures are live; motion is the seven tokens of
`lib/mudavym/motion.ts`, with one disclosed exception: the loading skeleton's sheen,
which runs **two cycles and then holds still** — sketch 105 rule 11's road, carried by
ADR 0134 (Proposed) — and `prefers-reduced-motion` stops it and collapses the hold to a
two-step confirm exactly as `HoldToApprove.tsx` does.

**One fact all three had wrong on the first pass.** Every scheduled sender is a cron
constant with `timeZone: "America/New_York"` (`scheduled-tasks.service.ts:195,229,408,
523,626,680`). The first drawings placed them as if 09:00 in New York were 09:00 in the
house. For Palo Alto the six run at **06:00, Mon 05:00, 05:00, 14:00, Mon 04:00, 05:00**
(PDT, −3 h); for Istanbul at **+7 h** — 14:00 to 16:00 in the afternoon service and the
delivery ETA at midnight. Every direction now converts them into the house's clock and
labels them *fixed by the server in America/New_York*; nothing prints a New York hour as
the house's own.

## The rule all three propose

> **A setting's position on the page is fixed; its certainty is a stamp, never the sort.**
> An answer is *manual* (a named person typed it), *confirmed* (an inference or a proposal
> a person accepted — sealed), *inferred* (worked out from the house's own books, computed
> on read, never written down) or an em dash (not stated, and not defaulted). A refused
> read is none of these and is never counted as one.

## The three directions

### A · The interview — organised by certainty (`direction-a.html`)

**The idea.** The page is the list of everything the house has been asked about itself,
in a fixed interview order (I The house · II What it carries · III How it buys · IV What
it may do on its own · V Who is here · VI Yours · VII The record). A tally strip at the
top — 46 questions · 9 unanswered · 6 inferred · 3 proposed · 5 confirmed · 23 manual —
doubles as the filter. The assistant's line sits under the tally: *tell the house
something, or ask it to fill in what it can*; it proposes, the seal applies, and a
question a person has already answered is never batched — it is contested on its own
(ADR 0113 attempt 1). The rail is *Waiting on you*: proposals to seal, inferences to
confirm, unanswered questions, refused senders.

**What it optimises.** Completeness of the house's self-knowledge and the assistant's
workflow. "Missing is not zero" is the page's structure, not a footnote: an unanswered
question is a row with an em dash and an *Answer* control, an inferred one is italic with
its evidence count and a *Confirm*, a proposed one waits for the seal. The centred panel
(ADR 0112: a question) carries the proposal with reason · current · proposed per row, two
**dropped** rows (carrying cost — the assistant refuses to guess what the house's money
costs; the manager's ceiling — already stated, so contested separately), the seal, and the
per-item receipt after it (written · written · not attempted — the mapping table is not built).

**What it costs.** On the read side, the fourteen reads exist (`useSettingsNextData.ts`)
and the client stitches them into questions — or one `GET /settings/questionnaire` if the
stitch proves slow. The write side is ADR 0113's build order, not this sketch's: the
settings-register allowlist on `POST /ask-ai/propose`, the batch seal with per-item
outcome, the seven-day batch undo — B needs this too for its till proposal, and so does
C wherever it draws a seal (its 3b). **One cost is new, and it is shared, not A's alone:**
the hours-from-till inference (median first and last check per weekday over `pos_checks`)
is a new read-time computation with no endpoint; B draws the identical result as its
empty-state proposal and C's Istanbul row assumes it already ran, so all three directions
need it, not A only. The register inferences A prints are **not** a new cost for anyone —
`GET /cellar/:id/registers` already returns `decidedBy: 'inferred'` with confidence and
basis (`cellar-registers.ts:38,446-464`), the engine's own words — *certain · likely ·
none · unknown* — and B and C print the same inference from the same endpoint. *Confirm*
on an inference writes through the existing `PUT /vendor-terms/:providerId` and `PUT
/cellar/:id/registers`. The hours editor A's row opens is B's day sheet, drawn in A as
section 3b so that A stands on its own; it is the same `PUT /restaurants/:id/operating-hours`
and the same validator strings (`operating-hours.ts:197-211`).

**Risk.** A new taxonomy (seven interview sections) replaces the five intent groups the
fourth pass settled on; findability rests on the fixed order, the contents rail and the
`?tab=` → section map. Forty-six rows is a long page; the filter chips are load-bearing.

### B · The week — organised by time (`direction-b.html`)

**The idea.** The page opens on the house's week: the operating hours as bands on a
seven-day grid (a 24-hour axis from 03:00, Monday first, a Friday range crossing
midnight), with everything else time-shaped laid over them as layers — vendor cutoffs (a
stated one is a line, an inferred one a hatched bracket), delivery days as chips on the
day headers, the seven senders (the six server-fixed hours drawn grey in the house's
clock, the refused one crossed, the proposed one dashed, the event-driven low-stock alert
as a dotted *any hour* rail), your quiet hours hatched and your digest hour as a hollow
mark on the other side. Under the grid, three sentences read off it (*Sysco's cutoff falls
before you open* · *five of the six senders fire inside your quiet hours*), and a line
names what is **not** drawn because it is not stated and what is drawn but not the
house's. Beneath, *The book*: everything that is not a time, as a two-column entry list,
each opening as a sheet — and under the book, the seven-sender mapping table itself,
with its refused row.

**What it optimises.** The operator who runs a week. The hours editor is the centre of
the page rather than a register among sixteen, and a cutoff-versus-hours conflict is
visible without arithmetic. The right sheet (ADR 0112: one object) edits one day — up to
three ranges, a closed toggle, the vendors and senders that touch that day, and a save
failure quoted in the validator's own words (*tue: ranges overlap or are unsorted
(17:00-23:00 then 22:30-23:45)*) with the server's values kept on screen. Four states the
legacy editor held apart are kept apart: loading, failed, **not set** (seven em dashes,
never seven empty days) and closed all week; an unrecorded timezone refuses the grid,
lists the hours as text, and offers a select whose first, disabled option is *Choose the
house's zone* — nothing is preselected. The second overlay is the proposal from the till
with its hold-to-seal (ADR 0113), drawn from the empty state.

**What it costs.** Hours: `GET/PUT /restaurants/:id/operating-hours`
(`operating-hours.controller.ts:38,56`, null survives the round trip, timezone never
defaulted). Cutoffs and brackets: `GET /vendor-terms`. Quiet hours and the low-stock
digest: the notification preferences row. The digest hour: `GET/PUT
recommendations/:id/digest` (`analytics.controller.ts:1143-1153`). The senders' hours are
`@Cron` constants in `scheduled-tasks.service.ts:193-736`, every one in `America/New_York`
and **not** per-house — converted to the house's zone on the client, drawn grey and
labelled *fixed by the server in America/New_York*; making them editable is a per-house
schedule the backend does not have. The quiet-hours callout is honest about what the
window holds: it is read by the Python chooser (`notification_agent.py:1448,1487`) and the
six gateway senders never pass through it (`recipient-resolver.service.ts` has no
quiet-hours read). The callouts are client arithmetic. **B is not free of A's two shared
costs:** the empty state's proposal is the same hours-from-till inference (median first
and last check per weekday over `pos_checks`, no endpoint yet), and its second overlay's
hold-to-seal is ADR 0113's write side — the same batch seal with per-item outcome A needs.
What B genuinely avoids is C's last-run table: nothing in B's drawing needs a run row per
sender.

**Risk.** It halves the estate: the week is a page, the book is a list. Team, thresholds,
currency and the sender mapping get less room than they have today. On a phone the week
turns sideways into seven bars, which is legible for hours and cutoffs and cramped for
seven senders.

### C · Who carries it out — organised by the reader (`direction-c.html`)

**The idea.** Every setting is filed under the thing that obeys it, and each of those
opens with what it reads, the file it runs from and **when it last ran, measured from its
own log — and *not recorded* where no log exists**: *The approval gate* (thresholds, who
may seal; last acted 14 Sep 19:22, parked order 4471 — filed under ADR 0116), *The
senders* (the seven-sender mapping table with its refused row, your doors, quiet hours,
the digests, the sign-off, the autonomous-send seal; last ran — not recorded for the six
crons, which log to stdout; last sent 15 Sep 11:52 for the low-stock alert, a
`notifications` row), *The day-book* (hours, zone, vendor terms, the feed; feed pull — not
recorded), *The ledger and the reports* (currency, carrying cost, cellar registers,
measurement; the nightly run — a log line, not a row; the insights it wrote carry a date)
and *The door* (team, locations; last changed 11 Sep, an invite row). The last group is
**Nobody**: push (three writers, no reader), the dead second quiet-hours store, the
deleted consent panel, the retired appearance switch — listed with the grep that proves
each, not hidden. "Kept on" (this restaurant · your account · this browser) is printed on
every row, because filing by reader deliberately mixes house and personal scope.

**What it optimises.** DESIGN-FOUNDATION §6's exponential idea — *every setting states
its blast radius* — made structural. "Did flipping this change anything, and for whom" is
answered by the heading. The refusal of an unmapped sender sits next to the thing that
refuses it, and the centred panel that maps it (a question, ADR 0112) shows for each
category **who would receive the sender today** through that category's own doors, with
*leave it unmapped* named as what it is, no option preselected and *Record* disabled
until one is (OD-121: asked, not defaulted). No seal on the mapping: a person's own answer
is stated, not sealed; the assistant's proposal for the audit reminder is a separate object
reached by *Open the proposal*, and its seal is the hold.

**What it costs.** One table this direction cannot do without: a **last-run row per
sender** (`scheduled_task_runs`, or a column on the notification tables) — today the crons
log to stdout only, and the desktop render says so on the heading: *last ran — not
recorded*. Two more if the other headings are to say a time rather than *not recorded*: a
feed-access log on the calendar feed route, and an insight-run row from
`insights/insight-scheduler.service.ts`. The gate's last action is already filed
(`order_approval_refused`, ADR 0116). The partial state draws the third sentence — *could
not be read* — for a log that exists and did not answer, so the three absences never share
a word. C also needs the two costs it shares with A and B: the hours-from-till inference
its Istanbul row assumes already ran, and ADR 0113's write side for its own 3b — the
proposal panel with the hold-to-seal, distinct from the mapping panel's plain *Record*
(a person's own answer is stated, never sealed). Everything else reads endpoints that
exist.

**Risk.** The reader taxonomy is the product's, not the manager's — *the day-book* and
*the ledger* are house words, but a person looking for "the SMS switch" has to know it
is a sender's. The per-row *kept on* tag carries that weight.

## What every direction needs built, regardless

- `restaurant_notification_categories` (sender → category, per house, with author and
  date) and a required `category` on `RecipientQuery`, so gate 2 reads one array instead
  of a union across three; an unmapped category refuses and **counts** the refusal
  (OD-121; `recipient-resolver.service.ts`, `scheduled-tasks.service.ts:127-155`).
- The recommendations digest **sender** reading `recommendation_digest_prefs` and writing
  `last_sent_at` (`recommendations.md` §13.7; ADR 0149 row 26).
- The hours editor mounted on the Mudavym page over the existing endpoint (row 22).
- Deleting `ServicesPermissions.tsx` / `ConsentDialog.tsx` and writing the one sentence
  (row 14).

## Honesty traps, and where each direction handles them

| Trap | A | B | C |
|---|---|---|---|
| Missing is not zero | em dash rows; the tally counts questions, never answers | seven em dashes, never seven closed days; nothing unstated is drawn | Nobody group; *not recorded* on a heading |
| A proposal is not applied | proposed stamp; the seal; per-item receipt | hours confirmed *from* a sealed proposal; the sheet says what the save will change the stamp to | proposed row in the mapping table, *Open the proposal* leading to the hold |
| Inferred is never written | italic rows, *computed on read* | hatched brackets, dashed delivery chips | italic vendor rows with counts |
| A refused read is not empty | *41 of 46*, rail count suppressed | vendor layer *off because unread*, callouts suppressed | a reader shown with its last action and without its rules |
| Refused sender ≠ off | refused row, 4 sends counted | crossed dot on every day | refused row next to the thing that refuses; *leave it unmapped* named |
| Never sent ≠ sent nothing | digest row | book entry | the senders group |
| A schedule is not a run | the Runs column is a schedule and says so | server-fixed dots drawn grey | *last ran* from the log or *not recorded*; *could not be read* when the log exists |
| The server's clock is not the house's | Runs converted, *server-fixed · 09:00 NY* under each | grey dots placed in the house's zone; the quiet-hours callout counts five of six inside the window | Runs converted; the Istanbul heading says the schedule is fixed in America/New_York |
| A stored default is not an answer | the digest row's controls are empty, *Record* disabled | the digest is off the grid until stated; no zone preselected | the digest row's controls are empty; no category preselected in the panel |
| Confidence is a word, not a decimal | *likely — 38 menu lines name a whiskey* | the cellar entry counts stamps only | *whiskey likely · beer certain* |
| The timezone is never defaulted | the clock row | the grid refuses without a zone; *Choose the house's zone* | the day-book row |
| Retired and deleted are said, not vanished | *Not asked, and why* | book entry | Nobody |

## The founder questions these directions embody

1. **Front door.** Is `/settings` the interview (A — the assistant and the unanswered
   first) or the register (find a thing, change it)? A wins on the day the house is set
   up; the register wins on every day after. A's fixed order and rail are the bet that
   one page can be both.
2. **Two kinds of "confirmed".** The brief's three words are manual · confirmed ·
   inferred. ADR 0113 has unstated · stated · proposed_sealed. The sketches draw
   *confirmed* as both a sealed proposal and an inference a person accepted with one
   click. Is that one class or two — and does accepting an inference deserve the seal?
3. **Whose mapping.** OD-121 calls the sender → category mapping a *product* decision;
   ADR 0149 row 15 says *map the seven*. The sketches draw it per house, assistant-proposed.
   If it is product-level, the table becomes read-only and the refusal never appears for
   any house. OD-121 reserves **two** mappings for the founder — the weekly report and the
   recurring-order reminder. All three directions draw the reminder refused and not
   guessed; they draw the weekly report as Deniz's answer for his house, with a note that
   the product-level answer is still open. Is a house allowed to answer a reserved
   mapping for itself before the product does?
4. **Day one.** A new house has seven refused senders until mapped (C's empty state).
   Accept the silence and say so, or make the mapping an onboarding step before the first
   run?
5. **Server hours.** All six scheduled senders are cron constants in **America/New_York**
   — one New York schedule imposed on every house. For Palo Alto they fire at 04:00 to
   06:00 and 14:00; five of the six fall inside a 22:00–08:00 quiet window, which the
   gateway's senders do not read anyway. For Istanbul they fire at 14:00 to 16:00 in the
   afternoon service, and the delivery ETA at midnight. B draws them grey and converted;
   A and C print them converted with *server-fixed · 09:00 NY* under each. Should they
   become house settings — a per-house schedule the backend does not have — and until
   they do, should the page say this as loudly as the sketches now do?
6. **The last-run table.** C's headings need it; A's *read by · last ran* graft needs the
   same row per field. Worth building for the heading alone, or is *not recorded* an
   acceptable permanent line?
7. **Hours from the till.** A proposes the week from 1,212 POS checks. B and C show it
   already sealed that way. Is the inference wanted, and does a house without a POS get
   asked by sentence instead?
8. **The week on a phone.** B's sideways bars, or the list?

## Recommendation

**A, the interview, with two grafts:** C's *read by* line as the third line under every
answer (blast radius per field rather than per group — the "more" the founder asked for,
where the reader is already known), and B's day sheet as the editor the hours question
opens (drawn in A's section 3b). The *last ran* half of C's line is **not** grafted on
day one: it needs the same run row per sender that C's headings need, per field instead
of per group, and A should not be sold as cheaper than C while quietly carrying C's
table. It joins the line on the day the row exists.

The cost, stated whole, corrected against the earlier pass: every direction needs the
mapping table, the digest sender, the hours editor mounted and the consent deletion.
ADR 0113's write side is **not A's alone** — B needs it for its till proposal's
hold-to-seal, and C needs it for its own 3b. The hours-from-till inference (a read-time
computation with no endpoint) is likewise shared by all three, not new to A only: B draws
it as its empty-state proposal and C's Istanbul row assumes it already ran. The
categorical register inference is **not a new cost for anyone** — `GET
/cellar/:id/registers` already returns it (`cellar-registers.ts:38,446-464`), and B and C
print the same call. What actually separates the three, once the shared costs are moved
off A's line alone: C needs the last-run row per sender and two further logs its other
headings ask for; B avoids that table because nothing in its drawing reads a schedule as
a run — B, not A, needs the least *additional* backend once the shared costs are counted
once each. A needs nothing beyond what every direction needs.

A still wins, and the reason is structural, not a cost advantage — on the corrected
numbers the backend bill is close to level across the three, and B is the cheaper build.
ADR 0113 is locked and the founder called the assistant a game changer; A is the only
organisation where that flow and "missing is not zero" are the page rather than a feature
on it — the tally, the filter, the rail and the proposal panel are all one idea. The
hours-from-till inference is not A's to run alone, but A is the only direction where the
register it fills — hours — sits inside that same tally-and-seal idea rather than beside
it, which is the argument for A, not its price tag.
A's risk — a new taxonomy on a page the founder just watched settle into five groups — is
answered by keeping the order fixed, the `?tab=` map intact and the contents rail beside
the *Waiting on you* box.

If the founder does not want the assistant at the top of the page, **C** is the second
choice on the day the last-run row exists, and B's day sheet should still become the
hours editor in either.

## Every claim is cited

Each file ends with the `file:line` it was drawn from (re-verified 2026-09-16 on
`feat/mudavym-finish`) and the decisions it leans on. **No file under `apps/`,
`supabase/` or `services/` was changed by this sketch.** Example data, not a tenant —
Meyhouse Palo Alto, Lokanta Müdavim, their people, vendors, figures and dates are invented
for the drawing; the repo and product facts are not.

**Spot-checked again 2026-09-17** on `feat/mudavym-finish`: `operating-hours.controller.ts:38,56`,
`analytics.controller.ts:1143-1153`, the eight `@Cron` sites in `scheduled-tasks.service.ts`,
`notification_agent.py:1487`, `st-format.ts` (`KEPT_LABEL`, `PROVENANCE_UNKNOWN`), the legacy
`OperatingHoursSection.tsx` and the two consent files all read as cited. One citation was stale
and is corrected in direction C: the dead second quiet-hours store is `core/database.py:1503-1516`
(`is_quiet_hours`, zero callers), not `1410-1428`. The same pass fixed the 390 px renders: the
centred panel and the right sheet now shrink to the viewport (`min(620px, 100% − 32px)` /
`min(440px, 100%)`, the rule `components/mudavym/sheet.css` already uses) instead of clipping,
and B's day-header vendor chips are hidden below 900 px as the media rule intended.

**Second pass, 2026-09-17, after review.** Eighteen findings, all applied; each was
re-measured against the file before the drawing changed:

- **Sender hours** — every cron carries `timeZone: "America/New_York"`
  (`scheduled-tasks.service.ts:195,229,408,523,626,680`); all three directions now convert
  to the house's zone and label the source; B's quiet-hours callout was false (five of six
  fire inside the window) and is rewritten; C's *next run tomorrow 08:00* is now 05:00.
- **Register inferences** — `Confidence` is categorical (`cellar-registers.ts:38`) over
  menu and cellar rows (`:446-464`); *0.71 / 0.88* and *till lines* are gone.
- **The digest row** — `digest_hour ?? 7` and `?? "this_week"` are stored defaults
  (`recommendation-actions.service.ts:294-295`); the controls are now empty with
  placeholders and *Record* disabled.
- **The hours sheet's failure** — now a string the validator produces
  (`operating-hours.ts:197-211`); the earlier example was a valid week refused by an
  invented rule.
- **The unrecorded-zone state** — a first, disabled *Choose the house's zone* option;
  nothing preselected.
- **B's missing pieces** — the seven-row mapping table with its refused row, all seven
  senders on the grid and nothing that is not one (the low-stock digest hour moved to the
  *Yours* layer as its own mark), and a second overlay with the hold-to-seal (ADR 0113).
- **Captions** — every caption-role selector now uses `--ink-4` (ADR 0042, OD-112
  amendment); `--ink-3` remains on rules, hatch fills, borders and tag outlines only.
- **C's measured facts** — headings say *not recorded* where nothing records a run
  (senders, feed pull, insight run); the low-stock alert's last send is a `notifications`
  row and stays; C:280 is target-state wording for OD-121; a feed-access log and an
  insight-run row join C's build list.
- **The rest** — no looping skeleton sheen (none of the seven motion tokens is a loop, and
  ADR 0134 is still Proposed); the carrying-cost field's placeholder in the drawing is *e.g.
  0.75* — the code's own placeholder at `CarryingCostSection.tsx:185` is `0.75`, with no *e.g.*,
  a mismatch this pass corrects the claim about rather than the drawing; C's mapping
  panel has no radio selected; the weekly report is noted as OD-121's second reserved
  mapping in all three; A's Sysco lead is one day, its quoted sentence contains *two
  thousand*, and its receipt's third item is *not attempted* on a table that is not built
  rather than a 409 on a rule nobody decided; A draws B's day sheet as section 3b; the
  senders table stacks into one card per sender at ≤900 px with the action in view; C's
  *Seal* is *Open the proposal*; weekday and *quiet* labels are English in every file; the
  Istanbul hours carry the same provenance (confirmed from 2,406 till checks, sealed by
  Selin Kara) in all three.

All eight screenshots re-rendered: zero console errors, no horizontal overflow at 1440 or
390; the 390 captures are in segments under 16,000 px so none is corrupted.

**Third pass, 2026-09-17, against the design critic's JSON
(`sketch-critic/109-settings-directions-2.json`) and the founder's 2026-09-17 style bar
(ADR 0149 row 38).** Most of the critic's major findings were already closed by the second
pass above (the sign-off and calendar feed only ever appear as the `/connections` pointer
in A and B now; A's tally and its empty/partial-state arithmetic match the rows drawn; the
null-week hours sheet is the seven-day editor; the eighth sender is drawn in all three;
B's delivery chips sit after their own day's label, `.inf` marked, at 9.5px). What this
pass found still open, all in **C**, and fixed:

- **C's Istanbul frame had no Reader 3.** The day-book (hours, zone, vendor) was missing
  from the Turkish house entirely, so C never carried the Istanbul hours the README
  claimed for it. Added, with the same confirmed stamp A and B use — *Mon–Sun 12:00–01:00
  · confirmed from 2,406 till checks, sealed by Selin Kara*.
- **C's senders count regressed to seven inside the Istanbul frame** (`7 senders · all
  mapped`) while the desktop frame correctly said eight; the empty state separately said
  *0 of 7 mapped*. Both now read eight.
- **C drew only one overlay.** The mapping panel (a person's own answer, no seal) existed;
  the assistant's proposal — reason, current, proposed, hold-to-seal, per-item receipt,
  ADR 0113 — was described in prose (*"Open the proposal" leads to … its hold-to-seal*)
  but never drawn. Added as a new **3b** stage with two proposed rows (the price rule, the
  inventory audit reminder → Low stock) and a working hold-to-seal + receipt, matching A
  and B's mechanic.
- **C's rail named three items under a count of two** (*the price rule, the audit
  reminder, hours (sealed)*, count `2`) and listed an already-sealed item under
  *to seal*. Now names only the two it counts.
- **C's mapping panel had one radio standing for three categories.** Split into three
  radios (Financial reports · Price inequality · Calendar reminders), each with its own
  *who reads it today* line, matching every other option in the panel.
- **This README's own citations were stale in two places**: *the nine `@Cron` sites* (the
  critic's re-measure: eight) and the carrying-cost placeholder claim, corrected above.
- **The cost comparison put two shared costs on A alone.** The hours-from-till inference
  and ADR 0113's write side are not A's — B draws the till inference as its empty-state
  proposal and needs the write side for its own hold-to-seal; C's Istanbul row assumed the
  inference already ran and its new 3b needs the write side too. The register inference is
  not a new cost for anyone — it already exists (`cellar-registers.ts:38,446-464`). A's
  cost paragraph, B's cost paragraph, C's cost paragraph and the Recommendation's cost
  paragraph are all rewritten above; the recommendation for A still stands, now argued on
  structure (the tally-filter-rail-proposal are one idea) rather than on a cost advantage
  that the corrected numbers do not support.

**The style bar (ADR 0149 row 38: people-facing pages follow Wave Four, the Arrival and
Documents and Reports — simpler, easy to read; Fable used minimally, Sonnet where it is
capable).** Read for the look, grepped and excerpted (not the embedded images): Wave Four
(`mudavym-wave-four.md`) sets short measures on rationale text (`.block p{max-width:62ch}`)
and keeps a page's justification in a side rail, never inline with the primary content;
the Arrival (`the-arrival-five-ways.md`) keeps its `.why` captions to one short clause each
(*"You said 'no cocktails'. Recorded as not carried."*) rather than paragraphs, and both
already use the muted-caption idiom this sketch's `.why` class follows. Applied here:

- **`.con` (the per-row rationale) is now the same quiet tier as `.why`** — `--ink-4` at
  11.5px, not `--ink-2` at 12px — in all three files. This was the highest-leverage,
  lowest-risk move available: it recedes all ~40 rationale paragraphs behind the answer
  and its provenance line without deleting the honesty-trap content ADR 0113/0116/OD-121
  require this page to carry, and it applies identically everywhere rather than risking a
  hand-edited miss.
- One clearly self-referential `.con` (A, "What it may do on its own" — *"The eight rows
  are eight of the forty questions; this line is their heading, not a ninth"*) was cut to
  its product-relevant half; the design-system bookkeeping aside is gone.
- **What this pass did not do, and why it is named here rather than left silent (§0.5):**
  a full line-by-line rewrite of every `.con`/`.why` paragraph across all three ~800-line
  files, in the Arrival's one-clause voice, was not attempted. There are ~40 `.con` and
  ~27 `.why` paragraphs across the three files; most already read as one or two short,
  cited sentences (median under 25 words) rather than the paragraph-length rationale the
  critic's category implied, and several carry the specific numbers (till-check medians,
  price-sighting counts, receipt counts) the founder's own "no shortcuts" rule and this
  page's honesty-trap thesis depend on — cutting them for brevity alone would trade a
  verifiable page for a vaguer one. The quieting move above changes how loudly that text
  reads without touching what it says. **Open follow-up:** a founder read of all three at
  1440 to confirm the quieted tier is the right amount of "quiet," and, if more is wanted,
  a targeted second pass naming which specific rows read as design-document voice rather
  than product copy (the one cut above is the pattern to repeat) rather than a wholesale
  rewrite.

All three files re-rendered at 1440×900 and 390×844
(`node p4-scratch/render-sketch.mjs`); A's and C's 390 renders are now 21,709 px and
20,266 px respectively (both were captured and stitched in 8,000 px bands by the render
script's own band/stitch path — no manual clipping was needed). Zero console errors, no
horizontal overflow, on all six. Every screenshot was read and checked: B's day-header
chips land under their own day (Mon SY · Tue WW VP · Wed SY · Thu WW · Fri SY · Sat VP,
each 9.5px and `.inf`-dashed where inferred, matching the vendor-terms data); B's 390
sideways-bar view merges Monday's overlapping markers into a dashed proposed-dot plus a
"+2" count rather than stacking three glyphs on one point; C's new 3b panel and its three
mapping radios render without layout defects; no duplicate `id` was introduced by this
pass (checked across all three files).
