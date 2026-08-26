# 0028 — A phantom relation is repointed or deleted, never created

- **Status:** Proposed
- **Date:** 2026-08-26
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** phantom table, PGRST205, PGRST202, missing migration, OD-99, dead read, swallowed error, unreachable fallback
- **Links:** [[0020-no-fabricated-answers]], [[0026-schema-has-one-home]], [[0027-push-recipients-are-not-resolved-here]], `scripts/check_queried_tables_exist.py`, OD-99

## Context

`scripts/check_queried_tables_exist.py` landed with a debt list of relations the
code queries and no migration declares. Eleven of them were **class C** — defined
nowhere in this repository at all: six tables (`reports`, `inventory_stock`,
`managers`, `restaurant_wine_menus`, `wine_library`, `provider_digital_twins`)
and five `.rpc()` functions (`find_provider_by_email`, `get_inactive_providers`,
`get_low_stock_items`, `jsonb_array_append`, `search_provider_conversations`).

Each was verified against **production** with curl on 2026-08-26, not against
`supabase/migrations/`: PostgREST answers `404 PGRST205` for all six tables to
the service-role key, and `PGRST202` for all five functions.

What made them survive is not that they were hard to see. It is that **every one
was wrapped in error handling that produced the same value as success.** Three
distinct shapes of the same failure:

1. **The swallowed read.** `dashboard.service.ts:208` selected from `reports`,
   caught the error and returned `{latest: null, lastGeneratedAt: null}` — byte
   identical to "the archive is empty". Its own comment said *"If reports table
   doesn't exist or error, return null"*. Someone knew.
2. **The inverted report.** `reporting_agent.py` selected from `inventory_stock`,
   caught the 404 into `inventory_items = []`, and walked that empty list to a
   summary of 0 items, 0 low stock, $0 value — and `stock_health: "healthy"`,
   because `len([]) < max(0 * 0.1, 1)`. The failure did not hide, it *inverted*
   and returned the single most reassuring answer available.
3. **The unreachable fallback.** In `email_parsing_agent.py`,
   `provider_conversation_agent.py` and `core/database.py`, the author of each
   RPC call wrote a fallback for "the function isn't there" and put it **inside
   the same `try` as the RPC call**. supabase-py raises on a 404 RPC, so the
   exception jumped straight over the fallback to the outer `except`. The
   fallbacks were not fallbacks; they were unreachable code that made the call
   sites *read* as defensive to every reviewer since.

Two tests were also found **pinning** defects rather than catching them:
`test_reporting_agent_bugs.py` asserted `table.assert_called_with("inventory_stock")`
and `test_golden_path_e2e.py` both mocked and asserted the same phantom name.
They would have failed anyone who fixed the bug.

## Options considered

1. **Write a migration for each.** Uniform, and the guard goes quiet. But it
   creates tables to satisfy readers rather than because the data has an owner —
   and OD-95 already established what that produces: `push_subscriptions` would
   have become a permanently-empty second store beside the real one. A table
   that exists and is always empty is a **new lie, not a fix**.
2. **Delete every dead read.** Honest and always behaviour-preserving (each read
   has failed 100% of the time, so removing it changes nothing observable). But
   applied uniformly it deletes working features whose only defect is a stale
   name — `generated_reports` and `restaurant_inventory` both exist, hold the
   exact columns wanted, and are one word away.
3. **Decide per relation, on evidence.** More work, no single rule to cite
   later. This is what was done, and the per-relation verdicts are recorded in
   the guard's own debt-list comment so the next session inherits them.
4. **Do nothing** — leave all eleven on the debt list. Costs: the dashboard card,
   every inventory report, provider attribution for every inbound email, and
   every manager preference the learning loop extracts all stay broken, and the
   ratchet cannot shrink.

## Decision

**A relation that production does not have is either repointed at the real store
or deleted. It is never created to satisfy a reader.** A migration is written
only when the data has an owner that will fill it — which was true of none of
these eleven.

The test for which branch applies is *where does this data actually live today*:

- **A real store exists under a different name → repoint.** Not a decision, a
  repair; the evidence is a column-by-column match plus a production 200.
  - `reports` → `generated_reports` (`restaurant_id`, `created_at` — exact fit)
  - `inventory_stock` → `restaurant_inventory` (`wine_name`, `stock_live`,
    `threshold_min`, `last_sold_at` — same names)
  - `managers` → `manager_report_profiles` (what `generated_reports.profile_id`
    points at; the join key moves with it — rows are profiles, so per-manager
    lookups use `manager_id`, not the profile's own `id`)
- **The real store is elsewhere and of a different shape → delete the read.**
  The `push_subscriptions` shape; ADR 0027's precedent applies directly.
  - `restaurant_wine_menus` — the JSONL files under `datasets/restaurant_menus/`
    are what this service's only two readers read. The insert was additionally
    guarded on a `supabase_client` no caller ever passed, so it was never even
    reached.
  - `provider_digital_twins` — the digital twin **is** `provider_knowledge`; the
    method literally named `_load_digital_twin` reads it.
- **No obvious target, and picking one is a product decision → delete, and file
  the fork.** `wine_library` — `restaurant_inventory` (what the restaurant HAS)
  and `menu_items` (what it SELLS) are both defensible and mean different
  things. Guessing is worse than an admitted gap: OD-102.
- **A phantom RPC whose fallback was real → make the fallback the body.** Four
  of the five. The fifth, `jsonb_array_append`, was a **write** with nothing
  behind it — so its failure was not a degraded read, it was data loss — and
  became an explicit read-modify-write.

And, carried from ADR 0020: **repointing alone is half a fix.** A read that now
targets a real table can still fail, and the caller must be able to tell that
apart from an empty answer. `ReportSummaryDto` gained `unavailable`, and
`searchConversationMemory` now throws instead of returning `[]`.

## Consequences

**Easier.** The guard's class-C debt is empty and the `KNOWN_MISSING_FUNCTIONS`
ratchet is at zero, so the next phantom relation is a build failure rather than
a discovery. Four capabilities that had never once worked now work: the
dashboard's report block, inventory reports, provider attribution by email, and
persistence of learned manager preferences.

**Harder / given up.** Three real behaviour changes ship with this, and each is
a founder call rather than a repair, so each is filed rather than assumed:
OD-100 (inventory is valued at cost — `last_purchase_price` — not at menu
price), OD-101 (wiring the email composer into `provider_knowledge`, which
carries `confidence`/`verified` columns an LLM guess should not fill by
default), OD-102 (which table Phase 1 of wine matching should search), OD-103
(**relationship-health alerts start firing** — an alert nobody has ever received
begins arriving), OD-104 (a real vector search over `conversation_embeddings`).
The `jsonb_array_append` replacement is **not atomic**: two concurrent appends
to one session can lose one. Stated rather than papered over — it is strictly
better than losing 100% of them.

**Not done here, deliberately.** The six **class A** debt entries
(`scheduled_reports`, `push_subscriptions`, `notification_logs`,
`pos_webhook_logs`, `provider_important_dates`, `provider_ratings`) are a
different shape — a migration for each exists, in an archive directory, so it
was never applied — and a different decision. They remain on the ratchet.

**Revisit when:** a phantom relation appears whose data genuinely has an owner
waiting to fill it. Then a migration is right, and this ADR does not forbid it —
it forbids creating a table *because a reader points at it*.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-26 | OD-99 sweep | Created; 11 class-C entries closed, guard green on both arms |
| 2026-08-26 | Verification | Every fix revert-proved: the defect reinstated, the test shown failing, restored, shown passing |
