## The approve gate reads a failed last-price read as "no earlier price" — OPEN — 2026-10-01

Filed by `fix/waiting-on-you-oldest-first-flagged` ([ADR 0256](../decisions/0256-waiting-on-you-is-flagged-first-then-oldest-by-the-houses-own-rules.md)), found while reusing the gate's facts for the "Waiting on you" flag. Line numbers are at c14aeca03.

**What.** `assertApprovalAllowed` (`procurement.service.ts:4374`) builds the order's `pricePremiumPct` with `pricePremiumPct` (`:4672-4698`). That helper returns `null` both when the read of the item's last price fails (`if (error) return null;`, and the `catch`) and when there is no earlier price. `decideApproval` reads a `null` premium as "the `price_jump` rule does not apply", so when the read fails, a house with `price_jump` switched on seals the order as if the price had not moved. Nothing records that the check was skipped. This is the absence-reported-as-health fault (ADR 0020).

**Since this branch.** The helper is now `readPricePremium`, which returns `{ pct, unread }`, and the "Waiting on you" flag reports `unread` as unknown. The gate still ignores `unread`, so its behaviour is unchanged. That was deliberate: this branch changes only the queue.

**Fix (deferred, founder's call).** Choose what the gate does when it cannot read the last price: refuse the seal in words ("couldn't check the price; try again"), or park the order for the rule's role, as an untestable rule already does. Then pin it with a gate spec case that makes the price read fail.

## Two readings of "the last price" disagree — OPEN — 2026-10-01

Filed by `fix/waiting-on-you-oldest-first-flagged` (ADR 0256). Line numbers are at c14aeca03.

**What.** The approve gate (and now the "Waiting on you" flag) compares an order's unit price with the most recently requested OTHER order for the same item: any status, any age, and even an order requested after this one (`procurement.service.ts:4680-4687`, `.neq("id", orderId).order("requested_at", { ascending: false }).limit(1)`). `approvalGate` (`GET /procurement/order-approval-gate`, `walkOrdersUnderTest`) compares with the order just before it inside a 365-day window, walking forward. The settings retrospective uses the same window and arithmetic. So for an item with a newer order, or with no order in the last year, the two can answer `price_jump` differently. DASH-W21 (branch `fix/review-dashboard`) has the dashboard card read `approvalGate` to show an order as "held". On such an order, the card's "held" line and the flag can disagree.

**Fix (deferred, founder's call).** Choose one definition of "what the house last paid" and use it in all three places. One option is the last DELIVERED or APPROVED order requested before this one. Then delete the other two.
