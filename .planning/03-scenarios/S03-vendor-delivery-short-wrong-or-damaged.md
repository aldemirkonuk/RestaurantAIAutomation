---
type: scenario
id: S03
slug: vendor-delivery-short-wrong-or-damaged
class: problem
actors: [vendor-driver, receiver, manager, invoice-pipeline, credit-ledger, inventory-system]
modules: ["[[inbound-understanding-charter|inbound-understanding]]", "[[procurement-vendor-network-charter|procurement-vendor-network]]", "[[inventory-ledger-charter|inventory-ledger]]"]
signals: [receiving-count, damage-photo, packing-slip, invoice-document, credit-memo, match-verdict, nf_a]
insights_class: [vendor-reliability, recovered-credit, short-damage-rate, cogs-leakage]
tier: undecided
sim_harness: synthetic-engine
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[S02-vendor-delivery-arrives]]", "[[inbound-understanding-charter]]", "[[procurement-vendor-network-charter]]", "[[inventory-ledger-charter]]"]
---

# S03 — Vendor delivery is short, wrong, or damaged

The failure twin of [[S02-vendor-delivery-arrives]]. Same door, same truck — but the
count doesn't match the paper, or the goods arrive broken. S02 walks the clean path;
this walks every way it breaks, and the one product decision that matters: **we do not
report money as recovered until a credit memo lands.**

## 1. Trigger
A delivery arrives whose received quantity, billed quantity, or condition disagrees with
what was ordered. Bounded: from the door-count that first exposes the gap to a credit
claim that is *opened but never auto-sent*, tracked through to settlement or write-off.
The verdict engine already exists — `invoice-match.ts` is "the single source of truth for
the match verdict (backend authority)" (`apps/api-gateway/src/procurement/invoice-match.ts:2`)
and enumerates nine outcomes (`:42-51`); the credit state machine is
`documents/credit-ledger.ts`.

## 2. Actors
Driver (external, no account, often gone before anyone counts) · receiver (a porter or
prep cook at the door, not the manager — S02's asymmetry holds:
`receiving.service.ts:5-24`) · manager (the only actor who may approve a credit draft) ·
the invoice-understanding pipeline · the credit ledger · inventory ledger, which was
stocked *optimistically* at invoice quantity before anyone counted
(`invoice-match.ts:96-102`).

## 3. Signals
- **Receiving counts, two stages.** A fast case-count at the door books stock to LIVE
  immediately; the real bottle-count happens hours later by whoever breaks the case
  (`receiving.service.ts:25-40, 96`). The gap between them is where silent shorts hide.
- **Damage as a photo, not a typed reason** — `damagePhotoPath` on the door receipt
  (`receiving.service.ts:55-56`). A refused unit is `rejectedQty`, kept distinct from a
  short ship so the remedy is right.
- **Four documents, not two.** PO (850), packing slip / ASN (856), invoice (810), and the
  credit memo (812) that closes the loop (`.planning/YC_WEDGE_PLAN.md:14-20`). The slip is
  the leverage: when the vendor's own ship notice and invoice disagree, "there is nothing
  left to dispute" — verdict `overbilled_vs_ship`, the highest-confidence claim the system
  can make (`invoice-match.ts:13-16, 44`).
- **The match verdict itself** is a captured signal, recomputed as documents arrive; a
  null check means "document absent," never "agreement" (`invoice-match.ts:107-108`).
- **NF-A agent events** (parse cost, verdict, confidence) — **still not emitted**, the same
  L4 gap S02 names. Any insight that claims per-parse agent economics is fiction today.

## 4. Queries the product must answer
- "Did we get what we ordered, at the price we agreed?" — the three-way match, extended to
  four documents where a packing slip exists (PO ↔ slip ↔ invoice ↔ received).
- "Is this a carrier problem or a billing problem?" — short-vs-slip is goods lost between
  warehouse and door; over-vs-slip is a billing error. Different counterparties, different
  remedies (`.planning/YC_WEDGE_PLAN.md:27-29`).
- "Is this discrepancy chargeable *yet*?" — an unpriced short is real but not billable; a
  `$0` claim in a distributor's inbox costs more credibility than it recovers
  (`credit-ledger.ts:163-182`).
- "How much have we actually recovered from this vendor?" — and the honest answer is
  **only what a credit memo settled**, never what we asked for.

## 5. Outputs (in the moment)
- Discrepancy lines highlighted on the receiving checklist; the web mirror
  `apps/web/src/lib/invoiceMatch.ts` gives the receiver live feedback while counting, with
  the backend verdict as authority (`invoice-match.ts:38`).
- One headline verdict per line, ordered by evidentiary strength then severity — a manager
  drowning in nine equal alerts reads none (`invoice-match.ts:281-290`).
- On a claimable verdict: a **credit claim opened in state `open`, never sent.** Contacting
  the distributor stays a human act behind the draft-then-approve flow used everywhere else
  in this codebase (`procurement.service.ts:1092-1130`). Free-goods and negotiated bonuses
  are netted out first, so "11 for 10" never fires a false overage alarm
  (`invoice-match.ts:80-86`).

## 6. Insights the owner sees (the payoff)
- **Recovered-credit ledger, honestly split:** `recovered` (settled, evidenced by a memo)
  vs `outstanding` (asked, unsettled) vs `promised` ("the rep said next order") vs
  `rejected` — four separate numbers, and only the first is safe to advertise
  (`credit-ledger.ts:184-264`). Settlement rate is `null`, not `0%`, until something
  resolves, so a new vendor doesn't read as one that refuses everything.
- **Vendor reliability:** short rate, damage rate, over-bill rate, and oldest-open-claim age
  — the manager's real work queue (`credit-ledger.ts:194-195`).
- **COGS leakage:** what shorts and unrecovered overbills cost over a window, traced to the
  specific deliveries that caused them.
- All of the above are procurement-side signals — they sit inside the **25.1% no-POS
  satisfiable band** (SCENARIO-CONTRACT §5). No insight here claims per-parse agent cost;
  that waits on NF-A.

## 7. Decisions
Human decides: accept/reject each line, approve or hold the credit chase, write off an
ageing claim, escalate or drop a vendor. The system **proposes only** (ask→propose→confirm
→execute): the verdict, the drafted claim with its computed amount and whether it is
self-evidenced by the packing slip (`credit-ledger.ts:156-182`), and the state transition
options. `credited` is terminal and demands a `creditDocumentId` — a promise counted as
recovery is exactly the lie the ledger refuses to write (`credit-ledger.ts:98-124`).

## 8. Failure modes
- **Claimed reported as recovered** — the one unrecoverable credibility failure. Guarded
  structurally: `recovered` sums only `creditedAmount` in state `credited`
  (`credit-ledger.ts:7-16, 216-219`).
- **Invoice parsed wrong → wrong verdict → wrong claim or none** (silent, compounding — the
  same root risk as S02 §8).
- **Nobody ever counts bottles.** The case moved to LIVE at the door; the short is stranded
  forever unless the uncounted-delivery query fires (`receiving.service.ts:36-49`).
- **`promised` treated as settled** — the single most common thing that happens to a
  beverage claim; it gets its own state so it can be aged and chased, not assumed
  (`credit-ledger.ts:45-51`).
- **Double-claiming** the same line on a re-run of the match (guarded by a unique-claim
  constraint, 23505 → no-op: `procurement.service.ts:1132-1134`).
- **Over-crediting** (vendor settles two claims on one memo) is legal but surfaced rather
  than silently inflating recovery (`credit-ledger.ts:113-115`).

## 9. Simulation & deploy gate
The synthetic engine generates, against a synthetic PO/slip/invoice book: clean · short-vs-
slip (carrier) · over-vs-slip (billing) · damaged/rejected · unpriced-short (real but not
chargeable) · free-goods overage (must NOT alarm) · promised-then-credited · promised-then-
rejected. Gate: a change to the match or credit path ships only when every variant yields
the correct verdict, the correct claimable/not-claimable decision, and a recovery figure
that moves **only** on the memo-settled variant. Release Engineering owns the gate; Data
owns the harness.

## 10. Tier cut (proposed — OD-48; frontmatter stays `undecided`)
- **Core (operate):** the match verdict + discrepancy flag at the door. You can receive a
  broken delivery and know it's broken.
- **Plus (understand):** vendor reliability scorecard + the drafted, human-approved credit
  claim.
- **Pro (optimize):** the settled-recovery ledger with ageing, cross-vendor short/damage
  benchmarking, and proposed write-offs on dead claims.

## 11. Evolution feedback
Where receivers override the door count tells us where the two-stage flow leaks. Which
verdicts managers dismiss without acting tells us which are noise. The gap between claims
opened and claims *settled* — the settlement rate per vendor — is the sharpest signal the
product produces: a vendor whose claims never land is itself the finding.

**Flex points:** counting unit at the door (case vs each) · who counts bottles and when
(the 2pm break vs never) · credit policy (chase every claim vs a dollar threshold vs
self-evidenced only) · write-off horizon for ageing claims · whether a packing slip is
expected at all (many small distributors send none).
