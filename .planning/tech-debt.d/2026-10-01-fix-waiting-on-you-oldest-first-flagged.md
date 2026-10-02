## The approve gate reads a failed last-price read as "no earlier price" — OPEN (ruled, not built) — 2026-10-01

Filed by `fix/waiting-on-you-oldest-first-flagged` ([ADR 0256](../decisions/0256-waiting-on-you-is-flagged-first-then-oldest-by-the-houses-own-rules.md)), found while reusing the gate's facts for the "Waiting on you" flag. Ruled by the founder 2026-10-01 (ADR 0256, answer 8). Not built on this branch: a change to the gate is a separate operation, for a follow-up PR. Line numbers are at c4731a3cb (the merge of origin/main after it touches none of these files). At the base, c14aeca03, the same code was `procurement.service.ts:4374` (`assertApprovalAllowed`) and `:4672-4698` (`pricePremiumPct`, `if (error) return null;`).

**What.** `assertApprovalAllowed` (`apps/api-gateway/src/procurement/procurement.service.ts:4391`) builds the order's facts with `orderUnderTest` (`:4686-4715`), which calls `readPricePremium` (`:4726-4754`). That returns `{ pct: null, unread: true }` when the read of the item's last price fails (`:4744`, and the `catch` at `:4752`). The gate takes only `test` and drops `priceUnread` (`:4446-4450`). `decideApproval` reads a `null` premium as "the `price_jump` rule does not apply" (`apps/api-gateway/src/settings/approval-thresholds.ts:185-189`), and the gate seals on `if (!decision.requiredRole) return;` (`:4453`). So when the read fails, a house with `price_jump` switched on seals the order as if the price had not moved, and nothing records that the check was skipped. This is the absence-reported-as-health fault (ADR 0020). The "Waiting on you" flag already reports `unread` as unknown.

**Ruling (verbatim).** Chosen: "Park for the rule's role (Recommended)": "Hold the order for whoever the price-jump rule names, the same way an untestable rule is handled today." Turned down: "Refuse, in words": "Refuse the approval with a sentence saying the last price couldn't be read; try again later."

**The ruling's premise is wrong.** An untestable rule does not park anything today. `decideApproval` puts it in `untestable` without setting `requiredRole` (`approval-thresholds.ts:154-157` for `manager_ceiling` with no total, `:169-172` for `new_vendor` with a failed count), and the gate seals at `procurement.service.ts:4453`. `apps/api-gateway/src/procurement/order-approval-gate.spec.ts:414-428` pins it: a first-order count that errors, and the order is `APPROVED`. This entry's earlier text said "as an untestable rule already does", which was the same mistake. Parking on an unread price is ruled. What happens to the two rules that already go untested is not, and the follow-up PR must not decide it. Options for the founder:

- (a) Park only on an unread price. `manager_ceiling` with no total and `new_vendor` with a failed count keep sealing. Smallest change, but the gate then handles three unknowns two ways.
- (b) Park on any untestable enabled rule, for that rule's role. One rule for every unknown, which is what the chosen option described. `new_vendor` and `manager_ceiling` change behaviour, and the spec at `order-approval-gate.spec.ts:414-428` flips. Cost: while the vendor-count read is down, every order waits for `new_vendor`'s role. A person who holds that role still seals, because parking only stops someone below it.
- Recommendation: (b). The founder chose park believing it was how unknowns are already handled. (b) makes that true, and it is ADR 0020's rule.

**Follow-up PR.** In the gate, an unread price with `price_jump` enabled requires that rule's role, with a reason in words ("the last price couldn't be read") and `price_jump` listed as untestable in the refusal record. Plus whatever the founder picks above. Pin it with a gate spec case where the last-price read errors, for an actor below and an actor at the rule's role. The flag needs no change: a parked order reads `APPROVAL_NEEDED`, which the flag already marks "needs a signature", and the price stays unknown.

## Two readings of "the last price" disagree — OPEN (ruled, not built) — 2026-10-01

Filed by `fix/waiting-on-you-oldest-first-flagged` (ADR 0256). Ruled by the founder 2026-10-01 (ADR 0256, answer 9). Not built on this branch, for the same follow-up PR. Line numbers are at c4731a3cb. At c14aeca03 the gate's query was `procurement.service.ts:4680-4687`.

**What.** There are three implementations and they disagree:

1. The approve gate, and so the "Waiting on you" flag: `readPricePremium` (`apps/api-gateway/src/procurement/procurement.service.ts:4736-4743`, `.neq("id", orderId).order("requested_at", { ascending: false }).limit(1)`). It takes the most recently requested OTHER order for the item: any status, any age, and even an order requested after this one.
2. `approvalGate` (`GET /procurement/order-approval-gate`, `:4504`) through `walkOrdersUnderTest` (`:4764-4828`). It walks forward inside a 365-day window (`APPROVAL_GATE_WINDOW_DAYS`, `:258`; `.gte("requested_at", since)`, `:4779`) and takes the order just before, any status (`lastPriceByItem`, `:4786-4812`).
3. The settings retrospective, `readOrdersUnderTest` (`apps/api-gateway/src/settings/approval-thresholds.service.ts:297-362`). It uses the same 365-day window (`RETROSPECTIVE_WINDOW_DAYS`, `:56`; `.gte`, `:311`), does not read status at all (`:309`), and does the same walk (`:334-351`).

So for an item with a newer order, or with no order in the last year, (1) and (2) can answer `price_jump` differently. DASH-W21 (branch `fix/review-dashboard`) has the dashboard card read (2) to show an order as "held", so the card's "held" line and the flag can disagree on the same order.

**Ruling (verbatim).** Chosen: "Last approved/delivered before (Recommended)": "Use the last approved or delivered order placed before this one." Turned down: "Just before, within 365 days": "The 'held' line's current meaning." and "Most recent of any age": "The approval check's current meaning; it can include a later order."

**Follow-up PR.** Write one definition and use it in all three places, then delete the other two. "Placed before" is read as an earlier `requested_at`, the field all three already order by. The ruling names no window, so the lookup has none. The two windowed walks keep counting orders inside 365 days, but take each order's last price from before the window too. The flag follows the gate through `orderUnderTest` with no change of its own.

**Open detail for the founder.** Which states count as "approved or delivered". The order states are listed in `supabase/migrations/20260905230000_an_order_changes_state_by_the_table.sql:103-116`.

- (a) Only `APPROVED` and `DELIVERED`, read literally. A `COMPLETED` or `PARTIALLY_RECEIVED` order would not count, though its goods arrived.
- (b) `APPROVED`, `CONFIRMED`, `IN_TRANSIT`, `DELIVERED`, `PARTIALLY_RECEIVED` and `COMPLETED`: the order went ahead.
- Recommendation: (b). A completed order is the best evidence of what the house paid, and (a) skips it.
