---
sketch: 125
name: all-houses-people-and-tips
question: "How does an owner see every house as one, with goals and decisions for the group; how do owners and managers give people jobs and the rights to do them, with a screen per role; and what replaces the old tips?"
winner: "Houses: A (One Total) with B (Ledger) one tap away. People: jobs and rights in one step. Tips: A (margin note). Picked 2026-10-01; other forks open."
tags: [all-houses, group, consolidation, goals, group-decisions, roles, rights, jobs, staff-screen, guidance, tips, tours, sketch-only]
---

# Sketch 125 · All houses, people and tips

**Why this exists.** The founder's voice note, 2026-10-01, asked for four things. One of them was
built in code the same day and needs no drawing. The other three are drawn here.

- **Counter (built, not drawn).** "Even if I close the counter, when I change pages, it reopens itself."
  The fix is one choice for every page, on `fix/closed-stays-closed`.
- **All houses.** "I want to see all of our profits in just one go … set goals for … restaurant A, B, C …
  global decisions that will apply to all restaurants."
- **People.** Mid-session he added: "managers and owners can authorize tasks to their needed personnel."
  Asked whether that means granting rights or handing out jobs, he answered **"Both"**.
  He then added: "how each visual looks per user Owner → manager → staff and what happens when they get
  more access … Staff page will have different UI since they're only going to see what they need and
  complete certain actions."
- **Tips.** "Change them … they are old garbage tutorial designs." "Don't show again" must mean never,
  "until I press or check for it". The behaviour was built the same day; the design is drawn here.

Open `index.html`; every frame links from it. Each page is self-contained: inline CSS, no network
requests, fonts falling back to Georgia and system faces. The pages use the paper ground and the house
tokens from sketch 124. Every page folds to one column at ≤780px with no horizontal scroll. That was
checked at 390px and 1280px on 2026-10-01: all 10 pages, no element past the viewport.

**All data is example data.** House names are the founder's own, so the frames read as his. Every
figure is invented. The generator lives in the session scratchpad and is not committed; the HTML is
the record.

## The frames

| File | What it draws |
|---|---|
| `houses-a-one-total.html` | **A · One Total.** One profit figure first, with houses as its parts (a share bar). Goals and decisions for the group sit underneath. |
| `houses-b-the-ledger.html` | **B · The Ledger.** A totals row, then one row per house, sortable. Goals and decisions as house-by-house grids. |
| `houses-c-the-letter.html` | **C · The Letter.** A written morning briefing, "three things waiting for you", and a figure strip that opens the ledger. |
| `houses-frames.html` | Shared by A, B and C. **Entry**: "All houses" tops the chooser and the house switch. **Goal sheet**: set once, for chosen houses, then progress per house. **Group decision sheet**: per house it follows, keeps its own, waits for its manager, or didn't save. **Honesty states**: an unread house, two currencies. |
| `people-jobs-and-rights.html` | **Give a job**, granting the missing right in the same step: "just for this job" or "from now on". **Who may do what**, per house, and one person across houses. **Jobs you gave**, and the job on the person's phone. |
| `people-role-screens.html` | The same Friday morning as **owner**, **manager** and **staff**. Staff get a different, phone-first "today's jobs" screen. **Deniz after a new right** shows the screen growing by exactly one tile. A table maps each right to what appears for it. |
| `tips-a-margin-note.html` | **A.** The tip is one line under the page title. "Show me" rings the real button. No dark veil. |
| `tips-b-in-the-counter.html` | **B.** Tips live as a quiet card in the counter, never over the page. When the counter is tucked, a tip is only a count on its button. |
| `tips-c-guide-card.html` | **C.** A corner checklist that ticks when you actually do each step. It folds to a pill. |

## What every frame draws as already decided

### All houses

- **One house per session.** A session is in one house (ADR 0164). "All houses" reads across houses.
  Each house is read with the reader's role **in that house**, never one house's role used for another
  (`roles.guard.ts:46`, ADR 0127).
- **No silent shrinking.** A figure that can't be read is never zero, and a total never quietly
  shrinks (ADRs 0016, 0020; [corrected 2026-10-01: first cited as ADR 0147, which holds no such rule]). Every product researched does let a missing location shrink the total silently:
  Toast offline sales, an R365 missing daily sales summary, MarginEdge closed invoices only.
- **Prices are advised, not set.** A house's price follows its own menu and manager (ADR 0193). A
  group *price* decision would amend that record.
- **One house at a time.** Rollout goes house by house (ADR 0131), drawn as "One house first, then
  the rest".

### People

- **Zones.** Owners, managers "+ the people they assign" (ADR 0238, built).
- **Pay.** Pay is the owner's; an owner may let a manager see and set it (ADR 0215).
- **Sending to vendors.** Only an owner lets someone send, and each send is sealed (ADR 0175 D10,
  `authority_grants`).
- **Granting.** Managers grant manager or staff (ADR 0162). Area leads act on cards only (ADR 0218).
- **One register.** ADR 0238's Consequences say a capabilities register starts paying for itself at
  the second per-person right. There are two today, `team_pay_access` and `zone_setup_access`. The
  rights grid here is that register.
- **The server is the gate.** The server refuses what a person may not do. The page only hides what
  would be refused.
- **Precedent for per-role screens.** Today the rail hides four rooms from staff (`rooms.ts`
  `minRole`), and only `/receiving` already draws three ways by role (`ReceivingNext.tsx:56`).

### Tips (built 2026-10-01 on `fix/closed-stays-closed`)

- **"Not now"** (was "Later") hides the tip at once; it may come back on a later visit (a four-hour snooze, and once per browser session).
- **"Don't show tips again"** turns off every page's tip until it is turned back on in Help → Ways back
  in.
- **A tour started on purpose** still plays.

## Open — the founder's to decide

### All houses

1. **Direction.** ~~A, B or C, or A with B one tap away.~~ **Answered 2026-10-01:** A with B one tap away — *"even from this question i can say A with B one tap away is great"*, with research asked on every fork *"and more"*.
2. **Who sees it.** ~~Owners of 2+ houses only; or managers too, without money; or a new group role.~~ **Answered 2026-10-01:** owners of 2+ houses (*"Owners of 2+ houses (Recommended)"*).
3. **Which houses are "all".** ~~Every house owned; the whole organisation; or saved sets.~~ **Answered 2026-10-01:** *"All you own; changes list houses (Recommended)"* (ADR 0252).
4. **What "profit" means.** **Answered 2026-10-01:** *"Sales first, profit later (Recommended)"* (ADR 0252). Till sales − goods delivered − hours worked. No real P&L exists today:
   revenue is a bottle-price proxy (`analytics.service.ts:431`), labour is a typed `?labor=`, and POS
   revenue is null without a till. A house without a till is named and left out.
5. **An unread house.** ~~Hold the total back, or show it marked partial.~~ **Answered 2026-10-01:** *"Show it, from N of M (Recommended)"* (ADR 0252).
6. **Two currencies.** **Answered 2026-10-01:** per currency at the owner's rate, chosen from a popover on the currency sign — no extra combined line (ADR 0252, verbatim there). One total at the month's average rate (Fathom's method), or a total per
   currency. Currency and time zone may be NULL per house today.
7. **Group goals.** **Answered 2026-10-01:** *"Each house its own, linked (Recommended)"* (ADR 0252). Each house on its own, rolling up (R365), or one target on the total; and whether a
   house can change its own. `analytics_goals` is per house and has no profit, cost or labour metric
   (`goals.service.ts:74`).
8. **Group decisions, per kind.** **Answered 2026-10-01:** *"Copy once, show drift (Recommended)"* (ADR 0252). Applies outright; applies but a manager may keep their own; or each
   manager accepts. Toast's versions-per-location model is the closest reference.

### People

9. **The rights list.** The seven drawn, more, or fewer.
10. **"Just for this job".** ~~Does such a right end when the job is done?~~ **Answered 2026-10-01, with a new ask:** *"the job might be both so make it select, permanent and for this maybe we can in /team add a jobs or labels section where we can identify those people? with that each job could have the potential to add to this person to this job, with a dropdown right? research industry,, use case, test cases find the most plausible smooth route for this"* — the grant is a choice of permanent or for this job; /team gets a jobs-or-labels section; a job picks its person from a dropdown. Research done; answered round 7: listed means allowed, a job's right ends with the job, never at due (ADR 0253).
11. **Order limits.** Can a manager set a staff limit above their own?
12. **Late jobs.** ~~Who is told when a job is late?~~ **Answered 2026-10-01:** *"Person, then giver (Recommended)"* — reminder before due, the giver told once when late, the area lead only if the giver is away; never locked.
13. **Where staff work.** ~~Phone app and web, or phone only.~~ **Answered 2026-10-01:** phone app and web (*"Phone app and web (Recommended)"*).
14. **Staff and other rooms.** ~~Do staff see rooms outside their jobs?~~ **Answered 2026-10-01:** *"Only what rights open (Recommended)"* (ADR 0253).
15. **Managers and profit.** ~~Do managers see profit?~~ **Answered 2026-10-01:** *"Only with pay access"* (ADR 0252).
16. **"All houses" for managers.** ~~Does a manager of two houses get "All houses"?~~ **Answered 2026-10-01:** yes, with profit if authorized, and access packages (ADR 0252, verbatim there).

21. **Acts staff do today** (receive, count, create orders). **Answered 2026-10-01:** *"Closed until given"* — against the recommendation; every staff member loses them on the day rights ship until someone grants them (ADR 0253).
22. **Money on the phone for staff.** **Answered 2026-10-01:** *"Close it to staff (Recommended)"* (ADR 0253).

### Tips

17. **Design.** ~~A, B or C.~~ **Answered 2026-10-01:** A, the margin note (*"margin role lock it"*). Built — [ADR 0251](../../decisions/0251-tips-are-a-margin-note-and-the-rail-says-what-each-room-is-for.md). Same answer: restore the rail's per-room descriptions (built, same ADR).
18. **When a step ticks.** ~~On doing it, or on reading it.~~ **Moot 2026-10-01:** with a tip per page (19), nothing ticks.
19. **Path shape.** ~~A tip per page, or one getting-started path across pages.~~ **Answered 2026-10-01:** *"One per page (Recommended)"*.
20. **"Don't show tips again".** ~~Confirm it means all tips off (built that way).~~ **Answered 2026-10-01:** *"All tips (Recommended)"*.

## Research

The all-houses state of the art and codebase map were researched on 2026-10-01 by one research agent,
not a Workflow fan-out. Its brief is in the session scratchpad; the citations above come from it, at
`origin/main` `1c1a676f8`. Seven of its claims came from search-index excerpts, because those pages
refused a direct fetch (R365, MarginEdge, 7shifts). The people and tips frames rest on the codebase
reads cited above and on no external research pass.
