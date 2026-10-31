## Every new migration must be versioned past 20261231000100 until the calendar catches up — OPEN — 2026-10-31

Filed by `docs/inventory-next-default-on-record` (#705), from its review.

**What happens.** #677 (`3bbec7bfa`) added `supabase/migrations/20261231000000_mudavym_design_inventory_next_flag.sql`, and #704 (`97a0d324`) added `20261231000100_…default_on.sql` after it. The coordinator's read-only query of `supabase_migrations.schema_migrations` (2026-10-31 22:45Z) found 20261231000100 as production's newest. `scripts/check_migration_order.py` accepts a new file only if it is dated strictly after the newest version on main (`version > ceiling`, :190-192), unless `supabase/migration-order-exceptions.txt` lists it (ADR 0212). So until the clock passes 2026-12-31 00:01:00Z, a migration given its real timestamp fails with OUT OF ORDER, and its author has to pick a version past the ceiling by hand.

**Why it matters.** The guard's own failure output already handles this case (`check_migration_order.py:318-321`: use `date -u` "if the clock is past it; otherwise any unused version after" the ceiling). The CI notice under it (`.github/workflows/ci.yml:417`, "Explain an order failure") is shorter: "rename to a version past it, date -u +%Y%m%d%H%M%S". In this window, a reader who follows only the date command gets another failing version. How often that happens has not been measured. The failure is loud: the check blocks the PR, so nothing merges out of order. `ci.yml` is gate-owned, so the notice is not edited here.

**Not decided.** Leave it alone (the window closes on its own at the turn of the year) or reword the CI notice to match the guard output. Renumbering the two applied migrations would need a `schema_migrations` reconciliation and is not proposed.

**Re-check.** After `git fetch origin`, run `git ls-tree --name-only origin/main supabase/migrations/ | grep -E '^supabase/migrations/[0-9]{14}_' | sort | tail -1`. The window is open while that version sorts after `date -u +%Y%m%d%H%M%S`.
