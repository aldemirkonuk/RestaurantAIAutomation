# 0256 — Dashboard: the walk-through rulings of 2026-10-01 (R1)

- **Status:** Locked
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** dashboard, walk-through, house clock, failed reads, staff amounts, calendar address, house words, contrast, keyboard, items not wines
- **Links:**
  - [`06-pages/dashboard.md` §14](../06-pages/dashboard.md): every item, with its evidence and its test.
  - [[0020-no-fabricated-answers]] (a failed read is never rendered as empty).
  - [[0042-iznik-seal-and-warm-charcoal]] (ink-3 is decoration).
  - [[0112-one-modal-policy-three-shapes-one-primitive]].
  - [[0115-the-house-item-is-the-ledgers-key]] and [[0186-a-menu-upload-classifies-every-drink-not-only-the-wine]] (W37).
  - [[0127-a-house-sees-one-arm-and-the-arm-it-saw-is-written-down]] option 8 (W5; amended by PR #565).
  - [[0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person]] (roles, W21 and W22).
  - [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]].
  - [[0169-the-ground-is-white-by-default-and-each-person-chooses]] (paper ground).

## Context

The founder walked `/` (DashboardNext, flag `mudavym_design_dashboard`) on 2026-10-01. Session R1, then R1b, worked on branch `fix/review-dashboard`, in house ALDEMIR, against production data in `me` mode. Staff and manager were checked on Sim Bistro.

Ten passes were run, P1 purpose through P10 live. Each finding was built live, shown as a before/after sketch, and put to the founder as Approve, Deny or Rework. Only approved items were kept.

P10 was partial: Chrome was not connected, so production's page was not seen. The deploy comparison was done from `git` and the public bundle instead.

## Options considered

Items that were rejected, reworked or decided as a fork:

1. **W12, links into /orders.** Reworked. The founder asked for the opened order to be formatted on /orders, and for a look at "the email communication sidebar". This became W16: (a) /orders' layout is the /orders session's (W15, queued); (b) the links open `/orders?order=<id>`, which the sidebar reads.
2. **W13, future days.** Approved, with an addition: past days lowered in colour. That became W17, where of the variants offered the founder chose "A: numbers fade".
3. **W22, staff and money.** The fork was: hide amounts for staff on the page and in the gateway, keep them, or defer to an OD. The founder chose A: hide them.
4. **W25, "· before service".** The fork was: (A) drop the phrase guessed from the hour, (B) state open, before or closed from the house's hours, or keep it. The founder chose A.
5. **W9 and W15, findings on other pages.** W9 was left as it is; W15 was queued for /orders.
6. **W37, the word for what the house holds.** The options were "items", "drinks", or hold for a product-wide pass. The founder chose "items".

## Decision

The founder's words, verbatim, per item:

| Item | Ruling |
|---|---|
| DASH-W1 | "show me visual", then "Approve" |
| DASH-W2, W3, W4, W5, W7, W8, W10, W11 | "Approve" |
| DASH-W6 | "open it on web", then "Test order on ALDEMIR" (W6a: one test order inserted on ALDEMIR; it stays) |
| DASH-W9 | "Leave it (Recommended)" |
| DASH-W12 | "needs rework, formatting into orders page when order opens is needed, + look into how the email comunication sidebar handles each action on what extent" |
| DASH-W13 | "approved + past days must be lowered in color to show those days past" |
| DASH-W14, W18, W20, W21 | "Approve (Recommended)" |
| DASH-W15 | "Queue it (Recommended)" |
| DASH-W16 | (a) "The /orders session"; (b) "the one wehre you can communicate with the vendor about a certain order", then "Approve (Recommended)" |
| DASH-W17 | "A: numbers fade" |
| DASH-W19 and W23 | "approve + remove the system theme from top bar into settings" (W23, the theme control, is shell work: queued) |
| DASH-W22 | "A: hide amounts for staff (Recommended)", then the built result "Approve (Recommended)" |
| DASH-W24, W26, W27, W28 | "Approve (Recommended)" |
| DASH-W24b | "Remove them (Recommended)" |
| DASH-W25 | "A: drop the phrase (Recommended)" |
| DASH-W29 | "Approve, replace (Recommended)" |
| DASH-W30 – W36 | "Approve (Recommended)" |
| DASH-W37 | "\"items\" (Recommended)", then the built result "Approve (Recommended)" |

These were built as approved. *What follows is my synthesis, proposed. It is not the founder's words.*

- **The house's clock and honest reads.**
  - Every figure, "today", the greeting and the calendar are bucketed on the house's zone (W2, W20).
  - A read that fails says so in the house's words and offers "Try again", never a zero (W3, W11, W19).
  - The unused read is gone (W8), and the cellar tile reads the low-stock view rather than every row (W10).
- **Roles.**
  - Staff see counts, never money. The gateway withholds the amounts and says `amounts: "withheld"`, so a withheld figure never reads as a failed one (W22).
  - The approval hold is offered only to a role that may approve (W21).
- **The calendar.**
  - The month and the open day live in the address (W29, `replace` so Back leaves the page).
  - A future day with an event opens (W13), and past days fade (W17).
  - Each square is named in words (W35), and Close returns focus to it (W34).
- **Words.**
  - No transport text, internals or experiment narration on the page (W5, W24, W24b, W25, W28), and the sheet's count agrees with the desk (W27).
  - Singular and plural are right (W7), and codes become words (W4, W32).
  - The page counts "items", never "wines" (W37).
- **Layout and contrast.**
  - Rows wrap to two lines instead of cutting (W31), subtitles are whole (W26), and the delivery row keeps its vendor (W30).
  - Captions are painted in ink-4 (W33).

## Consequences

- **Branch.** `fix/review-dashboard` carries the page and gateway changes and the §14 record.
- **Shared parts**, which are never committed from a page branch, are queued in `p4-scratch/review-shared-queue.md` (R1b lines):
  - the theme control's move (W23);
  - the /logs half of W5;
  - the shell focus ring and skip link;
  - ink-3 elsewhere and the DayLine font;
  - `/auth/me` read twice a load against a 10-a-minute auth bucket;
  - TenantGuard log noise and the socket greeting's old brand;
  - no CORS `maxAge`;
  - "items" on every other page.
- **Overlaps.** PR #565 rebases on this branch. The oldest-first, flagged *Waiting on you* work (`fix/waiting-on-you-oldest-first-flagged`) overlaps `WaitingOnYou.tsx`; whichever lands second rebases.
- **"Bottles" and "In the cellar" stay** until food lands; the founder is to be asked again then (W37).
- **Not verified:**
  - real touch;
  - a real screen reader;
  - reduced motion live;
  - production's page (Chrome);
  - the day panel's "Unnamed item" (no test).
