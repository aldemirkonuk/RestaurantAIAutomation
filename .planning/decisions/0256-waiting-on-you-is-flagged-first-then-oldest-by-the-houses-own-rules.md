# 0256 — "Waiting on you" is flagged first, then oldest, by the house's own rules

- **Status:** Locked 2026-10-01 by the founder. His eleven answers, in two rounds, are quoted verbatim under Founder answers. Answers 8-11 change the approve gate and are ruled, not built here (see Consequences). Answer 10 corrects a false premise in answer 8's option text.
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder), 2026-10-01, through AskUserQuestion, relayed by the lane coordinator.
- **Keywords:** Waiting on you, pending orders, listPendingOrders, GET /procurement/orders/pending, oldest first, flagged first, priority, price_jump, manager_ceiling, needs_signature, running_out, decideApproval, orderUnderTest, isBelowPar, unknown, WaitingFlag, readPricePremium, untestable, last price, approvalGate
- **Links:** branch `fix/waiting-on-you-oldest-first-flagged`; claim `claims.d/fix-waiting-on-you-oldest-first-flagged.jsonl:1`; specs `apps/api-gateway/src/procurement/pending-order-priority.spec.ts`, `apps/web/src/pages/dashboard/next/WaitingOnYou.flag.test.tsx`; rule sources [[0020-no-fabricated-answers]] (unknown is said, never silent); the approve gate this reuses is `ProcurementService.assertApprovalAllowed`; the stock predicate is `apps/api-gateway/src/common/stock-status.ts` `isBelowPar`.

## Context

Line numbers in this section are at 5a330a88e, this branch's merge-base with
main. Elsewhere they are as this branch leaves the files.

`GET /procurement/orders/pending` read the queue **newest first**
(`procurement.service.ts:7089`, `.order("created_at", { ascending: false })`),
and the dashboard card printed it as sent. The card's own header said the
opposite: `WaitingOnYou.tsx:3-4` called the queue "oldest first". Nothing in the
queue said which order deserved a look first. The house already decides that
in two places, but neither reached the queue: its approval rules
(`settings/approval-thresholds.ts` `decideApproval`) fire only when somebody
holds the seal (`assertApprovalAllowed`, `procurement.service.ts:4374`), and its
"below minimum" predicate (`common/stock-status.ts` `isBelowPar`) colours
/inventory and the low-stock alerts.

## Founder answers

### Round 1: the brief

1. Order: **"oldest first, flag priority ones"**.
2. Which flags: **"focus on this, money issue, order approval, large amount of order, item running out"**.
3. Mapping (offered: money issue = the price jumped against what the house last paid, by the house's `price_jump` rule and its threshold; order approval = a house rule says someone must sign, so the order is `APPROVAL_NEEDED` or an approval rule fired; large amount = over `manager_ceiling`; item running out = below its minimum or out of stock; no new settings): **"Yes, use the house rules (Recommended)"**.
4. Placement: **"Flagged first, then oldest (Recommended)"** — flagged rows on top, oldest first among them, then the rest oldest first.

### Round 2: the build's forks, 2026-10-01

Asked after this branch's first build. Each question, the answer chosen, and
the options he turned down are quoted as they were put to him. Answers 5-7
confirm what was built. Answers 8-11 are about the approve gate; 10 and 11 were
asked after 8 and 9, to correct one premise and settle one detail.

5. Unknown-only rows. Asked: "In 'Waiting on you', where should an order sort
   when none of its flags could be checked (e.g. the rules read failed)?"
   Chosen: **"With unflagged, say so (Recommended)"**: "Sort it among the
   unflagged orders, oldest first, with a 'Couldn’t check … just now' line. If
   unknowns sorted first, one failed read would flag every row." Turned down:
   "With flagged": "Sort it to the top with the flagged orders."
6. The mark. Asked: "In 'Waiting on you', a flagged order carries a mark that
   reads 'Focus on this' plus its reasons. Is that mark all you meant by 'flag
   priority ones'?" Chosen: **"Yes, the house-rules mark (Recommended)"**:
   "Built: the mark comes only from the house's own rules (price jumped, needs a
   signature, large order, running out)." Turned down: "Also a hand flag": "Add
   a flag a person can set on any order by hand. That's a new feature, built
   separately."
7. Two reasons. Asked: "When a large order or a price jump also needs a
   signature, the mark lists both, e.g. 'price jumped · needs a signature'. Keep
   both?" Chosen: **"Show every reason (Recommended)"**: "List each reason that
   fired; you named them as separate flags." Turned down: "Signature only as
   fallback": "Show 'needs a signature' only when nothing more specific fired."
8. A failed last-price read in the gate. Asked: "The approval check treats a
   failed 'last price' read as 'no earlier price', so the seal passes without a
   price-jump test. This predates the queue work. What should happen when it
   can't read the last price?" Chosen: **"Park for the rule's role
   (Recommended)"**: "Hold the order for whoever the price-jump rule names, the
   same way an untestable rule is handled today." Turned down: "Refuse, in
   words": "Refuse the approval with a sentence saying the last price couldn't
   be read; try again later."
9. One meaning of "the last price". Asked: "'The last price' means two
   different things today. The approval check uses the most recent other order
   of any age, even a later one. The 'held' line uses the order just before it,
   within 365 days. So the flag and 'held' can disagree. Which one should be
   used everywhere?" Chosen: **"Last approved/delivered before
   (Recommended)"**: "Use the last approved or delivered order placed before
   this one." Turned down: "Just before, within 365 days": "The 'held' line's
   current meaning." and "Most recent of any age": "The approval check's current
   meaning; it can include a later order."

**Correction: answer 8's chosen option rested on a false premise.** It says
"the same way an untestable rule is handled today", and this ADR's tech-debt
entry said the same ("as an untestable rule already does"). Neither was true
then, and this branch does not change the gate. A rule that cannot be tested
holds nothing: `decideApproval` puts it
in `untestable` and leaves `requiredRole` alone
(`settings/approval-thresholds.ts:154-157` for `manager_ceiling`, `:169-172`
for `new_vendor`), and the gate seals on `if (!decision.requiredRole) return;`
(`procurement.service.ts:4454`). A spec pins that: "a first-order count that
ERRORS is not read as 'first order'" (`order-approval-gate.spec.ts:414-428`)
expects `APPROVED`. The founder was asked again with the premise corrected.
Answer 10 is that question, and it settles which rules park; answer 8 still
stands for its outcome (park, not refuse). Answer 11 settles which order states
answer 9 counts.

10. Which rules park. Asked: "Correction: I told you an order whose rule can't
    be checked is held today. It isn't: when the new-vendor or large-order rule
    can't be checked, the approval goes through. You chose 'park' for a failed
    last-price read. Which rules should park the order for the rule's role when
    they can't be checked?" Chosen: **"Any rule that can't check
    (Recommended)"**: "Price jump, new vendor and large order all park for that
    rule's role when unreadable. Consistent, and follows ADR 0020. While a read
    is down, orders wait for someone holding that role." Turned down: "Only the
    last-price read": "Smallest change. New-vendor and large-order checks keep
    letting the approval through when unreadable, so 'couldn't check' is handled
    two ways."
11. Which states count. Asked: "'Last approved or delivered order before this
    one': which order states count?" Chosen: **"Any order that went ahead
    (Recommended)"**: "Approved, confirmed, in transit, delivered, partly
    received or completed." Turned down: "Only approved and delivered": "Read
    literally. A completed order, whose goods did arrive, would not count."

## Options considered

1. **Newest first, as now** — rejected. The newest order is the one least
   likely to be holding something up, and the card's own comment already
   promised the opposite.
2. **Most money first** — rejected. It ranks by a figure a staff viewer is not
   shown (DASH-W22, recorded on `origin/fix/review-dashboard`, not yet on
   main), and an expensive routine order would sit above a cheap one
   whose item is out.
3. **Large amount gets its own setting** — rejected. The house already states
   its large-amount line as `manager_ceiling`; a second number would be a
   second definition that drifts from the one the approve gate enforces.
4. **Oldest first, marked in place** — rejected for answer 4. Every row keeps
   its age order and a flagged one is only marked; a flagged order at the
   bottom of a long queue stays at the bottom.
5. **Flagged first, then oldest, by the house's own rules** — chosen.

## Decision

The gateway reads the queue oldest first (`created_at`, then `id`, ascending)
and moves flagged rows to the top without reordering either group. Each row
carries `priority: { flagged, reasons, unknown }`, where a reason is one of
`price_jump`, `needs_signature`, `manager_ceiling`, `running_out`. Nothing is
defined twice:

- `price_jump` and `manager_ceiling` are `decideApproval` firing those rules,
  over the facts the approve gate itself builds. `assertApprovalAllowed` and
  the queue now share one builder, `orderUnderTest`, so the flag and the
  refusal cannot disagree about the same order (pinned by the "flag and gate
  read the same facts" cases in the gateway spec).
- `needs_signature` is a row parked `APPROVAL_NEEDED`, or any enabled rule
  firing (`firedBy` not empty), `new_vendor` included.
- `running_out` is stock at or below zero, or `isBelowPar` against the item's
  `threshold_min`. A house that set no minimum has nothing to be below.
- A disabled rule raises nothing, because `decideApproval` tests enabled rules
  only. With no rule switched on, the per-order reads are skipped.
- **A reason is a word.** No amount, percent or count travels with it, so the
  flag holds for a viewer who is not shown money.

"Focus on this" is the mark itself, and the mark comes only from the house's
rules; there is no hand flag (answer 6). The card prints **Focus on this**
beside the reasons in words ("price jumped", "needs a signature", "large
order", "running out"). Every reason that fired is listed, so a large order
that also needs a signature shows both (answer 7).

**Unknown is said, not dropped** (answer 5). A failed read marks the reason
unknown and never fails the queue over a flag. Unknown covers: the rules could not be
read (or the rules service is not wired), the last-price read failed, the
order has no total, the first-order-to-vendor count failed, or the item's
stock was not read. `flagged` is true only on a reason actually found; a row
with only unknowns sorts with the unflagged rows and the card says "Couldn’t
check … just now." under it. "There is no earlier price" is not unknown: there
is nothing to compare, which is how the gate already reads it.

`GET /procurement/orders/pending/count` (the sidebar badge, polled every 30 s)
uses the same read without the flags, so the badge does not read the rules
twice a minute per tab. A failed read is still a 503 there, never `{ count: 0 }`.

## Consequences

- Everything that reads the queue in the order sent gets the new order: the
  dashboard card, the house counter's first five (`house-counter.service.ts`
  slices `listPendingOrders`), the phone's Supply "Open" list
  (`apps/mobile/app/(tabs)/supply/index.tsx`), and the approval cards the
  legacy `OneTapActionCenter` derives. The phone feed (`mobile.service.ts`
  `getFeed`) re-sorts by its own score, and that score caps age at 48 hours
  (`private score(`, `mobile.service.ts:262-287`, `Math.min(ageHours, 48)` at
  `:286`). Among approvals of the same feed priority, those younger than that
  still sort by age, oldest first, as before. Those 48 hours old or more all
  score the same, and the stable
  sort (`:164`) keeps them in the order the queue sent: now oldest first, where
  it was newest first. The flag does not enter that score. The `priority` key
  is additive; no consumer reads it except the card. The phone does not show
  the flag yet.
- The queue now costs one rules read per call (`ApprovalThresholdsService.read`,
  which also runs its retrospective), plus two small reads per pending order
  when a rule is on. The pending list is short by its status filter. A
  rules-only read is a possible later saving.
- Two callers pay that cost without reading the flag: the phone feed
  (`getFeed`, `mobile.service.ts:34`) and the house counter, which takes the
  first five (`house-counter.service.ts:175`). `readPendingOrderRows` has no
  row limit, so both pay the per-order reads for every pending order. Left as
  is on this branch; a flag-free read for those two callers is the fix if the
  cost shows.
- **Ruled 2026-10-01, not built here (answers 8 and 10):** the approve gate
  lets the seal through whenever an enabled rule cannot be tested: a FAILED
  last-price read reads as "no earlier price", and a missing total or a failed
  first-order count goes to `untestable` and holds nothing. The ruling is that
  any rule that cannot be tested parks the order for that rule's role, and
  `order-approval-gate.spec.ts:414-428` flips with it. The queue already tells a
  failed price read from no earlier price (`readPricePremium` returns
  `unread`), but the gate still ignores it, because a change to the gate is a
  separate operation. The follow-up PR is in
  `tech-debt.d/2026-10-01-fix-waiting-on-you-oldest-first-flagged.md`.
- **Ruled 2026-10-01, not built here (answers 9 and 11):** two readings of "the last
  price" disagree. The gate (and so this flag) compares with the most recently
  requested OTHER order for the item, any status, any age, even one requested
  after this one. `approvalGate` (`GET /procurement/order-approval-gate`, which
  DASH-W21's card reads for "held"; DASH-W21 is recorded on
  `origin/fix/review-dashboard`, not yet on main) compares with the order just before it,
  inside a 365-day window, as the settings retrospective does. On such an order
  the card's "held" line and this flag can disagree. The ruling is one meaning
  everywhere: the last order placed before this one that went ahead, meaning
  `APPROVED`, `CONFIRMED`, `IN_TRANSIT`, `DELIVERED`, `PARTIALLY_RECEIVED` or
  `COMPLETED` (states from
  `supabase/migrations/20260905230000_an_order_changes_state_by_the_table.sql:103-116`).
  The flag reads the gate's facts through `orderUnderTest`, so it follows the
  gate with no change of its own. Same register.
- The dashboard tour in PR #571 says only "Orders waiting for your approval"
  for this card, and its header-comment hunk on `WaitingOnYou.tsx` calls the
  queue newest first. After this lands, step 2 can say "flagged first, then
  oldest", and that comment hunk conflicts with this branch: keep this
  branch's wording. Follow-up for #571, not this branch.
- Revisit if a house asks for its own order of reasons, or when the phone
  shows the flag.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | — | Created, Locked on the founder's four answers |
| 2026-10-01 | — | Round 2 recorded: answers 5-7 confirm the build; 8-9 ruled for the gate, not built here; question 8's premise found wrong and its consequence filed open |
| 2026-10-01 | — | Answers 10-11 recorded: the corrected question makes any untestable rule park for its role; "went ahead" states fixed for the last price. Both ruled, not built here |
| 2026-10-01 | Sonnet verify | FIX-NEEDED. The `id` tie-break was pinned by nothing: the first build's "27 mutations all turned red" held for those 27, none of which touched it. Now pinned by a tied-`created_at` spec and the claim, each mutation-tested. The tech-debt entries' own proposals are marked "proposed, not ruled". Merge-base, phone-feed and DASH citations corrected |
