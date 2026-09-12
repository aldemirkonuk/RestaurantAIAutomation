# Handoff — schema drift CI guard

> Companion to [ADR 0026 — Schema has one home](../decisions/0026-schema-has-one-home.md).
>
> This file exists because two files caused every merge collision on 2026-08-26:
> `.planning/decisions/OPEN-DECISIONS.md` and `.planning/decisions/CLAIMS.jsonl`.
> This branch **does not touch either**. The rows it proposes are here, for the
> founder to apply centrally.
>
> **Retire-to-write (CLAUDE.md §4).** Adding this document and ADR 0026 proposes
> retiring **`supabase/SCHEMA_DRIFT.md`**. That file already declares itself
> history ("RESOLVED 2026-08-05 … this file is now history" / "Ideally that is
> empty and this file is deleted"), and its one durable section — *The rule going
> forward* — is superseded by ADR 0026, which now carries the rule **and** an
> enforcement mechanism. Not deleted by this branch: the founder decides, and its
> ghost-table/ghost-column measurements are cited by ADR 0026 and by
> `.github/workflows/schema-parity.yml`.

---

## 1. What shipped

| Path | What it is |
|---|---|
| `scripts/check_queried_tables_exist.py` | Every relation the code queries must be declared by `supabase/migrations/`. `--against-production` adds the arm that needs the database. `--list-dynamic` prints the blind spot. |
| `scripts/check_migrations_single_home.py` | Schema lives in exactly one place. Inventory check + sole-definition check + a non-blocking column census. `--update` regenerates the inventory. |
| `scripts/sql_outside_migrations.txt` | The inventory baseline: 136 `.sql` files outside `supabase/migrations/`. |
| `.github/workflows/ci.yml` → `schema-code-parity` | The hermetic arm. No secret, stdlib only, runs on fork PRs. In `ci-complete`'s `needs`. |
| `.github/workflows/schema-parity.yml` → `queried-tables-exist-in-production` | The production arm, next to the secret it needs. |
| `.github/workflows/schema-parity.yml` → `parity` step | `GITHUB_TOKEN` passed to `supabase/setup-cli`, for the rate-limit flake. |

Exit codes, both guards: `0` pass · `1` violation · `2` **could not check what it
claims to** (a root moved, a client-importing root yielded no call sites, fewer
than 150 relations parsed). Never silently green.

## 2. Proposed `OPEN-DECISIONS.md` rows

Take the next free OD ids at apply time; do **not** reuse. Suggested wording:

| ID | Question | Why it matters now | What unblocks it |
|---|---|---|---|
| OD-⟨next⟩ | **Should the column census block?** `check_migrations_single_home.py` check 3 reports 36 (table, file) pairs across 26 code-queried tables where a file outside `supabase/migrations/` declares a column the live directory does not. `restaurant_feature_flags` ranks **first at +22** — it is the only mechanism in CI that can see that instance, which cost every feature toggle at the database and made `enable_ai_negotiation` un-turn-off-able. The other 25 are mostly legitimate pre-baseline history. | Relation-level checks are structurally blind to the instance that did the most damage. But a shrink-only list that cannot shrink is a list people learn to skip, which is how the debt lists rot. | Founder call: block on a curated subset, block on all 36 with the history entries pre-recorded as debt, or leave it reporting. |
| OD-⟨next+1⟩ | **The 6 class-C tables and 5 class-C RPC functions are called by code that has never once succeeded.** `inventory_stock`, `managers`, `provider_digital_twins`, `reports`, `restaurant_wine_menus`, `wine_library`; `find_provider_by_email`, `get_inactive_providers`, `get_low_stock_items`, `jsonb_array_append`, `search_provider_conversations`. Defined in **no migration anywhere in this repository**, and absent from production (measured 2026-08-26). | Two look like renames that were never finished (`wine_library` → `master_wine_library`, `inventory_stock` → `restaurant_inventory`). `dashboard.service.ts:208` renders a dashboard card from `reports`, so that card has never had data. Each is either a table to create or a call site to delete — but which, per entry, is not a guard's call. | Per-entry triage. The guard already cites every call site by `file:line`. |
| OD-⟨next+2⟩ | **Retire `supabase/SCHEMA_DRIFT.md`?** See the note at the top of this file. | The corpus only ratchets upward (CLAUDE.md §4). This is a concrete retirement candidate that names its successor. | Founder call. |

## 3. Proposed `CLAIMS.jsonl` lines

Executable, verified green on `feat/schema-drift-ci-guard` at 2026-08-26. Set
`id` to the OD ids chosen above. `status: "resolved"` means the claim **must**
hold — if it stops holding, the guard regressed.

```jsonl
{"id": "OD-<census>", "status": "resolved", "claim": "the schema guards exist and are wired into ci.yml's required checks", "verify": "test -x scripts/check_queried_tables_exist.py && test -x scripts/check_migrations_single_home.py && grep -q 'schema-code-parity' .github/workflows/ci.yml", "verified": "2026-08-26"}
{"id": "OD-<census>", "status": "resolved", "claim": "the schema guards are green on this tree (a red guard must not be merged past)", "verify": "./scripts/check_queried_tables_exist.py >/dev/null && ./scripts/check_migrations_single_home.py >/dev/null", "verified": "2026-08-26"}
{"id": "OD-<census>", "status": "resolved", "claim": "the guard reports a failure rather than passing vacuously when its scanned roots are absent", "verify": "d=$(mktemp -d) && mkdir -p \"$d/scripts\" && cp scripts/check_queried_tables_exist.py \"$d/scripts/\" && ! python3 \"$d/scripts/check_queried_tables_exist.py\" >/dev/null 2>&1", "verified": "2026-08-26"}
{"id": "OD-<class-c>", "status": "open", "claim": "the class-C phantom tables are still queried by code and defined by no migration", "verify": "grep -q '\"wine_library\"' scripts/check_queried_tables_exist.py", "verified": "2026-08-26"}
```

The third line is the one worth keeping: it is a claim that the guard **can
fail**, and it is checked by the same job that checks everything else. A guard
whose failure path is never exercised is the defect this branch exists to kill.

## 4. Prove-it-fails evidence

Every mutation below was applied to this tree, run, and reverted. Working tree
verified clean afterwards.

| # | Mutation | Guard | Exit | What it printed |
|---|---|---|---|---|
| 1 | New file `apps/api-gateway/src/__guard_probe__.ts` with `.from("guard_probe_absent_table")` | `check_queried_tables_exist` | **1** | `FAIL: the code queries 1 relations that no migration in supabase/migrations defines: guard_probe_absent_table … __guard_probe__.ts:1` |
| 1b | file removed | same | **0** | `PASS — … or is on the shrink-only debt list (14 entries)` |
| 2 | `scheduled_reports` deleted from `KNOWN_MISSING` — the **real** instance, not a synthetic one | `check_queried_tables_exist` | **1** | names `reports.service.ts:165,185,208` |
| 2b | restored | same | **0** | PASS |
| 3 | Guard copied to an empty tree (`/tmp/fakerepo/scripts/`) | `check_queried_tables_exist` | **2** | `BLOCKED: this guard could not check what it claims to check` × 6 roots — **not** a green "nothing to check" |
| 4 | New `supabase/migrations_archive/29990101000000_guard_probe.sql` | `check_migrations_single_home` | **1** | `FAIL: 1 .sql file(s) appeared outside supabase/migrations` |
| 5 | Full class replay: that archive file defines `guard_probe_sneaky`, **and** a call site queries it | both | **1** / **1** | check 2: `FAIL: 1 relation(s) … defined ONLY outside supabase/migrations: guard_probe_sneaky` · sibling: `FAIL: the code queries 1 relations …` |
| 5b | both files removed | both | **0** / **0** | PASS |
| 6 | The real fix copied in: `git show a04c421c:supabase/migrations/20260826170000_integration_oauth_tables.sql` | both | **1** / **1** | `FAIL: 'integration_oauth_connections' is on the debt list but supabase/migrations now declares it. -> Delete the entry.` (and `_states`) |
| 6b | file removed | both | **0** | PASS |

Proof 6 is the ratchet's second direction, and it is the one that matters most:
a debt entry that becomes satisfied **fails the build demanding its own
deletion**. A fixed relation left on the list would be a hole the guard ignores
forever.

## 5. The blind spot, measured

**24 of 1377 call sites (1.7%)** cannot be resolved statically. All 24 are in
`services/agent-orchestrator/core/database.py` — `.from(self.table_name)` in a
generic repository (9 sites, 9 subclasses), plus `ContactRepository`'s
`self.table` / `self.addresses_table` (15 sites). `./scripts/check_queried_tables_exist.py --list-dynamic`
prints every one. `DYNAMIC_CEILING = 24` fails the build if the set grows.

Resolving them was measured, then declined. Behind the 24 sites are **11
distinct table names**; **9 are already in the queried set** from literal call
sites elsewhere, and the 2 that are not — `rfq_requests`, `unit_conversions` —
are **both declared** by `supabase/migrations/`. The blind spot changes no
verdict today. Closing it would mean reading the second positional argument of a
`super().__init__()` call and assuming that hierarchy's convention, which can
report a wrong table name confidently. Full reasoning in ADR 0026.

## 6. Cross-branch coupling — read before merging

Two debt entries are owned by concurrent work, and **this branch's CI goes red
when either lands**, by design:

- `push_subscriptions` — a concurrent session owns
  `recipient-resolver.service.ts` and a `push_subscriptions` migration. This
  branch deliberately touched neither.
- `integration_oauth_connections` / `_states` — fixed on
  `fix/integration-oauth-tables` by `20260826170000_integration_oauth_tables.sql`,
  **not yet on `main`** (verified: `git merge-base --is-ancestor` says no).

When either merges, `check_queried_tables_exist.py` and
`check_migrations_single_home.py` both fail with *"is on the debt list but
supabase/migrations now declares it — delete the entry"*. The fix is a
three-line deletion, in whichever pull request merges second. Reproduced
deliberately as proof 6 above.

## 7. What was inherited, and what was rejected

A previous attempt died mid-run without committing. Its two scripts were
recovered from its transcript and treated as an unreviewed draft.

**Kept**, after re-deriving every number independently on this tree: the
three-corner C/L/R framing; the `NEVER VACUOUS` exit-2 posture; the shrink-only
ratchet enforced in both directions; the line-start-only comment stripper (a `//`
matched anywhere eats `https://`, and a JSX comment in `App.tsx` was being
extracted as a table named `Login.tsx:36`); the whitespace-**collapsed** rather
than **stripped** receiver lookback (stripping turns `return Buffer` into
`returnBuffer`, killing the `\b` and letting every `Buffer.from()` through); the
two-signal vacuity test (a root that imports a Supabase client but yields zero
call sites is a rotted pattern, a root with neither is legitimately empty).

**Rejected or corrected:**

1. **A self-contradiction about `restaurant_feature_flags`.** The draft's first
   script claimed the instance "is caught by the other half of this guard"; the
   other half's own docstring said it is not. Verified: the live directory *does*
   declare that table, so check 2 is silent. The sibling was right, the claim was
   wrong, and the claim is now corrected in both files. This mattered — it was
   the difference between "catches all five" and the honest "catches three".
2. **The draft's rejection of column-level checking**, which it justified with
   "31 code-queried tables with archive-only columns, most of them artefacts of
   parsing a table-level `UNIQUE(...)` as a column". Re-measured: that probe had
   two bugs — it stopped at the **first** archive file defining a name, so
   `011_add_restaurant_feature_flags.sql` was never compared at all, and it
   tokenised `UNIQUE(a, b)` into a column named `unique(a,`. With both fixed the
   signal is clean and `restaurant_feature_flags` ranks **first at +22**. The
   census now ships (reporting), and the block/report fork is OD-⟨next⟩ above.
3. **`DYNAMIC_CEILING = 24` asserted without justification.** The number is
   right; the reason was missing. Replaced with the measurement in §5.
4. **A `KNOWN_MISSING` census carrying `prod:yes` / `prod:no` labels** that were
   presented as query results. Re-measured against production, read-only,
   2026-08-26 — they were correct, and are now correct *and* re-derived.
5. **Verbose known-debt output** — the draft printed every call site of every
   debt entry on every green run, ~100 lines. Compacted to one line each; NEW
   findings still get the full per-call-site treatment. A log nobody reads is
   how a guard stops being a guard.
6. **`build_const_maps(files, root, lang)`** took a `root` argument it never
   used. Dropped.

## 8. Adversarial audit of the extraction

Two ways the extractor could miss call sites *without* them showing up in the
24-site dynamic count — a silent hole, which is the failure mode this whole
branch exists to prevent. Both were checked directly; both are clean.

**Multi-line calls.** `TS_FROM_RE` forbids a newline *inside* the argument, so
`.rpc(\n  "apply_stock_movement",` looked like it would be missed. It is not:
the `\s*` after `\(` consumes the newline. Verified by name against the
extracted set — `generate_recurring_events`, `tenant_isolation_report`,
`apply_stock_movement`, `get_inventory_balance_at`,
`search_provider_conversations`, `match_restaurant_providers`,
`match_vendor_catalogue`, all 7 present. **24 multi-line sites, 0 missed.**

**The `Array.from` / `.storage.from` receiver filter.** It skips 152 sites, and
a wrong skip would be invisible. Checked every one: **0 of the 152 takes a
table-shaped string literal** — they are all `Array.from(iterable)` /
`Array.from({length})`. Storage buckets are additionally rejected by
`TABLE_LITERAL_RE` because they are hyphenated (`vendor-attachments`,
`menu-scans`). One residual: a bucket named in pure snake_case *and* reached
without a `.storage` receiver within 80 characters would be read as a table.
None exists today (`documents` is not in the queried set).

## 9. Not verified — stated plainly

- **CI has run and both new jobs pass** (PR #95): `Code queries only schema that
  exists` ✅ and `Code queries only relations production has` ✅. The second one
  passing settles two things that were unverified when this file was first
  written: `pip install psycopg2-binary` + `check_db_reachable.sh` works on a
  runner, and the CI secret does have `information_schema` visibility.
- **The `GITHUB_TOKEN` fix for the Supabase CLI rate limit is still unproven.**
  It removes the known cause — an unauthenticated runner gets 60 API requests an
  hour shared across the host, the token raises it to 1000 — but reproducing the
  rate limit to prove it was not attempted.
- **The local production measurement used the founder's `.env` pooler DSN.**
  Read-only session (`set_session(readonly=True)`), no writes, DSN never printed.
  The CI run above used the repository secret instead and agreed.
- **The 251 "superseded" reconciliations in check 2 were not individually
  audited.** They are counted, not inspected; the guard asserts only that the
  live directory also declares those names, not that the two definitions agree.
  Column-level disagreement among them is exactly what §2's OD-⟨next⟩ is about.
- **`strip_ts_comments` blanks any line beginning with `*`.** That is for JSDoc
  continuation lines. A line-initial `*` in a wrapped arithmetic expression would
  also be blanked, losing a call site. No such line exists today; the failure
  direction is a miss, not a false accusation.
