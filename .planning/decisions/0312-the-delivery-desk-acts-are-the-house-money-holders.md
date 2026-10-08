# 0312 — The delivery desk acts are the house-money holders'

- **Status:** Locked 2026-10-08 under delegation. **Decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation, not by the founder.** It is not his pick, and he may overturn it.
- **Date:** 2026-10-08
- **Decider:** the coordinator (session 05c659bb), under the founder's delegation quoted below. The template's line, "decisions are locked by the founder, never by an agent", is suspended for this goal by that delegation and by nothing else.
- **Keywords:** deliveries.controller, delivery desk, propose, counter, accept, accept-as-billed, agree, verify, finalise_delivery_cost, finaliseAtVerified, assertDeliveryDesk, delivery-desk-gate.ts, holdsHouseMoney, assertHoldsHouseMoney, ROLE_POLICY, money holder, segregation of duties, D9 half rung, halfRungAudience, owner_user_id, verify-receipt, costPerBottle, OD-223
- **Links:** [[0103-a-delivery-is-agreed-before-it-is-verified]] (D1, D6, D7, D9, A1, A6, A11, A12); [[0145-mudavym-answers-out-of-a-reading]] (`ROLE_POLICY`); [[0167-the-receiving-queue-and-credit-ledger-refuse-staff]]; [[0284-a-delivery-event-follows-its-order]]; PR #659 (`fix/document-money-writes-for-holders`, head `81599fcf4`, not merged when this was written); `claims.d/fix-the-delivery-desk-is-for-holders.jsonl`; `tech-debt.d/2026-10-08-fix-the-delivery-desk-is-for-holders.md`; OD-223; research workflow `wf_b869a1f4-07a` (four finders, one decider, one refute pass).

## The delegation (verbatim)

The founder, 2026-10-07T20:04:10Z: *"keep working until the restaurant analytics and other pages can serve to real retaurant with every possible scenario. Do not ask me questions, I allow and approve for you to decide on your own. If its a decision question then research deep, find answers. While you can change decisions, you cannot change any feature we decided unless it breaks everything then only you can, but before that you should research. Do not stop until then"*

## Context

All line numbers below are at the head of `fix/the-delivery-desk-is-for-holders` that carries this file, unless a line says otherwise.

`DeliveriesController` (`apps/api-gateway/src/procurement/deliveries.controller.ts:87`) carried `JwtAuthGuard` and nothing else. Any member of the house, staff included, could propose, counter, accept, accept as billed, agree and verify.

Verify posts cost. `DeliveryService.verify` calls `finaliseAtVerified` (`canonical/delivery.service.ts:965`), which calls the rpc `finalise_delivery_cost` (`canonical/delivery-stock.service.ts:415`) for each item the door count booked that an agreed price reaches. A door-count lot is booked provisionally with **no price** (`delivery-stock.service.ts:34-37`), and verify is where it takes one.

Staff could set a lot's final cost alone, end to end:

1. Post a proposal with a `unit_price_proposed` (`delivery.service.ts:456`, `:518`). The caller picks the side.
2. Accept it (`:661`). Nothing checks the role.
3. Agree. A vendor-side row counts as the vendor's position (`:1489`), and the difference scan flags only a substitution or a quantity difference, never a price (`:1832`).
4. Verify. `agreedPrices` reads accepted proposals' `unit_price_proposed` as the item's price (`delivery-stock.service.ts:656`, `:764-797`, source `accepted_proposal`).

PR #659 gated the vendor-document money writes and filed this controller as an OPEN fork in its tech-debt fragment.

## The fork

Is a delivery's verify a receiving act (open to staff), a books act (owner or manager), or should it split in two? And which of the other desk acts follow it?

## Research

A four-finder workflow covered the code paths, the policy ADRs, the founder's rulings and industry practice. The industry sources (Lightspeed's separate receive-to-inventory permission, xtraCHEF capture-only roles, Craftable approvals, the NetSuite and SAP three-way-match approver, AGA and NY OSC internal-control guidance) come from a finder's extracts. They were spot-checked and not re-fetched. They agree on segregation of duties: the receiver counts, and someone else approves the price and posts the cost.

A refute pass then tried to kill the answer. The core assignment survived. The pass found seven holes, and this ADR and its two PRs carry all seven amendments:

1. Several replacement sentences said more than the code does. They are rewritten (see "Prose").
2. The no-door-count verify case is now stated (see "Why verify is gated even when it posts nothing").
3. The D9 half rung is repaired in the same change (see "D9").
4. The non-holder cost writers outside this controller are listed (see "Consequences").
5. The gate mirrors #659's shape exactly (see "Mechanism").
6. #659's fork 4 is restated (see "#659's fork 4").
7. The door-count-onto-VERIFIED gap is filed as OD-223.

## Options considered

1. **Status quo: verify stays open as a receiving act.** Rejected. It posts cost, and with propose, accept and agree open, staff set a lot's cost alone (the chain above). ADR 0145's money row gives staff no money (`apps/api-gateway/src/ask-readings/reading-data-classes.ts:182`).
2. **Split verify: staff assert the goods, a holder posts the cost.** Rejected for now. It needs a state between AGREED and VERIFIED plus a migration, and ADR 0103 D1 has two gates, not three. The goods half already exists at the door: the door count books stock (`documents/documents.controller.ts:973`). Revisit when an automated price-variance check exists.
3. **Gate verify only.** Rejected. The price verify posts is fixed earlier, by an accepted proposal. A holder's verify would rubber-stamp a number staff set, with no recorded difference to challenge it (`delivery.service.ts:1832`).
4. **Gate only price-variance proposals.** Rejected. `agreedPrices` reads any accepted proposal's price, whatever its reason class (`delivery-stock.service.ts:764-797`). A per-reason-class right is a new policy that no ADR has made.
5. **`RolesGuard` + `@Roles('owner','manager')` (ADR 0167's pattern).** Rejected. Its 403 has no sentence. It is exact-match, so it refuses `admin` where `holdsHouseMoney` admits it, which splits the money predicate between controllers. It moves `route-access.expected.json`, which open PRs edit. And it cannot admit a per-person money right later (ADR 0253 r10). #659's fork 1 rejected it on the same grounds.
6. **A role check inside `DeliveryService`.** Rejected. The service signatures carry no role, and the house pattern refuses at the controller before any service call. A service gate would also hit in-process callers that are not people.
7. **Hide the controls in the web only.** Rejected. Any member's token can POST these routes directly.
8. **Copy a `holdsHouseMoney` equivalent so this need not wait for #659.** Rejected. Two copies of the money predicate drift.
9. **Wait for the per-person money right (ADR 0253 r10).** Rejected. It is not built, and meanwhile staff can set cost alone.

## Decision

**Verify is a books act, and it does not split now.** Six writes on `deliveries.controller.ts` are acts for house-money holders only: owner or manager, by ADR 0145's money row (`policyFor(role).sees` contains `"money"`), through #659's `holdsHouseMoney`. `admin` reads the owner row.

| Route | Who | Gate line |
|---|---|---|
| `GET /` list | every member | none |
| `POST /` create | every member | none |
| `GET :id` | every member | none |
| `GET :id/proposals` | every member | none |
| `POST :id/documents` link | every member | none |
| `POST :id/proposals` propose | owner, manager | `:217` |
| `POST proposals/:pid/counter` | owner, manager | `:243` |
| `POST proposals/:pid/accept` | owner, manager | `:265` |
| `POST :id/accept-as-billed` | owner, manager | `:302` |
| `POST :id/agree` | owner, manager | `:324` |
| `POST :id/verify` | owner, manager | `:342` |
| `POST clocks/run` | platform operators (`PlatformOperatorGuard`), unchanged | none |

**Mechanism.** `apps/api-gateway/src/procurement/canonical/delivery-desk-gate.ts` exports `assertDeliveryDesk(user, act)`. It trims the role, decides through `holdsHouseMoney`, and throws `HttpException(..., HttpStatus.FORBIDDEN)` with a sentence. That is the shape of #659's `assertHoldsHouseMoney` (`documents/document-money-gate.ts:26`, `:58`, from #659's branch). Each of the six handlers calls it as its first statement, before any `this.deliveries`, `this.spine` or `this.clocks` call, so a refusal writes nothing. `AuthedUser` (`deliveries.controller.ts:35`) now carries the token's `role`, which `JwtStrategy` re-derives from the access row on every request.

The refusal says what the act is, who the session is at this house, that nothing changed, and who can do it. A staff member is told the door count and the photograph still go through for them.

### Why verify is gated even when it posts nothing

With no door count, verify posts no cost: the note reads *"This delivery booked no stock at the door, so there was no cost to settle."* (`delivery.service.ts:989`). That is ADR 0103 A6's modal case. It is also the case for every delivery received only through the legacy door, which settles through `orders/:id/verify-receipt` instead.

Verify stays a holder's act there anyway, for three reasons:

- **It is still the books' last word.** It moves the delivery from AGREED to VERIFIED, and AGREED is already a money-bearing state, reached only through the gated desk.
- **It cancels the delivery's open clocks** (`delivery.service.ts:953`), the payment clock included.
- **One rule is easier to reason about.** A route whose role depended on whether a door count exists would change who may press the button with the data. Staff would see the control appear and vanish.

A6 still holds. A named person asserts receipt, and that person is now a holder.

### D9: the half rung reaches someone who can act

ADR 0103 D9 clause 1 (locked) re-notifies the delivery's **owner** at 50 % of the clock, so that someone who can act is told in time. A delivery a door count creates is owned by the person who counted it. `documents.controller.ts:937-946` calls `create` with no `ownerUserId`, and `create` sets `owner_user_id = input.ownerUserId ?? userId` (`delivery.service.ts:297`). Once the desk is gated, a staff owner can no longer move that delivery. Before this change, the first notice a holder got was the 80 % broadcast: day 5 of a Turkish 7-day window.

**Chosen:** when the owner is not a money holder at the house, the 50 % rung goes to the house's money holders instead (`DeliveryClockService.halfRungAudience`, `canonical/delivery-clock.service.ts:631`, used at `:478` and `:514`):

| Case | Who gets the 50 % notice |
|---|---|
| A holder owns the delivery | that owner, as before |
| A non-holder owns it | every active member of the house whose role holds the money |
| Nobody at the house holds the money | the owner, since there is no one else to name |
| No owner on the delivery | the house-wide write, as before |
| The access read failed | the house-wide write, so the notice is not narrowed on a guess |

**Rejected:** defaulting a door-created delivery's `ownerUserId` to a holder. That changes who owns the delivery, which other code and the D9 deputy ladder read. Choosing the holder automatically would also be a new rule with no ruling behind it. This change leaves ownership exactly as it was.

The spec covers a staff-created delivery reaching 50 % (`delivery-clock.service.spec.ts`, "the half rung reaches someone who can act").

### #659's fork 4, restated

#659's fragment says keeping `POST /procurement/documents/:id/lines/:lineId/link-item` open is safe "only once the verify is a holder's act". This ADR makes verify a holder's act. The precondition therefore **holds for verify, not for link or link-item**.

`POST :id/documents` (`deliveries.controller.ts`, link) and the documents `link-item` route stay open to staff. A holder who verifies will post prices that staff-linked items carry, and verify shows no per-item price preview. A per-item price preview on the verify confirmation is filed as a follow-up, not built. #659's branch files are not edited here.

### Prose

Several sentences on the delivery path said verify writes no cost, or claimed more than the code does. This branch corrects the controller's header and the verify description. The service, stock and door-count sentences, and the web's verify lines, are corrected on the companion branch `fix/the-delivery-desk-says-what-verify-posts`. Where the code is narrower, the new text is narrower:

- A door-count lot is booked "provisionally, with no price yet", not "at a provisional cost".
- No sentence says the response names each item's cost. `costNote` gives counts.
- No sentence says a cost is "posted again". A re-verify returns at `delivery.service.ts:911-919` and posts nothing.
- An agreed price becomes an item's cost only "where an agreed price reaches the item". `agreedPrices` skips null prices.

ADR 0284's at-the-door ruling (2026-10-02, "At the door (Recommended)") is about where the order's event completes. Its reservation release at the door is **ruled 2026-10-02 and not built** on `main`: the only release is the legacy `markDelivered` shadow release (`procurement.service.ts:5395-5404`). This ADR does not touch it, and no new sentence cites it as shipped.

`DoorCountDto` has no damage or refusal field, only a free-text `note` (`dto/deliveries.dto.ts:157-240`). On a canonical delivery, a damaged or refused fact reaches the record only through a proposal, which is now a holder's act. The legacy door receipt's damage and photo never reach the canonical delivery. Nothing here says staff's door facts already reach the record.

### The web

The companion branch stops `/documents/:id` offering agree, verify, propose, counter and accept to non-holders, and shows them one sentence in their place.

### Delivery

The change is split into two PRs because together they exceed the 15-file cap. Both land after #659:

- **PR A, `fix/the-delivery-desk-is-for-holders`:** gate, clock and specs, plus this record.
- **PR B, `fix/the-delivery-desk-says-what-verify-posts`:** web and prose. It lands after A.

## Kept features

- ADR 0103 D1: AGREED and VERIFIED stay two acts.
- D6: both gates stay human.
- A6: a named person asserts receipt.
- A11: differences are still answered before AGREED.
- D9: the ladder, its floors and the deputy rung are unchanged. Only the 50 % target moves, and only when the owner cannot act.
- ADR 0167: the door routes stay open.
- The door count, the photograph, creating a delivery and attaching a document stay open to every member.
- The door stays open on every delivery state it accepted before. OD-223 asks whether it should refuse VERIFIED, and it is not changed here.
- The verify button label.

## Consequences

- **Staff can no longer agree, verify or negotiate a delivery.** A house with no holder on shift waits for one. Meanwhile its door-counted stock sits pourable on the shelf, provisionally and with no price.
- **The admin divergence.** `holdsHouseMoney` admits `admin` (`ROLE_POLICY_ALIASES`, `reading-data-classes.ts:241`). The web check and `RolesGuard` refuse it.
- **ONLY THE CANONICAL DELIVERY DESK IS CLOSED.** The census of non-holder cost writers outside it, M1 priority, each with an OPEN CLAIMS row whose verify must not hold until the writer is gated:

  1. **`POST /procurement/orders/:id/verify-receipt`**
     - Route: `procurement.controller.ts:661-689`, `JwtAuthGuard` only (`:119`).
     - Cost write: `applyReceiptAdjustment` calls `revalue_lot` with `'invoice'` provenance (`procurement.service.ts:6084-6091`).
     - Callers: the live web and mobile receiving paths.
     - CLAIMS row: `COST-WRITER-VERIFY-RECEIPT-REFUSES-A-NON-HOLDER`.
  2. **`POST /inventory/:restaurantId/items` and `/items/bulk` with `costPerBottle`**
     - Gate: `assertMayPrice` runs only when the body names a menu price (`inventory/inventory.controller.ts:183`, `:223`).
     - Cost write: `resolveLotCost` (`inventory.service.ts:850`) and the bulk line (`:1403`, `:1417`) file the cost as `'manual'`. `apply_stock_movement` (migration `20261222100000`, `:177-183`) makes a priced `'manual'` lot final.
     - CLAIMS row: `COST-WRITER-INVENTORY-COST-PER-BOTTLE-IS-A-HOLDER-ACT`.
     - The comment at `inventory.service.ts:872-879` claimed the controller refused any priced create. It is bracket-corrected in place.

  The refute pass found none of these calling `finaliseAtVerified` or the desk routes: the Python agents, MCP/Ask, the batch jobs, and `inventory-ledger` `createTransaction` (`inventory-ledger.service.ts:77`; by the refute pass's reading it passes a price with no provenance, so the RPC raises). The `finalise_delivery_cost` grant to `anon` and `authenticated` (migration `20260906233000`, `:399`) is likely harmless, because the function is SECURITY INVOKER and `inventory_lots` has RLS with no policy. That was not fully checked, and it is filed.
- **A cost that failed to post cannot be posted again.** A re-verify returns early (`delivery.service.ts:911-919`). Filed, with OD-223.
- **What would trigger revisiting this:**
  - An automated price-variance or three-way-match check exists. A clean match could then post without the desk, which reopens the split.
  - ADR 0253 r10's per-person money right lands. Widen `holdsHouseMoney`, not the six call sites.
  - A real house shows deliveries stalling for lack of a holder on shift.

## Proof

- `apps/api-gateway/src/procurement/deliveries.desk-gate.spec.ts`:
  - All six desk routes refuse staff, `waiter`, an empty role, `null` and no role with a 403 and the act's own sentence, and no service is touched.
  - Owner, manager, `admin` and `Owner` reach the service once, with the token's house.
  - The five door and read routes still reach their services for staff.
- `canonical/delivery-clock.service.spec.ts`: five half-rung cases.
- Five CLAIMS rows in `claims.d/fix-the-delivery-desk-is-for-holders.jsonl`: three resolved and two open. They were mutation-tested in scratch: each gate removed turns a spec and a row red.
- Gateway `tsc --noEmit`: only the known `@simplewebauthn/server` errors.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-08 | coordinator (workflow `wf_b869a1f4-07a`: four finders, decider, refute) | Created; the refute pass's seven amendments carried |
