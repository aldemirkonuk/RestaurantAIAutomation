---
type: build-spec
page: dashboard
route: /
flag: mudavym_design_dashboard
status: approved
decided: 2026-09-01
decider: Aldemir (founder)
links: ["[[dashboard]]", "[[0051-rebuilt-pages-show-live-data-only]]", "[[0044-mudavym-implementation-kickoff]]", "[[0020-no-fabricated-answers]]"]
---

# Dashboard rebuild — the approved build spec

The single source of truth for this build. Every parallel worker reads this
first; anything not written here is not agreed.

Produced by the page-review process the founder set: extract the page in
layers (structure, statement, what/how/why), research the competitive gap,
put it to five people who would actually live with it, decide, then build.

## 0. The statement

The owner's daily ledger of **money paid to vendors**, the approvals blocking
that spend, and what is about to run out. Not sales — sales live in
`pos_checks`, which this page's service does not read, and the page says so.

## 1. Layout — decided, with the reasoning

**Decisions band on top. Calendar full-size directly below.**

The founder's stated value for the calendar was *"nice to see all in one
view"*, and that is preserved in full: the month grid keeps its size, its
per-day expansion and every function. What it gives up is only first-screen
position.

Two independent reviewers argued for this. The GM: *"that's somebody's
favourite feature, not mine — a calendar earns a tab, not the middle of my
screen."* The investor: *"it optimises for browsing, and an owner checking
daily wants to be told the three things that need a decision today, which a
temporal grid actively resists by making everything equally sized and
requiring a click to learn anything."* He explicitly declined to overrule the
founder and recommended demotion, not removal. The founder then delegated the
call with *"complete it, you decide, and bulletproof reasoning."*

The calendar also improves in the move — see §2.3.

### Order of the page

1. Opening line (kept — the founder liked this in review)
2. **Decisions band** (new) — §2.1
3. KPI row — §2.2
4. Calendar, full month — §2.3
5. Rail — §2.4
6. Vendor strip — §2.5
7. Footer scope sentence

## 2. Blocks

### 2.1 Decisions band — THREE SENTENCES, not three tiles

The GM's exact specification, and the format is the point: *"Three lines, not
three tiles with drill-downs. If I read those in fifteen seconds and know what
to do, I open this every day."* His own examples, to be matched in shape:

- *"Chablis by-the-glass: 6 bottles left, Friday's booked at 140 covers — you'll run out by 9pm."*
- *"Southern Glazer's invoice #48213, $3,400 — 2 cases short-shipped, needs your approval before it pays."*
- *"Sysco delivery today, cutoff for tomorrow's order is 2pm."*

Rules: name the actual thing (invoice number, vendor, wine), the actual
consequence, and the actual deadline. Never a generic aggregate ("$6,200 at
risk"). Fewer than three is correct when fewer than three are true — this band
never pads. Zero is a real state and reads as such.

### 2.2 KPI row — money first

Cellar **value in dollars** (bottle count as sub-line) · worst days-of-cover,
named ("Chablis, 4 days") · Waiting on you with dollars at risk · Paid today ·
Paid this month with a month-over-month delta.

Pour cost sits here **only when a POS is connected**; otherwise the tile says
so plainly with a connect action, never a number. See §4 for why the accuracy
posture is non-negotiable.

### 2.3 Calendar — keeps everything, gains a reference point

Every day cell gains expected-vs-actual. The investor: *"a number without a
reference point isn't an insight, it's a receipt — $4,200 on Tuesday means
nothing until it's $4,200 against a $2,800 expected day."* Baseline comes
from the trailing per-weekday mean already derivable from the month ledger.

Regains the event **type-filter and search** the redesign dropped (the MERGE
gap named in MAKEOVER-VERDICTS). Day detail keeps its honest floors.

### 2.4 Rail — ordered by what costs money

Waiting on you (**with a decline path** — today the only negative action forces
a trip to `/orders`) · Money at risk (invoice-vs-PO exceptions + aged vendor
credits) · Running low (days-of-cover + reorder points, **with count freshness**
— §3.1) · This week's deliveries with vendor cutoffs · Alerts (already fetched
on every paint, currently visible only inside a day panel) · Lately.

### 2.5 Vendor strip

Top vendors by spend, concentration, on-time rate, dead stock / capital locked.

**Dead stock is reframed.** The chef: *"framed as a finance number it reads
like an accusation with no context, and I'll get defensive, because the same
dollar figure covers 'I made a buying mistake' and 'this is aging exactly as
planned.'"* Present as *not moving — here is what to do about it*, with the
§3.2 reason attached where one exists.

`deadStockCapital` is `number | null` as of the concurrent analytics change.
**Three-way branch, never two:** a positive number renders as money; a real 0
renders as "nothing idle"; `null` renders as an em dash with "no movement
recorded yet". Those are three different claims (ADR 0051).

## 3. Feed the people who feed the system

Unanimous across all four insider reviewers: the page serves only the owner's
eyes, and the people generating the data get nothing back. The sommelier, on
whose counts every figure on this page depends: *"it quietly consumes my
labour and hands the credit to a KPI tile. Give me nothing back, I stop caring
about precision, and precision is the whole foundation this thing stands on."*
This is a data-quality risk, not a courtesy.

### 3.1 Counts must visibly matter

Every figure derived from a count carries its freshness, and prompts when
stale ("based on a count 6 days ago — verify").

Attribution is the part that must not be faked. The sommelier: *"proof isn't a
badge, it's a before/after I can point to"* — e.g. *"4 days left → corrected to
2 days, reorder triggered, because of your count on 8/29."* A number that
moved, dated and attributed. **No streaks, badges or thank-you toasts** — he
named those as insulting.

### 3.2 A purchase carries its "why"

The chef's single ask, and his constraint decides the design: *"paragraphs are
dead on arrival."* Four or five preset chips, **tap-once and complete** — Event
hold · Seasonal trial · Slow mover · Bought wrong · Aging on purpose — with an
optional voice note as a later addition, never a requirement.

**It appears at ORDERING, not receiving.** *"Ordering is the one moment I
already have intent in my head — I know why I'm buying the six bottles of
Barolo the second I hit confirm. Ask me then or you've lost the window."*
Receiving is chaos; a weeks-later flag is too late to recover the reason.

### 3.3 Back-door receiving, in the moment

Ten seconds, case in one hand, driver waiting. PO pulled by vendor name or
scan — **not a search box to type into**. Line by line: bottle, vintage,
quantity. Tap the wrong line; no form.

Most common discrepancy, by a distance: **vintage substitution** — 2021
Sancerre ordered, 2022 delivered, same label, and if it is missed at the door
it goes onto the list wrong and a guest is sold the wrong wine. Second: short
case, 11 not 12. One photo of the label or packing slip completes the flag.

**It must not die in a queue.** It has to reach whoever is cutting the cheque
that week so the invoice is not paid in full, and it has to reach the vendor.
*"Show me the vendor got it — a sent timestamp, not just a saved one.
Otherwise I've done data entry, not receiving."*

## 4. Accuracy posture — binding

The GM, arriving at ADR 0051 independently and in his own words: *"an
approximate number I trust is worth ten times a precise number I don't… I'll
forgive an honest gap. I won't forgive a confident lie."*

Concretely: where comps and spills are not reliably captured, **do not render
a false-precision pour cost**. Render the range and the confidence
("~25–27%, 3 unlogged comps estimated"), or render the spend-to-revenue ratio
with the gap named. One fabricated number costs trust in the delivery dates
too.

## 5. Drink window — both halves, each fully operational

Founder: *"everything in parallel, one go, but everything will be covered full
through like its own ops."* So neither half ships as a stub.

**The split matters, because the halves have opposite risk profiles** — the
chef identified this unprompted and it is the key insight of the review:

- **Cellar aging — no capture friction.** *"For full bottles and cellar stock,
  the 'on a clock' logic works fine off delivery date and known drinking
  windows without anyone touching a button."* Buildable from data already
  held. Sorted by **urgency, not dollar value**: *"a $40 bottle nobody's
  pouring that's about to tip over matters more today than a $400 bottle with
  five good years left."*
- **Open-bottle / by-the-glass — capture is the whole problem.** The investor's
  objection stands and must be designed against, not waved away: *"nobody is
  logging an open-date on a $180 Barolo between courses… compliance craters to
  20–30% within a month and the feature becomes evidence the software doesn't
  work."* Therefore capture must be inferred from what is already recorded —
  first pour on a by-the-glass item — with a one-second manual "opened today"
  as fallback, never a bottle-picker or a menu dive.

**Anything inferred is labelled estimated.** The chef: *"rough-but-labelled
I'll use. Rough-but-confident I'll ignore within a week."* Same rule as §4.

The guest's line governs how this ever reaches a table: information, not
steering. *"The second I sense the recommendation exists because of what's in
the cellar rather than what's in my glass, I'm done trusting the list."*
The dashboard surfaces the fact; it never generates a push script.

## 6. Multi-unit — audit as we build

The investor's one cheap-now, ruinous-later item: every fact table carries
`restaurant_id` as a first-class key, **and no aggregation silently assumes one
restaurant.** *"Schema fixes are a migration; buried single-tenant assumptions
in business logic are an audit you don't know you need until a customer with
three locations sees location B's numbers on location A's screen."*

Founder's call: audit and fix per page as we build. For this page that means
every query and rollup it touches is checked for an ungrouped aggregate before
the page ships.

## 7. Out of scope here, recorded so it is not lost

- Aged vendor credits as a standalone product surface — the investor named it
  the strongest switching cost (*"recovered credits are a P&L line the owner
  can point to in a board deck"*). The dashboard surfaces it; the deeper
  build is its own page.
- Covers and beverage revenue beside vendor spend — the GM's most-wanted, and
  he called the POS separation *"the flaw, not a design choice I respect."*
  Gated on the same POS connection as pour cost.
- Cross-location roll-up, exceptions-across-locations, and an ops-director
  role view — needed at 40 units, not now.
