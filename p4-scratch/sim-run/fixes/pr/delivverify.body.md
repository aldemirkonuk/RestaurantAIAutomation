**Merge order:** after #659 (`fix/document-money-writes-for-holders`). This branch merges #659 locally, at its head of the time, `81599fcf4`. The web and remaining prose follow in `fix/the-delivery-desk-says-what-verify-posts`, which lands after this one.

## Why

`DeliveriesController` carried `JwtAuthGuard` and nothing else. A staff token could set a lot's final cost alone:

1. Post a proposal with `unitPriceProposed` (`canonical/delivery.service.ts:456`, `:518`).
2. Accept it (`:661`). Nothing checks the role.
3. Agree. A vendor-side row counts as the vendor's position (`:1489`), and the difference scan flags only a substitution or a quantity difference (`:1832`).
4. Verify. `finaliseAtVerified` (`:965`) calls `finalise_delivery_cost` (`canonical/delivery-stock.service.ts:415`) with the accepted proposal's price (`agreedPrices`, `:656`, `:764-797`).

ADR 0145's money row gives staff no money (`ask-readings/reading-data-classes.ts:182`). #659 filed this controller as an OPEN fork.

## What changes

**The gate.** New `canonical/delivery-desk-gate.ts` exports `assertDeliveryDesk(user, act)`.

- It decides through #659's `holdsHouseMoney`: owner and manager pass, and `admin` reads the owner row.
- It refuses everyone else with `HttpException(..., FORBIDDEN)`. The sentence names the act, the session's role at this house, that nothing changed, and who can do it.
- It has the same shape as `assertHoldsHouseMoney`.

**The controller** (`deliveries.controller.ts`):

- The six desk handlers call the gate as their first statement: propose `:217`, counter `:243`, accept `:265`, accept-as-billed `:302`, agree `:324`, verify `:342`.
- `AuthedUser` carries `role` (`:35`). Each of the six has `@ApiForbiddenResponse`.
- List, create, read, proposals and link are unchanged, so the door count and photograph stay open.

**Controller prose.**

- The header no longer says no route writes cost (`:69`, `:78`).
- The verify description now says:
  - it posts cost for each item the door count booked, provisionally and with no price yet, that an agreed price reaches;
  - a delivery the door count never booked posts nothing;
  - it is an owner's or a manager's act either way;
  - a second verify posts nothing.

**D9's half rung** (`canonical/delivery-clock.service.ts:476-514`, `halfRungAudience` `:631`). A door-created delivery is owned by whoever counted it (`delivery.service.ts:297`; `documents.controller.ts` passes no `ownerUserId`). That person can no longer act on it.

| Case | Who gets the 50 % notice |
|---|---|
| The owner is not a holder | the house's active holders |
| The owner is a holder | the owner, as before |
| Nobody at the house holds the money | the owner |
| No owner, or the access read failed | the house-wide write |

Who owns the delivery is not changed.

**The inventory comment.** `inventory.service.ts:874-879` is bracket-corrected. It said the controller refuses every priced create, but it refuses only a create that names a menu price.

**Records:**

- ADR 0312, with one new README row;
- OD-223, appended at the end of `OPEN-DECISIONS.md` so no register citation shifts;
- a tech-debt fragment;
- five CLAIMS rows: three resolved, and two OPEN, one for each residual cost writer.

## Decision

Verify is a books act, and it does not split. The six desk acts belong to the house-money holders.

**This is the coordinator's call under the founder's delegation, not the founder's pick.** The founder, 2026-10-07T20:04:10Z:

> "keep working until the restaurant analytics and other pages can serve to real retaurant with every possible scenario. Do not ask me questions, I allow and approve for you to decide on your own. If its a decision question then research deep, find answers. While you can change decisions, you cannot change any feature we decided unless it breaks everything then only you can, but before that you should research. Do not stop until then"

It was researched by workflow `wf_b869a1f4-07a`: four finders, a decider, and a refute pass whose seven amendments are all carried. The ADR also covers:

- why verify is gated even when it posts nothing (A6);
- #659's fork 4, restated as "holds for verify, not for link or link-item";
- the census of non-holder cost writers.

## Rejected

- Status quo: verify posts cost.
- Split verify: needs a third state and a migration. The goods half already exists at the door.
- Gate verify only: the price is fixed at accept.
- Gate only price-variance proposals: `agreedPrices` reads any accepted price.
- `RolesGuard` / `@Roles`: a 403 with no sentence, it refuses `admin`, and it moves `route-access.expected.json`.
- A service-level check.
- Web-only hiding.
- A copied predicate.
- Waiting for the per-person money right.
- Defaulting a door-created delivery's owner to a holder: that changes ownership.

## Evidence

- `npx jest src/procurement` (gateway): 99 suites passed, 1 skipped; 2075 tests passed, 3 skipped.
  - `deliveries.desk-gate.spec.ts` covers all six routes against staff, waiter, an empty role, null and no role (403, no service touched), and owner, manager, admin and `Owner` (one call, the token's house). It also checks that five open routes still serve staff.
  - The clock spec has five half-rung cases.
- Gateway `tsc --noEmit`: only the known `@simplewebauthn/server` errors (2, `passkeys.service.ts`).
- Mutations ran in scratch with `cp -p` and `cmp` restores.
  - Removing each of the six asserts turns the gate spec and `DELIVERY-DESK-ACTS-ARE-FOR-HOUSE-MONEY-HOLDERS` red.
  - Restoring the owner-only half rung turns the clock spec and `DELIVERY-HALF-RUNG-REACHES-A-MONEY-HOLDER` red.
  - Restoring the stale header, or dropping the no-door-count sentence, turns `DELIVERY-CONTROLLER-SAYS-VERIFY-POSTS-COST` red.
  - Gating verify-receipt, or naming `costPerBottle` beside `assertMayPrice`, flips each OPEN row to holding. So each will fail the build once its writer is fixed and its row is not struck.
- ADR, citation-pairing and OD-id guards: PASS.

## Not done

- **The two residual non-holder cost writers stay open:** `orders/:id/verify-receipt`, and inventory `costPerBottle` on items and items/bulk. They are M1 and need their own lanes. This PR closes only the canonical delivery desk.
- **A cost that failed to post cannot be posted again.** OD-223 also asks what a door count onto a VERIFIED delivery should do.
- **Follow-ups filed in the fragment, not built:**
  - money reads (M2);
  - accept on a settled delivery;
  - `cancelFor` against A3;
  - the `finalise_delivery_cost` grant;
  - the admin divergence;
  - a per-item price preview before verify;
  - the lapse sentences.
- **Not run here:** web tests, which have no web files in this PR.
- **The file count.** Measured against #659's moved tip `10642298c`, `git diff --name-only origin/fix/document-money-writes-for-holders...HEAD` reports 21 files, because the merge base resolves to `62f8967b4`. The two-dot diff against that tip is 11 files, all this PR's own.
- Nothing was pushed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
