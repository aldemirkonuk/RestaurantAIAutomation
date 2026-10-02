---
sketch: 125
name: all-houses-people-and-tips
question: "How does an owner see every house as one, with goals and decisions for the group; how do owners and managers give people jobs and the rights to do them, with a screen per role; and what replaces the old tips?"
winner: "Houses: A (One Total), sales first, with B (Ledger) one tap away. People: jobs and rights in one step. Tips: A (margin note). Picked 2026-10-01; later rounds to 2026-10-02 answered most forks. Still open: OD-208 and OD-211 to OD-216."
tags: [all-houses, group, consolidation, goals, group-decisions, roles, rights, jobs, staff-screen, guidance, tips, tours, sketch-only]
---

# Sketch 125 · All houses, people and tips

**Why this exists.** The founder's voice note, 2026-10-01, asked for four things. One of them was
built in code the same day and needs no drawing. The other three are drawn here.

- **Counter (built, not drawn).** "Even if I close the counter, when I change pages, it reopens itself."
  The fix is one choice for every page, merged as PR #568 (`c14aeca03`).
- **All houses.** "I want to see all of our profits in just one go … set goals for … restaurant A, B, C …
  global decisions that will apply to all restaurants."
- **People.** Mid-session he added: "managers and owners can authorize tasks to their needed personnel."
  Asked whether that means granting rights or handing out jobs, he answered **"Both"**.
  He then added: "how each visual looks per user Owner → manager → staff and what happens when they get
  more access … Staff page will have different UI since they're only going to see what they need and
  complete certain actions."
- **Tips.** "Change them … they are old garbage tutorial designs." "Don't show again" must mean never,
  "until I press or check for it". The behaviour is built on PR #570 (open); the design is drawn here.

The decisions are ADRs 0251, 0252 and 0253, on PR #566 (open; its head carries round 12 of 0253).
Until #566 merges, those three ADRs are only on that branch.

Open `index.html`; every frame links from it. Each page is self-contained: inline CSS, and one network
request: a render beacon, an image request to `/__seen` on whatever host serves the page (nothing
outside that host); fonts fall back to Georgia and system faces. The pages use the paper ground and
the house tokens from sketch 124. Every page folds to one column at ≤780px. Re-checked 2026-10-02
after the gate-prep edits, in headless Chromium against `file://` with every non-file request
blocked: all 10 pages at 390px and 1280px, `scrollWidth` equal to the viewport, and no element past
it (elements inside a box that clips its own overflow were not counted).

**All data is example data.** House names (Sim Bistro, Sim Meyhouse, Meyhouse Palo Alto, Vanilla
Kaleiçi, YARDOM) already appear in merged ADRs. Person names (Ayla Demir, Deniz Aksoy, Mert Kaya,
Jonah Price) are invented. On 2026-10-02 they were grepped against `supabase/seed*`, fixtures and
`datasets/`, and none is a person there; "Deniz Aksoy" is already a made-up name in test specs
(`apps/api-gateway/src/settings/approval-thresholds.spec.ts`). Every figure is invented. The
generator was outside the repo and is not committed; the HTML is the record.

## The frames

| File | What it draws |
|---|---|
| `houses-a-one-total.html` | **A · One Total — his pick, with B one tap away.** Sales first, net of tax and tips, with houses as its parts (a share bar). Profit is a side line, only where a house has sales, goods and hours in one currency. "4 of 4 read", a house not set up listed outside the count, the currency sign as a popover. Goals and decisions sit underneath. |
| `houses-b-the-ledger.html` | **B · The Ledger — the second view, one tap from A.** A totals row, then one row per house, sorted by sales. Goals and decisions as house-by-house grids. |
| `houses-c-the-letter.html` | **C · The Letter — not taken.** A written morning briefing and a figure strip that opens the ledger, redrawn so nothing on it contradicts his picks. |
| `houses-frames.html` | Shared by A, B and C. **Entry**: "All houses" tops the chooser and the house switch. **Goal sheet**: each house its own target, linked. **Group decision sheet**: copied once into the chosen houses; each house then shows as copied, changed since, or didn't save. **Honesty states**: "from 3 of 4", a house not set up, two currencies through the popover at ECB rates. |
| `people-jobs-and-rights.html` | **Give a job**, granting the missing right in the same step: "just for this job" or "from now on". **Who may do what**, per house: staff closed until given, "listed" or "this job" per right. Manager Ayla gives Deniz "orders up to $500" under the owner's allowance, inside a $750 cap the owner set. One person across houses. **Jobs you gave**, and the job on the person's phone. |
| `people-role-screens.html` | The same Friday morning as **owner**, **manager (Full)** and two **staff**. Staff get a different, phone-first "today's jobs" screen. Mert's screen shows the three rights the grid gives him. **Deniz after a new right** shows the screen growing by exactly one tile. A table maps each right to what appears for it. |
| `tips-a-margin-note.html` | **A — his pick.** The tip is one line, drawn under the title; it is built at the top of the page column (ADR 0251 D1). "Show me" rings the real button. No dark veil. The steps are the built Orders tour. |
| `tips-b-in-the-counter.html` | **B — not taken.** Tips live as a quiet card in the counter. When the counter is tucked, a tip is only a count on its button. |
| `tips-c-guide-card.html` | **C — not taken.** A corner checklist that ticks when you do each step; moot with a tip per page. It folds to a pill. |

## What every frame draws as already decided

### All houses

- **One house per session.** A session is in one house (ADR 0164). "All houses" is a read across
  houses, each house read with the reader's role in that house (ADR 0252, Decision). Today's guard
  reads one role, the session house's: `apps/api-gateway/src/auth/guards/roles.guard.ts:46` compares
  a single `user.role`. So a cross-house read cannot reuse it as it stands.
- **No silent shrinking.** A figure that can't be read is never zero, and a group total never quietly
  shrinks (ADRs 0016, 0020). [Corrected 2026-10-01: first cited as ADR 0147. Corrected again
  2026-10-02, after ADR 0252's own bracket: 0147 holds the failed-read rule ("A failed read throws"),
  but not the group-total rule.] Every product researched does let a missing location shrink the
  total silently: Toast offline sales, an R365 missing daily sales summary, MarginEdge closed invoices
  only.
- **Prices are advised, not set.** A house's price follows its own menu and manager (ADR 0193). A
  group *price* decision would amend that record.
- **His picks.** The frames draw every answer listed under items 1–8 below.

[Removed 2026-10-02: a line citing ADR 0131 for "one house first, then the rest". ADR 0131 is the
product's go-live rollout, not a rule for group decisions, and its per-house half was superseded by
ADR 0149.]

### People

- **One step.** A job and the right to do it are given together (*"Both"*); the giver picks
  permanent or for this job (ADR 0253 round 2).
- **Closed until given.** What staff do today (receive, count, create orders) is closed until
  someone gives it (round 2, *"Closed until given"*). Being listed on /team's Jobs is the right from
  now on (round 7, *"Listed means allowed (Recommended)"*).
- **Packages.** Managers get Full, Standard or Light (round 8, *"Yes, as drawn (Recommended)"*).
- **Zones.** Owners, managers "+ the people they assign" (ADR 0238, built).
- **Pay.** Pay is the owner's. An owner switches it on for a manager (ADR 0215), and only for
  someone who sees the house's money; profit needs both (ADR 0253 F14, *"Needs money and pay
  (Recommended)"*).
- **Sending to vendors.** Owners and managers send, and each send is sealed (ADR 0175, its
  2026-09-21 answer: "An owner, a manager, or a person an owner has granted sends with one hold").
- **Giving money and send rights.** His words (round 6) are free text: *"managers can give only if
  the owner accpeted to give access for those actions"*. ADR 0253 read that as: an owner may let a
  manager give money or send rights; without that, only owners give them. He confirmed that reading
  on 2026-10-02 (round 12): *"Yes, per action (Recommended)"*, and on the amount, *"Owner sets the cap
  (Recommended)"*, a cap that may sit above the manager's own limit. That is why Ayla's grant to Deniz
  is drawn under the owner's allowance, with the owner's $750 cap.
- **Granting.** Managers grant manager or staff (ADR 0162). Area leads act on cards only (ADR 0218).
- **One register.** ADR 0238's Consequences say a capabilities register starts paying for itself at
  the second per-person right. There are two today, `team_pay_access` and `zone_setup_access`. The
  rights grid here is that register; which rights it holds is OD-208, still open.
- **The server is the gate.** The server refuses what a person may not do. The page only hides what
  would be refused.
- **Precedent for per-role screens.** Today the rail hides four rooms from staff (`minRole` in
  `apps/web/src/lib/mudavym/rooms.ts`), and only `/receiving` already draws three ways by role
  (`apps/web/src/pages/receiving/next/ReceivingNext.tsx:56`).

### Tips (ADR 0251; the behaviour is on PR #570, open)

- **"Not now"** (was "Later") hides the tip at once; it may come back on a later visit. A snoozed tip
  returns after four hours, even in the same session; two tips turned away in one session stop tips
  for the rest of it. [Corrected 2026-10-02: this said "once per browser session", which ADR 0251 D2's
  bracket corrects.]
- **"Don't show tips again"** turns off every page's tip until it is turned back on in Help → Ways back
  in → Page tips. On main today it still turns off that page's tip only.
- **A tour** starts only from the tip's Show me in the Mudavym shell; Help has no tour starter there.
  A tour started on purpose always plays.
- **Steps follow the job.** The Orders tour is built on main (PR #572): Write an order → Approve it →
  Follow it → Check what arrived.

## Open and answered forks

### All houses (ADR 0252)

1. **Direction.** ~~A, B or C, or A with B one tap away.~~ **Answered 2026-10-01:** A with B one tap away — *"even from this question i can say A with B one tap away is great"*, with research asked on every fork *"and more"*.
2. **Who sees it.** ~~Owners of 2+ houses only; or managers too, without money; or a new group role.~~ **Answered 2026-10-01:** owners of 2+ houses (*"Owners of 2+ houses (Recommended)"*). Widened by round 5 to managers of two or more houses (*"yes they see all with profit if authorized…"*), then narrowed by ADR 0253 round 8 to Full and Standard managers.
3. **Which houses are "all".** ~~Every house owned; the whole organisation; or saved sets.~~ **Answered 2026-10-01:** *"All you own; changes list houses (Recommended)"*.
4. **What leads.** **Answered 2026-10-01:** *"Sales first, profit later (Recommended)"*. Sales net of tax and tips lead; profit shows only where a house has sales, goods and hours in one currency. No real P&L exists today: revenue is a bottle-price proxy (`apps/api-gateway/src/analytics/analytics.service.ts:431`), labour is a typed `?labor=`, and POS revenue is null without a till. A house without a till is "not set up", listed outside "N of M".
5. **An unread house.** ~~Hold the total back, or show it marked partial.~~ **Answered 2026-10-01:** *"Show it, from N of M (Recommended)"*: counted, not read, or not set up.
6. **Two currencies.** **Answered 2026-10-01:** per currency at the owner's rate, chosen from a popover on the currency sign — no extra combined line (round 2, his words verbatim in ADR 0252). With no typed rate: *"Yes, ECB daily, dated (Recommended)"*, and *"Each day at its own rate (Recommended)"* (round 6). ~~One total at the month's average rate (Fathom's method), or a total per currency.~~ Currency and time zone may be NULL per house today.
7. **Group goals.** **Answered 2026-10-01:** *"Each house its own, linked (Recommended)"*. `analytics_goals` is per house and has no profit, cost or labour metric (`apps/api-gateway/src/analytics/goals.service.ts:74`).
8. **Group decisions.** **Answered 2026-10-01:** *"Copy once, show drift (Recommended)"*. Who may change a group figure's inputs: *"Managers, but you're told (Recommended)"*. Readiness, stake and history (round 4): *"Only when 2 can be read"*, *"Whole houses, said so"*, *"Houses you own today"* (each "(Recommended)").

### People (ADR 0253)

9. **The rights list.** The seven drawn, more, or fewer. **Open: OD-208.** Round 10 added a right, "Sees the house's money".
10. **"Just for this job".** **Answered in part.** Round 2 is his free text (verbatim in ADR 0253), read there as: the giver selects permanent or for this job, and /team gets a jobs-or-labels section. Round 7: *"Listed means allowed (Recommended)"*. When a for-this-job right ends is **open: OD-211**. The research proposes "when the job is done, cancelled or moved, loses its object, or the person leaves; never at the due time", and the sheet draws only "ends with this job". [Corrected 2026-10-02: this item said the right "ends with the job, never at due", as answered.]
11. **Order limits.** **Answered.** Who gives: round 6 (free text), confirmed in round 12 as *"Yes, per action (Recommended)"*. How much: round 5's *"Yes, any amount"*, then round 12's *"Owner sets the cap (Recommended)"* (OD-209, resolved). Standard's order right: *"No amount of its own (Recommended)"*. The house's approval rule decides every amount, and until approvals are built such orders wait for an owner or manager (OD-210, resolved). Whether that makes one order right or two is part of OD-208. [Corrected 2026-10-02: this item said "the amount goes with the packages".]
12. **Late jobs.** ~~Who is told when a job is late?~~ **Answered 2026-10-01:** *"Person, then giver (Recommended)"* — a reminder before due, the giver told once when late, the area lead only if the giver is away; never locked.
13. **Where staff work.** ~~Phone app and web, or phone only.~~ **Answered 2026-10-01:** *"Phone app and web (Recommended)"*.
14. **Staff and other rooms.** ~~Do staff see rooms outside their jobs?~~ **Answered 2026-10-01:** *"Only what rights open (Recommended)"*.
15. **Managers and profit.** **Answered 2026-10-01:** *"Only with pay access"* (ADR 0252 round 4), amended by ADR 0253 F14 to *"Needs money and pay (Recommended)"*. Owners' wages stay hidden from managers (ADR 0215).
16. **"All houses" for managers.** **Answered 2026-10-01:** yes, with profit if authorized, and access packages (ADR 0252 round 5, verbatim there). Round 8 gives it to Full and Standard, not Light.
21. **Acts staff do today** (receive, count, create orders). **Answered 2026-10-01:** *"Closed until given"* — against the recommendation; every staff member loses them on the day rights ship until someone gives them back.
22. **Money on the phone for staff.** **Answered 2026-10-01:** *"Close it to staff (Recommended)"*.
23. **What someone allowed to order sees.** **Answered 2026-10-02 (round 12):** *"As F3 said (Recommended)"*: amounts on the orders they may place or approve, plus their own limit (OD-217, resolved).
24. **The research's other proposals.** **Open: OD-212 to OD-216.** Receive is the door count only (OD-212). Place orders stays open until two money holes are fixed (OD-213). A receive job covers one vendor's delivery on one day (OD-214). A job may name a backup (OD-215). Only the giver, an owner or a manager moves or cancels a job (OD-216).

### Tips (ADR 0251)

17. **Design.** ~~A, B or C.~~ **Answered 2026-10-01:** A, the margin note (*"margin role lock it"*). Same answer: restore the rail's per-room descriptions (PR #569, open).
18. **When a step ticks.** ~~On doing it, or on reading it.~~ **Moot 2026-10-01:** with a tip per page (19), nothing ticks.
19. **Path shape.** ~~A tip per page, or one getting-started path across pages.~~ **Answered 2026-10-01:** *"One per page (Recommended)"*.
20. **"Don't show tips again".** ~~Confirm it means all tips off.~~ **Answered 2026-10-01:** *"All tips (Recommended)"*. Built on PR #570 (open).

## Research

The all-houses state of the art and codebase map were researched on 2026-10-01 by one research agent,
not a Workflow fan-out. Its brief is outside the repo, so it cannot be re-checked from here. The
citations above were re-read in the repo at `origin/main` `1c1a676f8` and again at `a62dbd105`.
Seven of its claims came from search-index excerpts, because those pages refused a direct fetch
(R365, MarginEdge, 7shifts). The people and tips frames rest on the codebase reads cited above and
on the research recorded in ADR 0253 (its own outside-the-repo findings are marked there).
