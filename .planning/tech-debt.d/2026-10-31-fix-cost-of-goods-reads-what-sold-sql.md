## The `pos_checks` index is built without `CONCURRENTLY` — OPEN — 2026-10-31

Entry (i) of this branch. Filed by `fix/cost-of-goods-reads-what-sold-sql`, the first of the three PRs ADR 0298 was split into, from the CI audit of PR #617 at `90b7dadff` (PR comment 6547565625, security note 4). The same audit's two forks, the `admin` reading and the delegation's missing record, are in the decision register, not here: OD-241 (OPEN-DECISIONS.md:328) and OD-242 (OPEN-DECISIONS.md:329).

**What is true.** Migration `cost_of_goods_reads_what_sold` (cited by slug, ADR 0235) ends with `CREATE INDEX IF NOT EXISTS idx_pos_checks_restaurant_closed ON public.pos_checks (restaurant_id, closed_at DESC) WHERE closed_at IS NOT NULL`. A plain `CREATE INDEX` takes a SHARE lock. That lock blocks writes to `pos_checks` while the index builds, and leaves reads open. The audit's note called the lock ACCESS EXCLUSIVE; it is not.

The size of the build was not measured here. ADR 0298 records that an earlier audit measured about 3,600 checks for the largest house (`../decisions/0298-cost-of-goods-is-what-sold-and-concentration-reads-the-till.md:123`). It also records that whether POS ingest retries a write held up behind the lock was not verified. `CONCURRENTLY` cannot run inside a transaction block, and how this repository's migration runner wraps a file was not checked here.

**What closes it.** One of three things:
- a measure of the build time against production's `pos_checks` size, together with the ingest's lock timeout and retry behaviour; or
- a runner path that applies this one statement outside a transaction, with `CONCURRENTLY`; or
- a recorded ruling that the measured lock is acceptable.

## Whether a `tech-debt.d` fragment falls under retire-to-write — CLOSED — 2026-10-31

Entry (ii) of this branch. From the same audit (compliance note 2, second bullet).

ADR 0298's review trail said the question "is not answered here" (`:123`). It is answered elsewhere. `tech-debt.d/README.md:5-7` records the founder's answer of 2026-09-29: a file in this folder is an entry of the defect register, not a new document, so it names nothing to retire and gets no index row. The ADR's row now carries that citation in a dated bracket. Nothing else was owed.

## ADR 0298 describes code that is not on `main` — OPEN — 2026-10-31

Entry (iii) of this branch. From PR #703's audit at `8fa9d0494` (comment 6549556550, compliance note 1).

**What is true.** Most of ADR 0298's decisions describe the gateway readers, /reports, the exports, the MCP reader and the goal producers, which land with PR #617, and the digest's two compositions, which land with a third PR. This branch lands only the function they read. The two `open` rows of `../decisions/claims.d/fix-cost-of-goods-reads-what-sold-sql.jsonl` fail the build once that code lands without the rows being flipped. Nothing fails if the code never lands. `main` would then hold an ADR whose sentences about routes and letters describe nothing.

**What closes it.** One of two things:
- PR #617 and the digest's PR both merge, and both rows are flipped to `resolved`; or
- either PR is closed unmerged, and a dated bracket in ADR 0298 says which of its decisions did not land.
