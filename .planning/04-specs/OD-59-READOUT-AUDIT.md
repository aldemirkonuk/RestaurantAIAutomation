# OD-59 readout audit — can the view layer hold two `outcome_basis` readings?

**Date:** 2026-08-25 · **Branch:** `feat/od-59-doneability` · **Scope:** audit only, nothing edited.

Every claim below was checked against the SQL and the Python, not against comments or
planning prose. Where a comment or a register entry disagrees with the code, the code
wins and the disagreement is recorded in §6.

Objects audited:

- `supabase/migrations/20260824153600_nf_a_readout.sql` — the two readout views
- `supabase/migrations/20260824141116_neural_footprint_event.sql` — the base table
- `scripts/nf_readout.py` — the CLI that prints the metric
- writers: `apps/api-gateway/src/common/model-client/model-client.service.ts`,
  `services/agent-orchestrator/services/neural_footprint.py`

---

## 1. How does the view define "completed"?

**It does not.** There is no completion predicate anywhere in the view.

The entire `WHERE` clause of `nf_a_cost_per_completed_task` is one line:

```sql
where subject_type = 'agent'
```

— `supabase/migrations/20260824153600_nf_a_readout.sql:108`

The full body, verbatim (`20260824153600_nf_a_readout.sql:98-110`):

```sql
create or replace view public.nf_a_cost_per_completed_task
  with (security_invoker = true)
as
  select subject_id                                as agent,
         context->>'task_type'                     as task_type,
         count(*)                                  as tasks,
         sum(cost_usd)                             as cost,
         avg(cost_usd)                             as avg_cost,
         count(*) filter (where outcome is null)   as outcome_unknown
  from public.neural_footprint_event
  where subject_type = 'agent'
  group by subject_id, context->>'task_type'
  order by cost desc;
```

So, precisely:

- It does **not** filter on `outcome = 'success'`.
- It does **not** filter on `outcome is not null`.
- `tasks` is `count(*)` (`:104`) over every agent row — `success`, `failure`, `partial`
  and `NULL` alike. A failed call is a "completed task" to this view.
- `cost` is `sum(cost_usd)` over the same unfiltered set, so it includes the cost of
  work that failed.
- The only reference to `outcome` in the whole view is the **reported column**
  `count(*) filter (where outcome is null) as outcome_unknown` (`:106`). That is an
  output, not a filter.

**The view is faithful to its source and the source is where the defect starts.**
`.planning/04-specs/P1-NF-A-INSTRUMENTATION.md:41-49` contains the §2 query, and it has
no outcome filter either. The migration comment at `:84-85` claiming the semantics are
"reproduced from §2 without addition" is **true** — verified line by line. The name
`cost_per_completed_task` was aspirational in §2 and the migration carried it over.

`.planning/04-specs/P1-BUILD-LOG.md:229-231` states this honestly: *"Cost per attempted
task is readable today."* That is the correct description of what this view computes.

### 1a. A second, deeper naming problem: the denominator is calls, not tasks

`.planning/00-index/METRICS.md:601-602` registers **two different keys**:

| key | stated meaning |
|---|---|
| `nf_a.cost_per_task` | "Cost of one agent task" |
| `nf_a.cost_per_completed_task` | "Cost of a task that actually completed" |

METRICS.md:194 already flags the pair as a near-duplicate defect. The shipped view is
named after the second and does not implement either, because one row is **one model
call**, not one task:

- The gateway emits exactly one row per *logical* call, with transport retries collapsed
  into `context.attempts` (`model-client.service.ts:349`, retry loop `:170-259`). Good.
- But a task that makes three model calls writes three rows. The only thing that groups
  the rows of one unit of work is `correlation_id`, scoped explicitly "per UNIT OF WORK
  (one document, one message)" (`apps/api-gateway/src/common/model-client/correlation.ts:52-54`).
- The view never groups by `correlation_id`.

So `tasks` = model calls, and `avg_cost` = mean cost per model call. This matters for
§5: a `reconciliation_v1` verdict is inherently *task*-grained, so mixing it into
`count(*)` mixes two different units in one denominator.

---

## 2. THE CRITICAL QUESTION — does the view silently average the two bases together?

**Yes. Plainly and unconditionally: it does.**

Neither view, nor the CLI, nor any index, mentions `outcome_basis` anywhere:

```
$ grep -rn "outcome_basis" supabase/ scripts/
(no matches)
```

The only occurrences in executable code are the two writers:

- `apps/api-gateway/src/common/model-client/model-client.service.ts:347` —
  `outcome_basis: "call_level_v0"`
- `services/agent-orchestrator/services/neural_footprint.py:32,94` —
  `OUTCOME_BASIS = "call_level_v0"`, applied via `ctx.setdefault(...)`

The grouping key of view 1 is `(subject_id, context->>'task_type')`
(`20260824153600_nf_a_readout.sql:109`). `outcome_basis` is not in it. Therefore, the
moment a `reconciliation_v1` row lands for an agent and task type that already has
`call_level_v0` rows — which is the whole point of OD-59's proposed opener,
`invoice_extraction` — the two land in **the same group** and are summed and averaged
into one figure.

The resulting number mixes *"the API answered"* with *"the work was actually right"*,
in a single cell, with nothing in the output indicating that it did so. There is no
column, no caveat, and no CLI flag that would let a reader detect the mixture. It is
worse than a wrong number, because it is a wrong number wearing the provenance envelope
(`nf_a_readout_provenance`) that exists specifically to stop numbers being quoted out of
context — and that envelope does not partition by basis either
(`20260824153600_nf_a_readout.sql:133-143`).

Three concrete ways the contamination shows up, depending on how OD-59 writes the verdict:

1. **Verdict as a new row** (the likely shape — the table has no natural key, only
   `id uuid primary key default gen_random_uuid()`, `20260824141116_neural_footprint_event.sql:18`).
   Then `tasks` **double-counts**: one underlying invoice extraction produces N
   `call_level_v0` call rows *plus* one `reconciliation_v1` verdict row. `avg_cost` is
   dragged toward zero if the verdict row carries `cost_usd IS NULL` — see the existing
   `avg()`-skips-NULL caveat at `:119-123`, which this would make materially worse.
2. **Verdict as an UPDATE of the call row** (rewriting `context.outcome_basis` in place).
   No double count, but it **destroys the call-level reading** — and that reading has a
   named downstream owner: `backtests-charter.md:30` requires taking
   `outcome_basis: call_level_v0` rows and re-grading them, and
   `backtests-questions.md:19` wants the regrade **delta** published. An in-place rewrite
   makes the delta uncomputable.
3. **Mixed grain regardless.** Even with perfect bookkeeping, `count(*)` would be adding
   call-grained rows to task-grained rows (§1a).

### 2a. There are already TWO basis populations in the table today, not one

The task brief says "today every row is written on `call_level_v0`". **That is not
quite true**, and it changes the shape of the fix.

The Python emitter stamps the basis **only when a grade was actually written**:

```python
if outcome is not None:
    ctx.setdefault("outcome_basis", OUTCOME_BASIS)
```
— `services/agent-orchestrator/services/neural_footprint.py:93-94`

So a Python row with `outcome IS NULL` carries **no `outcome_basis` key at all**. This is
deliberate and it is pinned by a test:
`services/agent-orchestrator/tests/test_spend_logger.py:183` asserts
`"outcome_basis" not in nf["context"]`.

The gateway, by contrast, stamps the basis **unconditionally** (`:347`) and never writes
`outcome` NULL — its grader always returns one of the three values
(`model-client.service.ts:319-325`).

Net: `context->>'outcome_basis'` has **three** states in production today —
`'call_level_v0'`, SQL `NULL` (key absent, ungraded Python rows), and after OD-59,
`'reconciliation_v1'`. Any partition written as `where context->>'outcome_basis' =
'call_level_v0'` will **silently drop the ungraded Python rows entirely**, which is a
new way to lose events. Use `COALESCE`, not equality, and see §5.

---

## 3. Does anything partition by `context->>'task_type'`?

**Yes — the view already does.** This is the one part of the OD-59 story that is already
built.

- `20260824153600_nf_a_readout.sql:102` selects `context->>'task_type' as task_type`.
- `:109` groups by `subject_id, context->>'task_type'`.
- The CLI prints it as a column (`scripts/nf_readout.py:315,320-321`) and emits it per
  row in `--json` (`:260`).

So a **per-task-type figure is available today**, not only a global one. `nf_readout.py`
prints one line per `(agent, task_type)` pair and footers with
`"{n} agent/task_type pairs"` (`:336`). The global figure is the separate provenance
view.

This directly supports the OD-59 framing — *"`context.task_type` partitions the column, so
one task type is immediately useful."* — quoted from the entry as it read when this audit
ran; OD-59 (`OPEN-DECISIONS.md:101`) has since been closed and rewritten, and the row no
longer carries that sentence. That claim is **verified true**: introducing a verdict for
`invoice_extraction` alone would surface as its own row.
Note the corollary, though: it surfaces as its own row **only if no `call_level_v0` rows
share that agent + task_type**, which they will. Per-task-type partitioning does not
save you from §2.

Two caveats found while checking:

- Rows with **no** `task_type` are not dropped — they form a group with
  `task_type IS NULL`, printed as `(null)` (`nf_readout.py:321`). The Python emitter
  makes this reachable: `if task_type: nf_context["task_type"] = task_type`
  (`services/agent-orchestrator/services/spend_logger.py:381-382`) — the key is omitted
  when falsy. The gateway always sets it (`:346`), where `taskType: string` is required
  (`:74`).
- **Minor inconsistency:** provenance reports `count(distinct (context->>'task_type')) as
  task_types` (`20260824153600_nf_a_readout.sql:137`). `count(distinct)` ignores NULLs, so
  when untyped rows exist the header says "N task types" while the table below prints
  N+1 rows, one of them `(null)`. Cosmetic, but it is exactly the class of "the envelope
  disagrees with the body" defect the envelope was built to prevent.

---

## 4. The minimum-sample gate (OD-58, ~30 events)

### Where it is

It is **not in SQL**. Neither view has any volume logic; both return whatever the table
holds. The gate lives entirely in the CLI:

- Default: `scripts/nf_readout.py:187-194` — `--min-sample`, `type=int`, `default=30`,
  help text: *"below this many agent events the readout is labelled INSUFFICIENT VOLUME
  (default: 30; a presentation default, not a locked decision)"*.
- Evaluated: `scripts/nf_readout.py:232-233` —
  ```python
  events = prov["events"]
  insufficient = events < args.min_sample
  ```
  `events` is `count(*)` over all agent rows from the provenance view
  (`20260824153600_nf_a_readout.sql:133`). It is a **global** count, not per row.
- Escalated only on request: `--require-volume` (`:195-199`).

### What it actually does below the threshold

**It prints the number, with a loud caveat, and exits 0.** It does not print nothing, and
it does not print a null.

Concretely, for `0 < events < min_sample` (`scripts/nf_readout.py:305-337`):

1. Prints a 78-char `*` bar, then
   `INSUFFICIENT VOLUME -- {events} events is below the threshold of {min_sample}.`,
   then *"The numbers below are real, but they are a smoke test, not a production
   cost-per-task figure."*
2. Then prints **the complete table anyway** — every agent/task_type row with its
   `cost_usd`, `avg_cost` and `outcome_unknown` (`:315-334`).
3. Returns `EXIT_INSUFFICIENT` **only** when `--require-volume` was passed
   (`:339`); otherwise **exit 0**.

Two special cases:

- `events == 0` (`:299-303`): prints `NO DATA ...` and returns **without a table**. This
  is the only path that withholds a number.
- `--json` (`:235-271`): returns **before** the entire text block above. The JSON payload
  carries `"sufficient_volume": false` and per-row `"below_min_sample"`, but **never the
  `INSUFFICIENT VOLUME` banner and never the `NO DATA` message** — an automated consumer
  gets flags it must remember to read, where a human gets a wall of asterisks.
- Per-row: a `(agent, task_type)` pair below the threshold is marked with a `low-n` note
  in the table (`:326`) / `below_min_sample` in JSON (`:265`), but this **never** affects
  the exit code. Only the global count does.

### Rot found in the register (see §6)

OD-58 (`.planning/decisions/OPEN-DECISIONS.md:45`) said *"`scripts/nf_readout.py`
**refuses** below 30 agent events"*, and `.planning/04-specs/P1-NF-A-INSTRUMENTATION.md`
said it *"**refuses** to report below 30 events."* **Both were wrong.** It reports, under a
banner, and exits 0. Only `--require-volume` refuses, and only via exit code — the
numbers still print. `P1-BUILD-LOG.md:171-175` describes the same behaviour correctly.
*Both were corrected 2026-08-25 off this finding: that register row and
`P1-NF-A-INSTRUMENTATION.md:137-141` now carry the correction rather than the claim.*

---

## 5. Smallest change that isolates a `reconciliation_v1` slice

### 5a. First — the constraint that decides the answer

`nf_readout.py` reads the two views **differently**, and this is load-bearing:

| view | how the CLI reads it | can it survive a schema change? |
|---|---|---|
| `nf_a_readout_provenance` | **by name** — `prov_cols = [d[0] for d in cur.description]; prov = dict(zip(prov_cols, cur.fetchone()))` (`nf_readout.py:216-217`) | **Yes** — appending columns is safe |
| `nf_a_cost_per_completed_task` | **positionally** — `for agent, task_type, tasks, cost, avg_cost, outcome_unknown in rows` (`nf_readout.py:267` and `:317`) | **No** — a 7th column raises `ValueError: too many values to unpack` at both sites |

Compounding this: Postgres `CREATE OR REPLACE VIEW` can only **append** columns to the
end; it cannot insert, rename, reorder or retype. Putting `outcome_basis` where it
belongs (next to `task_type`) therefore requires `DROP VIEW` + `CREATE VIEW` — a
breaking change to a shipped object — *and* it breaks both unpack sites in the CLI.

**Conclusion: the smallest safe change does not touch view 1 at all.**

### 5b. The sketch (not applied)

**Step 1 — one new, additive view.** Nothing existing changes; no consumer breaks.

```sql
-- NOT APPLIED — audit sketch only.
create or replace view public.nf_a_cost_per_task_by_basis
  with (security_invoker = true)
as
  select subject_id                                        as agent,
         context->>'task_type'                             as task_type,
         -- COALESCE, not '=': ungraded Python rows carry NO outcome_basis key
         -- at all (neural_footprint.py:93-94), so an equality filter would
         -- silently drop them. Three states, all named.
         coalesce(context->>'outcome_basis', '(unstamped)') as outcome_basis,
         count(*)                                          as tasks,
         count(*) filter (where outcome = 'success')       as succeeded,
         count(*) filter (where outcome is null)           as outcome_unknown,
         sum(cost_usd)                                     as cost,
         avg(cost_usd)                                     as avg_cost,
         min(occurred_at)                                  as first_event_at,
         max(occurred_at)                                  as last_event_at
  from public.neural_footprint_event
  where subject_type = 'agent'
  group by 1, 2, 3
  order by cost desc;

revoke all on public.nf_a_cost_per_task_by_basis from anon, authenticated;
```

`security_invoker = true` is **mandatory**, for the reason spelled out at
`20260824153600_nf_a_readout.sql:91-95`: views are SECURITY DEFINER by default and would
bypass the RLS that migration enabled. The `revoke` matches `:157-158`.

An uncontaminated slice is then just:

```sql
select * from public.nf_a_cost_per_task_by_basis
 where outcome_basis = 'reconciliation_v1';
```

and the legacy reading is `where outcome_basis = 'call_level_v0'`. Neither can pull rows
from the other, because the basis is a grouping key rather than a post-hoc filter over a
pre-aggregated number.

**Step 2 — append basis counts to the provenance envelope.** Safe under
`CREATE OR REPLACE` (append-only) *and* safe for the CLI (name-addressed), so this needs
no Python change to avoid breaking; the CLI simply will not print the new fields until
someone adds them.

```sql
-- appended AFTER last_event_at, preserving column order 1..9
         count(*) filter (where context->>'outcome_basis' = 'call_level_v0')
           as events_call_level_v0,
         count(*) filter (where context->>'outcome_basis' = 'reconciliation_v1')
           as events_reconciliation_v1,
         count(*) filter (where context->>'outcome_basis' is null)
           as events_unstamped
```

This makes a mixed table **detectable** from the envelope alone, which is what
`nf_a_readout_provenance` exists to do (`:145-151`).

**Step 3 — leave `nf_a_cost_per_completed_task` untouched, and fix only its comment.**
It keeps working, keeps its six columns, keeps both CLI unpacks intact. Its `COMMENT ON`
(`:112-124`) should gain one sentence: that it aggregates across all `outcome_basis`
values and is therefore a *cost-per-attempted-call* figure, with
`nf_a_cost_per_task_by_basis` named as the partitioned reading. That is a comment change
only — no `DROP VIEW`, no behaviour change, no CLI change.

Total: one new view, one appended-column replace, one comment. Zero breaking changes.

### 5c. What this does NOT solve — and why it is a founder fork, not a default

Partitioning by basis stops the **contamination**. It does **not**, on its own, produce
`cost_per_completed_task`, and it would be dishonest to imply otherwise.

If the verdict is written as its **own row**, then after partitioning:

- the `reconciliation_v1` partition holds the **verdict** but little or no `cost_usd`
  (the reconciliation check's own cost, at most);
- the `call_level_v0` partition holds the **cost** but only the placeholder grade.

Cost and verdict now live on **different rows**, and joining them requires
`correlation_id` — which exists and is already scoped per unit of work
(`correlation.ts:52-54`), but is **not** in either view, and is NULL on any row emitted
outside a correlation scope (a failure mode already observed against the live table and
documented at `correlation.ts:46-49`).

So OD-59 has an unasked sub-fork that the view layer cannot decide for it:

| shape | cost/verdict join needed? | double-counts `tasks`? | breaks the backtests regrade delta? |
|---|---|---|---|
| **A.** verdict is a new row | Yes, on `correlation_id` | Yes, unless partitioned by basis | No — `call_level_v0` rows survive intact |
| **B.** verdict UPDATEs the call row's `outcome` + basis | No | No | **Yes** — `backtests-charter.md:30` and `backtests-questions.md:19` both require the original `call_level_v0` grade to still exist |

Shape B is the smaller change and the wrong one if the backtests charter is honoured.
Shape A is correct but implies a third view joining the partitions on `correlation_id`,
and implies deciding what happens when `correlation_id IS NULL`. **This is a decision,
not a default (CLAUDE.md §0.1) — it is not resolved here.**

### 5d. LATE ADDENDUM — a third shape landed in this worktree mid-audit

The worktree was clean when this audit started (`git status --short` → empty). Partway
through, **uncommitted work from a concurrent session appeared** in the same tree:

- `supabase/migrations/20260825180000_nf_verdict.sql` (untracked, 64 lines)
- `apps/api-gateway/src/common/model-client/nf-verdict.service.ts` (untracked, 92 lines)
- modifications to `model-client.service.ts` and `model-client.module.ts`

I did not write these and did not modify them. They are read here only because they
change the answer to §5.

**It is shape (c) — a sidecar table, not either of the two shapes in §5c.**
`nf_verdict` holds one row per `(event_id, basis)` with a FK to
`neural_footprint_event(id) ON DELETE CASCADE` and `unique (event_id, basis)`
(`20260825180000_nf_verdict.sql:24-55`). Its header explicitly rejects overwrite-in-place
and added-columns for the reasons §5c names, including preserving the backtests regrade
delta.

**This is a better answer than §5b and it supersedes it as the recommended shape.** The
verdict never enters `neural_footprint_event`, so it **cannot** contaminate
`nf_a_cost_per_completed_task` at all — no double-counted `tasks`, no basis mixing, no
`GROUP BY` change, no CLI breakage. §2's contamination is structurally impossible under
this design. The §5b partitioned view is now only needed if verdicts are *also* written
back as NF rows, which this design does not do.

**But the readout question is still open — the work is table-and-writer only.** Verified
by grep over that migration: **no `enable row level security`, no `create policy`, no
`revoke`, and no view.** Consequences:

1. **The metric still cannot be read.** Nothing joins `nf_verdict` to
   `neural_footprint_event`, so `cost_per_completed_task` remains unreadable, and
   `nf_readout.py` is unchanged and unaware. The join is the missing piece:
   `neural_footprint_event e join nf_verdict v on v.event_id = e.id
   where v.basis = 'reconciliation_v1' and v.outcome = 'success'` — grouped by
   `subject_id, context->>'task_type'`, plus a `left join` variant to expose ungraded
   coverage. That view does not exist yet.
2. **`nf_verdict` reintroduces the exact RLS hole that `20260824153600` was written to
   close.** That migration's header (`:46-51`) documents the base table shipping with
   `relrowsecurity = false` and default Supabase grants as *"a live leak of cost data
   across tenants"*. `nf_verdict` ships with the same posture one day later, and it is
   FK-joined to the tenant-keyed table. It needs the same three lines that migration
   applied at `:67-79` — `enable row level security`, a `service_role` policy, and
   `revoke all ... from anon, authenticated`. **Flagged, not fixed — this audit does not
   edit source.**

### 5e. Indexing note

There is no index on `context` (`20260824141116_neural_footprint_event.sql:47-65` — five
indexes, all on scalar columns). A basis partition is a filter on a jsonb path and will
seq-scan. Irrelevant today (0 rows in production) but worth an expression index
(`create index ... on neural_footprint_event ((context->>'outcome_basis')) where
subject_type = 'agent'`) once the `@Cron */5` invoice sweep is producing volume.

---

## 6. Already broken / already inconsistent (found in passing)

| # | Finding | Evidence | Severity |
|---|---|---|---|
| 1 | The view named `cost_per_completed_task` has **no completion predicate**. It measures cost per *attempted model call*. | `20260824153600_nf_a_readout.sql:104,108` | **High** — the name is the claim |
| 2 | Nothing in the view layer or CLI is aware of `outcome_basis`. Two readings will silently merge. | grep of `supabase/`, `scripts/` returns nothing | **High** — this is §2 |
| 3 | OD-58 (`OPEN-DECISIONS.md:45`) and `P1-NF-A-INSTRUMENTATION.md` both claimed the readout **"refuses"** below 30 events. It does not — it prints the full table and exits 0. Only `--require-volume` changes the exit code, and the numbers still print. **Both corrected 2026-08-25 off this finding.** | `nf_readout.py:305-339` vs. the two docs | **Medium** — register rot; matches the standing `decision-register-rots` warning |
| 4 | `outcome_basis` is stamped **conditionally** in Python (`if outcome is not None`) but **unconditionally** in TypeScript. Three basis states exist today, not one. Any `= 'call_level_v0'` filter silently drops ungraded Python rows. | `neural_footprint.py:93-94` + `test_spend_logger.py:183` vs. `model-client.service.ts:347` | **Medium** — will bite whoever writes the OD-59 partition |
| 5 | The metric key is `nf_a.cost_per_completed_task` but no `nf_a` **schema** exists; the object is `public.nf_a_cost_per_completed_task`. The migration's own header (`:7`, `:82`) and the CLI docstring (`nf_readout.py:2`) use the dotted form, which reads as a schema-qualified name that would fail if pasted into psql. | `grep 'create schema' supabase/` — no match | **Low** — cosmetic, but it is a paste-and-fail trap |
| 6 | `provenance.task_types` uses `count(distinct ...)`, which ignores NULL, while view 1 emits a `(null)` task_type group. Header count and row count disagree whenever an untyped row exists — reachable via `spend_logger.py:381-382`. | `20260824153600_nf_a_readout.sql:137` vs. `:102,109` | **Low** |
| 7 | `--json` returns at `nf_readout.py:271`, **before** the `NO DATA` and `INSUFFICIENT VOLUME` text. Machine consumers get boolean flags they must remember to check; humans get asterisks. Defensible, but asymmetric for a script whose stated purpose is that a number cannot be quoted out of context. | `nf_readout.py:235-271` vs `:299-313` | **Low** |
| 8 | **In-flight `nf_verdict` (§5d) ships with no RLS, no policy and no `revoke`** — the exact posture `20260824153600_nf_verdict.sql:46-51` documents as *"a live leak of cost data across tenants"* on the table it FK-joins to. Uncommitted work by a concurrent session, so still fixable before it lands. | `grep -niE "row level security\|revoke\|create policy" supabase/migrations/20260825180000_nf_verdict.sql` → no matches | **High** (in-flight) |
| 9 | View 1 is consumed **positionally** by the CLI at two sites. Any column added to it — including the obvious `outcome_basis` — crashes the CLI with a tuple-unpack error rather than degrading. This is the reason §5 recommends a new view over amending this one. | `nf_readout.py:267`, `:317` | **Low** (latent) |

### Not a defect — checked and confirmed correct

- The view **is** a faithful reproduction of `P1-NF-A-INSTRUMENTATION.md:41-49`. The
  comment at `:84-85` claiming so is accurate. Finding 1 originates in the spec, not the
  migration.
- The `avg()`-ignores-NULL caveat at `:119-123` is real and is correctly surfaced by the
  CLI at `nf_readout.py:286-296` and in JSON as `avg_cost_over_costed_events_only`
  (`:245`).
- `security_invoker = true` is present on **both** views (`:99`, `:131`), and `revoke all`
  covers the table and both views (`:79`, `:157-158`). The RLS work in that migration is
  sound.
- Retries do **not** inflate row counts — one row per logical call, retries in
  `context.attempts` (`model-client.service.ts:170-259`, `:349`).

---

## 7. One-line answers

1. **"Completed" is undefined.** The predicate is `where subject_type = 'agent'`
   (`:108`) and `tasks` is a bare `count(*)` (`:104`). No outcome filter of any kind.
2. **Yes — the current view silently averages the two bases into one number.**
   `outcome_basis` appears nowhere in the view layer or the CLI, and is not in the
   `GROUP BY`. The figure would mix "the API answered" with "the work was right", with
   nothing in the output revealing it.
3. **Yes, it partitions by `task_type`** (`:102`, `:109`) — per-task-type figures are
   available today, one row per `(agent, task_type)`. The global figure is the separate
   provenance view.
4. **The gate is in Python, not SQL** (`nf_readout.py:187-194`, `:232-233`). Below 30 it
   prints the number **with** a banner and exits **0**; only `events == 0` withholds a
   number; only `--require-volume` changes the exit code. Two planning docs wrongly say
   it "refuses".
5. **Do not amend view 1** — the CLI unpacks it positionally and `CREATE OR REPLACE VIEW`
   cannot insert a column mid-list. If verdicts land as NF rows, add one additive view
   keyed on `coalesce(context->>'outcome_basis','(unstamped)')` (§5b). **If the in-flight
   `nf_verdict` sidecar table (§5d) is the chosen shape, no partition is needed at all —
   contamination becomes structurally impossible — and the smallest remaining change is a
   new view joining `nf_verdict` to `neural_footprint_event` on `event_id`.** Either way
   view 1 stays untouched but for its comment.
