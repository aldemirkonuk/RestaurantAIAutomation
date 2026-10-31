## ADR 0298's `admin` reading is a fork no register holds — OPEN — 2026-10-31

Entry (i) of this branch. Filed by `fix/cost-of-goods-reads-what-sold-sql`, the first of the three PRs ADR 0298 was split into, from the CI audit of PR #617 at `90b7dadff` (PR comment 6547565625, compliance note 2).

**What is true.** ADR 0298 decision 9 lets `admin` read the owner row of ADR 0145's `ROLE_POLICY` (`apps/api-gateway/src/ask-readings/reading-data-classes.ts:180-183`), as that file's header already says it does (`:25-26`). ADR 0164's `RolesGuard` does not admit `admin` on a route that does not list it (`apps/api-gateway/src/auth/guards/roles.guard.ts:18-24`). So the two locked readings differ for `admin`. ADR 0298 names the difference inside a rejected option and picks the first. That creates no exposure today: the same header records that no one holds `admin` (measured read-only on 2026-09-18). But the fork is the founder's, and no register held it.

**Why here and not in `OPEN-DECISIONS.md`.** The coordinator ruled that the gate's notes are filed as fragment entries under ADR 0240. That is a placement call, not an answer to the fork.

**What closes it.** The founder rules which reading binds `admin` on both surfaces, and an ADR records his ruling. Whichever reading loses is then changed to match.

## The 2026-10-07 delegation has no record of its own — OPEN — 2026-10-31

Entry (ii) of this branch. From the same audit (compliance note 1).

**What is true.** ADR 0298 decision 9 is the coordinator's call, made under the founder's 2026-10-07T20:04:10Z delegation. The delegation exists only as a quotation: in ADR 0298's Status line and decision 9 (`../decisions/0298-cost-of-goods-is-what-sold-and-concentration-reads-the-till.md:3`, `:70`), and in the ADRs that cite it for their own calls (`0265`, `0287`). No decision record states the delegation itself: what it covers, from when, and what it does not waive. The audit put it this way: it waives *asking*, not *recording* (CLAUDE.md §0.2).

**What closes it.** A record of the delegation itself. That record holds the verbatim text, its timestamp, the scope the founder gave it (including the 2026-10-31T16:57:09Z /goal under which this split was made), and what it leaves to him. Each coordinator's or executor's call then cites that record rather than re-quoting chat.

## The `pos_checks` index is built without `CONCURRENTLY` — OPEN — 2026-10-31

Entry (iii) of this branch. From the same audit (security note 4).

**What is true.** Migration `cost_of_goods_reads_what_sold` runs `CREATE INDEX IF NOT EXISTS idx_pos_checks_restaurant_closed ON public.pos_checks (restaurant_id, closed_at DESC) WHERE closed_at IS NOT NULL` (`supabase/migrations/20270301170000_cost_of_goods_reads_what_sold.sql:203-205`). A plain `CREATE INDEX` takes a SHARE lock. That lock blocks writes to `pos_checks` while the index builds, and leaves reads open. The audit's note called the lock ACCESS EXCLUSIVE; it is not.

The size of the build was not measured here. ADR 0298 records that an earlier audit measured about 3,600 checks for the largest house (`:123`). It also records that whether POS ingest retries a write held up behind the lock was not verified. `CONCURRENTLY` cannot run inside a transaction block, and how this repository's migration runner wraps a file was not checked here.

**What closes it.** One of three things:
- a measure of the build time against production's `pos_checks` size, together with the ingest's lock timeout and retry behaviour; or
- a runner path that applies this one statement outside a transaction, with `CONCURRENTLY`; or
- a recorded ruling that the measured lock is acceptable.

## Whether a `tech-debt.d` fragment falls under retire-to-write — CLOSED — 2026-10-31

Entry (iv) of this branch. From the same audit (compliance note 2, second bullet).

ADR 0298's review trail said the question "is not answered here" (`:123`). It is answered elsewhere. `tech-debt.d/README.md:5-7` records the founder's answer of 2026-09-29: a file in this folder is an entry of the defect register, not a new document, so it names nothing to retire and gets no index row. The ADR's row now carries that citation in a dated bracket. Nothing else was owed.
