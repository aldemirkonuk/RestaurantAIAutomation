# 0257 — Dashboard: the walk-through rulings of 2026-10-01 (R1)

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
7. **G1, vendor names in "Lately" for staff.** Found by the PR #579 audit: the /ask table withholds vendor names from staff, and this page shows them. The options were keep them, or withhold them for staff. The founder chose keep.
8. **G2, a house with no time zone.** Found by the same audit: the dashboard reads a missing zone as UTC, against the rule that an unset value reads as unknown. The options were: follow the rule in a follow-up PR, follow it in this PR, or keep UTC. The founder chose a follow-up PR.
9. **G3, the audit's fix round.** The options were approve it (commit, push, re-run the full audit) or hold it. The founder approved.
10. **G4, the second audit's fix round.** The second audit (on 3a72c2f) returned BLOCK: Running low still said "Unnamed wine", and the W37 claim could not see it. The options were approve round 2 (the word, a test, a claim that sees bare text, the prose corrected, three claims tightened, then the full audit again) or hold. The founder approved.
11. **G5, a role the page has not read.** When both the role read and the stats read fail, the page treated the person as one who sees money. The options were hide money while the role is unknown, in this PR, or record it as debt. The founder chose to hide it in this PR.
12. **G6, free text and staff.** An event's description is free text and reaches staff on the calendar and in Lately; it can hold a figure. The options were narrow the claim and record debt, withhold descriptions for staff (sketch first), or leave it and fix only the sentence. The founder chose to narrow the claim, and added a direction for later (below).
13. **G7, the gateway's alert text.** An alert said "A wine with no name". The options were change it to "An item with no name" in this PR, or queue it with the other pages' "items" pass. The founder chose this PR.
14. **G8, the third audit's fix round.** The third audit (on c7b6909) returned BLOCK. The W37 claim row said its check caught the wine-only phrases "quoted or as bare JSX text", but only "Unnamed wine" was matched bare. The W22 row named `calendarForRole`'s branch, which its check did not test. The page itself was right. The options were tighten the checks to match the words, or narrow the words to match the checks. The founder chose to tighten the checks.
15. **G9, two role gaps in the shared auth context.** Found by the third audit, in `contexts/AuthContext.tsx`, a shared part:
    - after a house switch, the old role is kept until the new one is read;
    - a role spelled "Owner" or `admin` reads as no role on the page, while the gateway's `policyFor` shows it money. This fails closed.
    The options were queue both for the shared batch, queue only the house-switch reset, or leave them in the audit report. The founder chose to queue both.
16. **G10, the local audit reports.** The gate writes an untracked local copy of each report, and posts the full text as a PR comment. The options were drop the local copies and cite the comment, or commit them in a docs PR. The founder chose to drop them.

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
| DASH-W19 and W23 | "approve + remove the system theme from top bar into settings" (W23, the theme control, is shell work: queued, then shipped in PR #576) |
| DASH-W22 | "A: hide amounts for staff (Recommended)", then the built result "Approve (Recommended)" |
| DASH-W24, W26, W27, W28 | "Approve (Recommended)" |
| DASH-W24b | "Remove them (Recommended)" |
| DASH-W25 | "A: drop the phrase (Recommended)" |
| DASH-W29 | "Approve, replace (Recommended)" |
| DASH-W30 – W36 | "Approve (Recommended)" |
| DASH-W37 | "\"items\" (Recommended)", then the built result "Approve (Recommended)" |
| DASH-G1 | "Keep (Recommended)" |
| DASH-G2 | "Follow rule, follow-up PR (Recommended)" |
| DASH-G3 | "Approve (Recommended)" |
| DASH-G4 | "Approve (Recommended)" |
| DASH-G5 | "Hide money, this PR (Recommended)" |
| DASH-G6 | "narrow claim,. + but keep in my mind when we integrate the POS and when system start to work we're going to using floor coverage software we're going save the stats of each waiter, and they'll be able to see table invoices." |
| DASH-G7 | "Yes, this PR (Recommended)" |
| DASH-G8 | "Tighten checks (Recommended)" |
| DASH-G9 | "Queue both (Recommended)" |
| DASH-G10 | "Drop them (Recommended)" |

These were built as approved. *What follows is my synthesis, proposed. It is not the founder's words.*

- **The house's clock and honest reads.**
  - Every figure, "today", the greeting and the calendar are bucketed on the house's zone (W2, W20).
  - On the gateway, the four routes the page reads (stats, activity, alerts, calendar-revenue) fail the call when a read fails, instead of answering empty (W3, W6, W11). Three dashboard routes no page reads still answer empty (debt).
  - On the page, a failed read of the figures, the approvals, Running low, the month or the week is said in the house's words with "Try again" (W19).
  - Not yet everywhere: Lately and the calendar's alerts have no failure line. Both the shared web client (shared code, queued) and the page's own hook turn a failed alerts or activity read into an empty list. A failed stats read falls back to counts taken from the inventory summary.
  - The unused read is gone (W8), and the cellar tile reads the low-stock view rather than every row (W10).
- **Roles.**
  - On the dashboard's own routes, staff see counts, never amounts. The gateway withholds the amount fields there and says `amounts: "withheld"`, so a withheld figure never reads as a failed one (W22).
  - Free text is not withheld: an event's description, on the calendar and in Lately, can hold a figure someone wrote (G6). [2026-10-08, #579 merging main: since ADR 0290 the month's events read no description (`dashboard.service.ts`, `calendar_events` select), so this now holds for Lately only.]
  - A role the page has not read yet sees no amounts, so a failed role read never opens the prices (G5).
  - Not yet everywhere: the page also reads `/procurement/orders/pending` and `/procurement/orders/history`, which still send prices to staff. The page hides them; the server does not yet. This is queued with the /orders session.
  - The approval hold is offered only to a role that may approve (W21).
  - Staff do see vendor names in "Lately" here, unlike /ask's table (G1).
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
  - the theme control's move (W23), since shipped in PR #576;
  - the /logs half of W5;
  - the shell focus ring and skip link;
  - ink-3 elsewhere and the DayLine font;
  - `/auth/me` read twice a load against a 10-a-minute auth bucket;
  - TenantGuard log noise and the socket greeting's old brand;
  - no CORS `maxAge`;
  - the role kept across a house switch, and "Owner" or `admin` read as no role (`AuthContext.tsx`, G9);
  - "items" on every other page.
- **Overlaps.** PR #565 rebases on this branch. The oldest-first, flagged *Waiting on you* work (`fix/waiting-on-you-oldest-first-flagged`) overlaps `WaitingOnYou.tsx`; it landed first as PR #581 (ADR 0256) and is merged into this branch with main, without conflict.
- **"Bottles" and "In the cellar" stay** until food lands; the founder is to be asked again then (W37).
- **What the PR #579 audit found.** The open entries are in `.planning/tech-debt.d/2026-10-01-fix-review-dashboard.md`:
  - the two order routes that still send prices to staff;
  - a failed alerts or activity read shown as an empty list, by the shared client and the page's own hook;
  - read errors reaching the client with table names and PostgREST text, through `HttpException(error.message)`;
  - three dashboard routes no page reads that still answer empty on a failed read (second audit).
- **Fixed in the first audit's round (G3).**
  - `seesHouseAmounts` now reads the /ask table through `policyFor`, as /ask does: it ignores case, and `admin` reads the owner row.
  - An add with no count reads "added", not "added, ".
- **Fixed in the second audit's round (G4, G5, G7).**
  - Running low and the gateway's alert say "Unnamed item" and "An item with no name" (W37, G7), and the W37 claim now sees bare text. [2026-10-02: it saw only a bare "Unnamed wine"; the other phrases still needed quotes. The third audit found this, and G8 widened the check.]
  - The page shows no amounts while the role is unknown (G5).
  - Three claims were tightened so that a comment, a one-route fix or `return true` no longer satisfies them.
- **Fixed in the third audit's round (G8).** No page or gateway code changed; three checks now test what their rows say. On scratch copies, 31 cases (28 mutations and 3 unmutated controls) all land as expected.
  - W37: every phrase is caught bare and in any letter case, the plural in any quote style, "A wine with no name" in the web files too, and `.ts` files are read.
  - W22: each money-bearing handler must pass `user?.role` from `@CurrentUser`. The guarded routes must call the guard as their first statement. `statsForRole` and `calendarForRole` are pinned whole.
  - The order-routes check (open) strips trailing comments and needs a call, not a bare word.
  - Not changed: the open zone check can still be closed by moving the `"UTC"` literal out of `houseZone`. Closing it needs a person to flip its status.
- **Queued for the shared batch (G9).** Clear the role on a house switch, and read roles as the gateway does (any case, `admin` as owner).
- **Audit reports (G10).** The local copies are dropped. The record cites the PR comments: round 2 https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/579#issuecomment-5945095412, round 3 https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/579#issuecomment-5962344610.
- **Free text and staff (G6).** The claim is narrowed to the amount fields; descriptions still reach staff, as before this PR. This is recorded here, not as a debt entry, because the founder named only the claim and gave a direction that redraws the line: once the POS is integrated and floor-coverage software runs, each waiter's stats are saved and waiters will be able to see table invoices. The staff-and-money line (W22) is to be redrawn then, not hardened now.
- **A house with no time zone (G2)** still reads as UTC on this branch. The fix, "—" and a line saying the zone is not set, is a follow-up PR, sketched first. It is tracked as an open claim and debt entry. [2026-10-08, #579 merging main: half closed by #622 (ADR 0290) — the month calendar now says the zone is unset; the stat cards still read UTC. See the DASH-G2 debt entry.]
- **Not verified:**
  - real touch;
  - a real screen reader;
  - reduced motion live;
  - production's page (Chrome);
  - the day panel's "Unnamed item" (no test).
