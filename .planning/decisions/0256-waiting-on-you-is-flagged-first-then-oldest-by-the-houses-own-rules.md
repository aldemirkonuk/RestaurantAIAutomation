# 0256 — "Waiting on you" is flagged first, then oldest, by the house's own rules

- **Status:** Locked 2026-10-01 by the founder. His four answers are quoted verbatim under Founder answers.
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder), 2026-10-01, through AskUserQuestion, relayed by the lane coordinator.
- **Keywords:** Waiting on you, pending orders, listPendingOrders, GET /procurement/orders/pending, oldest first, flagged first, priority, price_jump, manager_ceiling, needs_signature, running_out, decideApproval, orderUnderTest, isBelowPar, unknown, WaitingFlag
- **Links:** branch `fix/waiting-on-you-oldest-first-flagged`; claim `claims.d/fix-waiting-on-you-oldest-first-flagged.jsonl:1`; specs `apps/api-gateway/src/procurement/pending-order-priority.spec.ts`, `apps/web/src/pages/dashboard/next/WaitingOnYou.flag.test.tsx`; rule sources [[0020-no-fabricated-answers]] (unknown is said, never silent); the approve gate this reuses is `ProcurementService.assertApprovalAllowed`; the stock predicate is `apps/api-gateway/src/common/stock-status.ts` `isBelowPar`.

## Context

Line numbers are at c14aeca03, this branch's base.

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

1. Order: **"oldest first, flag priority ones"**.
2. Which flags: **"focus on this, money issue, order approval, large amount of order, item running out"**.
3. Mapping (offered: money issue = the price jumped against what the house last paid, by the house's `price_jump` rule and its threshold; order approval = a house rule says someone must sign, so the order is `APPROVAL_NEEDED` or an approval rule fired; large amount = over `manager_ceiling`; item running out = below its minimum or out of stock; no new settings): **"Yes, use the house rules (Recommended)"**.
4. Placement: **"Flagged first, then oldest (Recommended)"** — flagged rows on top, oldest first among them, then the rest oldest first.

## Options considered

1. **Newest first, as now** — rejected. The newest order is the one least
   likely to be holding something up, and the card's own comment already
   promised the opposite.
2. **Most money first** — rejected. It ranks by a figure a staff viewer is not
   shown (DASH-W22), and an expensive routine order would sit above a cheap one
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

"Focus on this" is read as the mark itself: the card prints **Focus on this**
beside the reasons in words ("price jumped", "needs a signature", "large
order", "running out").

**Unknown is said, not dropped.** The brief allowed two answers to a read that
fails: mark the reason unknown, or fail the read. This branch marks unknown
and never fails the queue over a flag. Unknown covers: the rules could not be
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
  `getFeed`) re-sorts by its own score and is unchanged. The `priority` key is
  additive; no consumer reads it except the card. The phone does not show the
  flag yet.
- The queue now costs one rules read per call (`ApprovalThresholdsService.read`,
  which also runs its retrospective), plus two small reads per pending order
  when a rule is on. The pending list is short by its status filter. A
  rules-only read is a possible later saving.
- **Found, not fixed here:** the approve gate treats a FAILED last-price read
  as "no earlier price" and lets the seal through. The queue now tells the two
  apart (`readPricePremium` returns `unread`), but the gate still ignores it, to
  keep this branch's behaviour change to the queue. Recorded in
  `tech-debt.d/2026-10-01-fix-waiting-on-you-oldest-first-flagged.md`.
- **Found, not fixed here:** two readings of "the last price" disagree. The
  gate (and so this flag) compares with the most recently requested OTHER
  order for the item, any status, any age, even one requested after this one.
  `approvalGate` (`GET /procurement/order-approval-gate`, which DASH-W21's card
  reads for "held") compares with the order just before it, inside a 365-day
  window, as the settings retrospective does. On such an order the card's
  "held" line and this flag can disagree. Same register entry.
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
