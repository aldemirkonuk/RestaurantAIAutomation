# 0061 — The recurring-order reminder reads the recurrence table, behind an off-by-default flag

- **Status:** Proposed
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** recurring orders, scheduled tasks, cron, reminder, dead path, procurement_orders, recurring_orders, feature flag, fail-closed, email, tenant routing
- **Links:** [[0058-order-status-is-an-enum-not-a-string]] (PR #222, the guard that recorded this site), [[0056-order-paths-write-columns-that-exist]] (PR #220, `recurring_orders` shape), [[0022-scheduled-jobs-run-per-tenant]] / OD-87 (recipient routing), [[0020-no-fabricated-answers]], [[0053-analytics-cost-unknown-not-invented]], [[0011-pos-sale-volume-contract]]

## Context

`ScheduledTasksService.sendRecurringOrderReminders()` filtered `procurement_orders`
on `status = 'RECURRING'` (`apps/api-gateway/src/communications/scheduled-tasks.service.ts:398`
on `origin/main`). `RECURRING` is not a member of `ProcurementOrderStatus` under any
casing — the enum is PENDING, APPROVAL_NEEDED, NEGOTIATING, APPROVED, CONFIRMED,
IN_TRANSIT, DELIVERED, PARTIALLY_RECEIVED, COMPLETED, CANCELLED, REJECTED, FAILED
(`apps/api-gateway/src/procurement/dto/procurement.dto.ts:15-29`). The query has
therefore matched zero rows since it was written, and this daily 08:00 cron has
never sent one email.

PR #222 swept 21 mis-cased or invented status comparisons and deliberately left this
one on the shrink-only `KNOWN_BROKEN` list of `scripts/check_order_status_literals.py`,
on the grounds that the enum "has no recurring concept at all" and choosing a
replacement was a product question rather than a typo fix.

**That framing turns out to be answerable from the schema, and the answer is not a
status at all.** The query's three *other* fields were already `recurring_orders`
fields:

| Field the query reads | Where it actually lives |
|---|---|
| `next_order_date` | `recurring_orders.next_order_date` — exists on **no other table** (baseline `:4960`, indexed `:10725`) |
| `recurrence_frequency` | a Postgres **ENUM TYPE** (baseline `:210-213`); the column on that table is plainly `frequency` |
| `target_price_per_bottle` | **exists in no table in the schema** — grep across every non-archived migration returns nothing |

`procurement_orders` carries none of the three. Its 56 columns include
`is_recurring boolean` and `cron_schedule`, but no `next_order_date`, no
`wine_name`, and no per-bottle target price. So the job was never addressing a
status on the orders table; it was addressing `recurring_orders` and had been
pointed at the wrong table. The dead status literal was the symptom, not the
disease — which is why repointing is a determination, not a guess between
candidate status sets.

This path **sends real email to real tenants**, which sets the risk budget:
production has 10 restaurants but 1 real tenant, no `staff` role exists, and 6 of 10
restaurants are owner-only, so the manager lookup resolves to zero users for them
(OD-87 / ADR 0022, verified 2026-08-26).

## Options considered

1. **Repoint to a `procurement_orders` status set** (e.g. `APPROVED`+`CONFIRMED`
   filtered by `is_recurring = true`). Rejected: it keeps the three phantom fields
   broken, so the reminder would still render `"Unknown Provider"` and a `0` price.
   It also changes *what the reminder means* — from "a schedule fires in 2 days" to
   "an existing order is recurring", which is a different product.
2. **Delete the job.** Honest, cheap, and the founder explicitly chose fix over
   delete. Costs the feature the UI already advertises (`/orders?tab=recurring`,
   `RecurringOrders.tsx`).
3. **Repoint to `recurring_orders`, ship dark behind a flag.** Chosen.
4. **Repoint and turn it on.** Rejected outright: the table cannot yet name a wine
   or a price on `main` (see Consequences), so arming it would mail subject lines
   reading `Recurring Order Reminder: Unknown Provider - Recurring Order`.

## Decision

`sendRecurringOrderReminders()` reads `recurring_orders` (`active = true`,
`next_order_date <= today + 2`), scoped to the tenant, and is gated behind
**`RECURRING_ORDER_REMINDERS_ENABLED`, which is off and stays off until the founder
flips it.**

Three properties carry the decision:

- **The gate is an allow-list, checked before anything happens.** Only `"true"` and
  `"1"` (trimmed, case-insensitive) arm it; `"yes"`, `"on"`, `""`, a typo and unset
  all read as off. The check returns *before* the tenant loop, before any query,
  before any recipient resolution. A deny-list would turn every typo into a live
  mailer; an allow-list turns every typo into silence, and silence is the
  recoverable failure here.
- **Rows are described fail-closed.** `describeRecurringOrder()` refuses any row
  whose name, provider, price, quantity, date or frequency is absent, and the job
  emails nothing for a refused row — it logs which fields were missing. There is no
  `|| "Unknown Provider"` and no `|| 0`, because the template puts the provider and
  the wine in the **subject line**: a missing value there does not degrade the
  email, it sends a confidently wrong one ([[0020]], and [[0053]] already paid for
  this once when an unmeasured bottle cost rendered as `0.6 ×` the menu price).
- **Recipients stay tenant-scoped.** The job resolves through `recipientsFor`, which
  passes `allowDefaultFallback: tenant.isLegacyDefault` — so for any non-legacy
  tenant the global `MANAGER_EMAIL` fallback is refused outright rather than
  spilling one restaurant's schedule into another's inbox (ADR 0022 / OD-87).

## Consequences

**What becomes easier.** The reminder is now wired to the table that holds the
concept, so it starts working the moment the data does. Its decision logic is two
pure functions with no DI, so "does this send?" and "does this invent anything?" are
directly testable.

**What is given up.** The job does nothing at all today. That is deliberate and
doubly enforced: the flag is off, and even with the flag on, `main`'s
`recurring_orders` has no `target_price`, `provider_name` or `wine_name` column, so
`describeRecurringOrder` refuses **every** row and zero emails go out. The
flip-precondition is enforced by code rather than by a comment.

**What must be true before the flag is flipped** — all four, and the founder flips
it, not an agent:

1. **PR #220 must be merged and its migration applied.** `20260901180000_recurring_orders_shape.sql`
   adds `inventory_id`, `provider_id` and `target_price`. Until then no row is
   describable and arming the flag changes nothing except log noise.
2. **A wine name and provider name must be reachable.** #220 deliberately does *not*
   add a `wine_name` column (it embeds via `inventory_id`). This job reads the table
   directly with `select("*")`, so after #220 it still needs either that embed added
   here or a `provider_name`/`wine_name` projection. Without it every row stays
   refused — safe, but silent.
3. **`recurring_orders` must actually have rows.** It held **0** on 2026-09-01;
   every insert it ever received named columns that did not exist (see [[0056]]).
4. **The owner-only gap must be settled.** The job asks for `roles: ["manager"]`,
   and `RecipientRole` has no `"owner"` member. 6 of 10 production restaurants are
   owner-only, so with the flag on they receive nothing and log `RECIPIENTS_NONE`.
   Whether an owner should receive manager notifications is a genuine open fork,
   **not resolved here** — resolving it means changing `RecipientRole`, which moves
   every other scheduled job too.

**What would trigger revisiting this.** If `recurring_orders` is abandoned in favour
of recurrence-on-the-order (`procurement_orders.is_recurring` + `cron_schedule`,
both of which exist and are unused), this ADR is superseded and the reminder moves
with it.

## Guard interaction

This change makes PR #222's `KNOWN_BROKEN` entry for
`("communications/scheduled-tasks.service.ts", "RECURRING", "")` **stale**, which
that guard treats as a failure in its own right ("an entry that stops matching
FAILS, because a fixed site left on the list is a hole the guard has stopped looking
at"). The entry must be deleted when the two changes meet. Measured, with #222's
guard copied in and run against this tree — never committed here, since the guard
file itself belongs to #222:

| Run | Tree | `KNOWN_BROKEN` | Exit | RECURRING-specific result |
|---|---|---|---|---|
| 1 | pristine `origin/main` | entry present | 1 | listed as debt — entry matches |
| 2 | this branch | entry present | 1 | `FAIL: KNOWN_BROKEN entry (…, 'RECURRING', '') no longer matches any site.` |
| 3 | this branch | entry removed | 1 | stale-entry failure **gone** |

The residual exit 1 in all three runs is #222's own 21 unfixed sites in
`analytics/**`, `dashboard/**` and `providers/**` — files this branch is forbidden to
touch. The violation set on this branch is **byte-identical** to pristine `main`:
this change introduces no status literal and removes none of #222's. The list shrank
by exactly one, and nothing else moved.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | — | Created |
