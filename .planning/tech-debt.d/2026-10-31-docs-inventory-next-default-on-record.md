## Every new migration must be dated after 2026-12-31 until the calendar catches up — OPEN — 2026-10-31

Filed by `docs/inventory-next-default-on-record` (#705), from its review.

**What happens.** #677 (`3bbec7bfa`) added `supabase/migrations/20261231000000_mudavym_design_inventory_next_flag.sql`, and #704 (`97a0d324`) added `20261231000100_…default_on.sql` after it. Both are applied on production (`supabase_migrations.schema_migrations`, newest 20261231000100, read 2026-10-31 22:45Z). `scripts/check_migration_order.py` accepts only a new file dated strictly after the newest version on main. So until 2026-12-31, any migration given its real timestamp fails with OUT OF ORDER, and its author must pick a version past the ceiling by hand.

**Why it matters.** The CI notice for that failure (`.github/workflows/ci.yml`, "Explain an order failure") tells authors to rename to `date -u +%Y%m%d%H%M%S`. During this window that advice produces another failing version. The failure is loud, not silent: no out-of-order file can merge. But it costs every migration author a round trip, and the CI notice sends them the wrong way. `ci.yml` is gate-owned, so the notice is not edited here.

**Not decided.** Whether to do nothing (the ceiling expires on 2026-12-31) or change the CI notice to say "past the newest version on main" is not decided. Renumbering the two applied migrations would need a `schema_migrations` reconciliation and is not proposed.

**Re-check.** `git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -2`: the ceiling holds while the newest version sorts after today's `date -u +%Y%m%d%H%M%S`.
