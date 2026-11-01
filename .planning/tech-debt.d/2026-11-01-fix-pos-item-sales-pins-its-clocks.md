## pos_item_sales leaves it to its first caller to drop another house's items — OPEN — 2026-11-01

Filed by `fix/pos-item-sales-pins-its-clocks` from PR #712's CI gate. The notes come from the PASS at `5b98ae6d0` (comment 6555218562): correctness notes 2 to 4, and compliance's note on decision 8. They also come from the BLOCK at `a2f9dc2d8` (comment 6554862275), security note 1.

**What is true.** `public.pos_item_sales` (migration `cost_of_goods_reads_what_sold`) returns:
- items whose `in_house` is false, when a line names another house's item. The rule to name none of them is in the function's COMMENT only.
- one `unreadable_lines` count for the whole read, with no flag per item. A line with an unreadable price that names a stock item drops out of that item's figures. An unmapped line with an unreadable price drops out of `unmapped_sales`.
- one snapshot over `pos_checks` and `inventory_transactions`. If a void ever writes `voided` and its `return` rows in two transactions, a read between them shows sales of 0 against bottles out.

Nothing calls the function yet. Production was read on 2026-11-01T07:57Z, over 365 days, for all 5 houses with checks. It returned 0 foreign items and 0 unreadable lines.

**What closes it.** The first caller lands with:
- a jest test showing it drops `in_house: false` items before it uses any id;
- a figure that withholds when `unreadable_lines` is above 0 (ADR 0298 decisions 2 and 5 already say so);
- a `file:line` showing whether the ingest's void writes both halves in one transaction, or else an entry here.

ADR 0298 decision 8 also says another per-item reader of the till calls this function. These gateway readers select `pos_checks.items` on `main`:
- `analytics/insights/insight-generator.service.ts:891`
- `analytics/goals.service.ts:1061`
- `notifications/producers/sale-record.producer.ts:233`
- `logs/logs-timeline.service.ts:221`
- `pos-hub/pos-mapping-review.service.ts:497`

Each gets a check: does it sum per stock item? If it does, it moves to the function or gets an entry here. Re-run with `grep -rn 'from("pos_checks")' apps/api-gateway/src`, then read each `.select(`.

## The function's NOT NULL and grant pins run nowhere in CI — OPEN — 2026-11-01

From the same PASS, correctness note 1.

**What is true.** CI runs no `supabase/tests` file. The migration's own self-check covers only SECURITY INVOKER, the grants and RLS on the four relations. So nothing in CI catches it if `pos_checks.voided` or `inventory_transactions.inventory_id` becomes nullable. A nullable `voided` would drop those checks from sales while their ledger rows stay in `bottles_out`. `CREATE INDEX IF NOT EXISTS` matches on name only. Production was read on 2026-11-01T07:57Z and has the definition the migration wrote.

**What closes it.** Either a CI job that runs `supabase/tests`, or a later migration whose self-check asserts both NOT NULLs.
