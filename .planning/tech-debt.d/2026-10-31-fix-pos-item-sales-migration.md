## The `pos_checks` index is built without `CONCURRENTLY` — OPEN — 2026-10-31

Filed by `fix/pos-item-sales-migration`, the migration slice of ADR 0298, from the CI audit of PR #617 at `90b7dadff` (PR comment 6547565625, security note 4).

**What is true.** Migration `cost_of_goods_reads_what_sold` (cited by slug, ADR 0235) ends with `CREATE INDEX IF NOT EXISTS idx_pos_checks_restaurant_closed ON public.pos_checks (restaurant_id, closed_at DESC) WHERE closed_at IS NOT NULL`. A plain `CREATE INDEX` takes a SHARE lock: writes to `pos_checks` wait while the index builds, reads do not. The audit's note called the lock ACCESS EXCLUSIVE; it is not.

The build's size was not measured here. The same note quotes an earlier draft of ADR 0298 at about 3,600 checks for the largest house. Whether POS ingest retries a write held up behind the lock was not verified. `CONCURRENTLY` cannot run inside a transaction block, and how this repository's migration runner wraps a file was not checked.

**What closes it.** One of three things:
- a measure of the build time against production's `pos_checks` size, with the ingest's lock timeout and retry behaviour; or
- a runner path that applies this one statement outside a transaction, with `CONCURRENTLY`; or
- a recorded ruling that the measured lock is acceptable.
