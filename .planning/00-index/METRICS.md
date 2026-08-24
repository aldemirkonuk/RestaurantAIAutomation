---
type: moc
title: Metrics
updated: 2026-08-24
links: ["[[HOME]]", "[[PLAN]]", "[[LOOP-MAP]]", "[[ORG-MAP]]", "[[GLOSSARY]]", "[[DECISION-INDEX]]"]
---

# Metrics — every metric the org names, and whether it has a number

> Mined from the `metrics:` frontmatter of every document in `01-org/` and `02-advisory/`.
> **This page does not define any metric** — the owning unit's `charter.md` does. It answers one
> question the charters do not: *can this be computed today?*
>
> **Reading note (`CLAUDE.md` §2):** the census in *The full census* is ~325 rows and is a
> **grep target, not a read target**. Read this page's prose sections; `Grep` the table for a
> metric key or a namespace.

## The headline

**325 distinct metric keys. Zero are produced by a running instrument.**

Not one metric in this org is emitted on a cadence by anything. There is no metrics pipeline, no
dashboard, and no scheduled job that computes any of these. The one scheduled job the corpus
runs — `scripts/watch_loops.py`, weekly via `.github/workflows/loop-watcher.yml` — watches dates,
not metrics.

Breaking the 325 down honestly:

| | Count | What it actually means |
|---|---|---|
| ✅ **Computable today** | **198** | Someone could produce a number *if they ran a query by hand*. Nobody has, for 164 of them |
| 🟡 **Blocked** | **55** | The instrument is specified and the blocker is named — POS, NF-B callers, OD-49, a gold set |
| 🔴 **No instrument** | **72** | Nothing anywhere could produce this number today |
| — **Has a number written down** | **34** | And **15 of those are literally zero** |

And the number that matters most: **of the 198 "computable today", 178 are static analysis of
this repository and this corpus.** They measure our own paperwork — file counts, unguarded
routes, broken links, duplicate basenames, docs added vs retired. Only 20 need a live database
query, and **not one describes the product in operation.**

> The org can measure itself as an artifact. It cannot measure itself as an operation.

### NF-A: the metric spine emits nothing

| | |
|---|---|
| `nf_a.*` keys defined | **15** |
| With no instrument | **12** |
| Blocked | **1** |
| Computable | **2** — and both measure the *absence*: `nf_a.emission_coverage` = **0**, `nf_a.agent_attributed_spend_pct` = **0%** |

The mechanism is concrete, not vague. `api_spend` carries `provider, model, input_tokens,
output_tokens, cost_usd, restaurant_id, timestamp` and nothing else
(`supabase/migrations/20260805000000_baseline_from_production.sql:2231-2240`);
`SpendLogger.log()` accepts no agent and no task type
(`services/agent-orchestrator/services/spend_logger.py:41-49`); no `neural_footprint` table
exists in any migration; and no key joins `api_spend` to `decision_log`. So **cost exists without
an agent, reasoning exists without a cost, and nothing joins them.**

That single gap is what makes `nf_a.cost_per_task`, `nf_a.task_success_rate`,
`nf_a.doneability_verdict_coverage` and `nf_a.harness_overhead_ms` uncomputable — and those four
are claimed by **8, 8, 4 and 2 units** respectively — `nf_a.cost_per_task` alone spans five
divisions (Applied AI, Commercial, Corporate, Platform, Product). It is also why OD-03
and OD-04 (harness and model roster) are *undecidable on evidence* rather than merely undecided.

See [[PLAN]] §1 (P1) for the fix and [ADR 0008](../decisions/0008-nf-column-contract.md) for the
locked column contract.

### NF-B: an instrument with no callers

**27 of 29 `nf_b.*` metrics are blocked on the same thing**: the guest slice is 3 tables and 564
lines of working migration (`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql`)
with **zero application call sites** — verified by grep across `apps/`, `services/` and
`packages/`. The tables cannot fill, so the metrics cannot read. This is [[PLAN]] §P4.

The two exceptions are both statements about design rather than data:
`nf_b.checks_dependent_candidate_share` (**429/573 = 74.9%** of insight types need POS `checks`)
and `nf_b.research_store_erasability` (readable from the schema).

### Eight namespaces are entirely dark

Every metric in these has no instrument or is blocked — not one can produce a number:
`answer_surface` · `inbound` · `legal` · `messaging` · `pos` · `release` · `resilience` ·
`schema`.

`schema.*` is the sharpest of the eight: all three metrics are blocked on **one unset repo
secret** (`SUPABASE_POOLER_CONNECTION_STRING`, OD-49). The schema-parity job has never compared
anything, and a green run today would be *vacuously green* ([[GLOSSARY]]) — for a check that
exists because production once carried 27 tables and 403 columns no migration created.

## Method — how each verdict was assigned

- **Source.** The `metrics:` array in the YAML frontmatter of every `.md` under `01-org/` and
  `02-advisory/`, **censused 2026-08-24 at 793 documents / 325 keys / 60 namespaces**. The
  census is a script's output, not a hand count. ⚠️ **That script is not committed** — it was a
  one-off, so this page cannot be regenerated without rewriting it. Promoting it to
  `scripts/build_metric_index.py` (alongside `build_loop_index.py`) is what would make this page
  self-maintaining; until then it is a hand-maintained snapshot and will drift.
  **693 of 793 documents carry the key**; the missing 100 are the 99
  `questions.md` files (artifact #8, retrofitted under OD-41 without a `metrics:` array) and
  `FORK-REGISTRY.md`. Counts were produced by reading the files, not by trusting prose.
- **Owning unit.** The unit whose `charter.md` frontmatter names the metric. Where several
  charters claim it, the count is shown as *(+n)* and the metric appears under *Cross-division*
  if the claimants span divisions.
- ✅ **yes** = a real number could be produced today by a grep, a static scan, or a SQL query
  against a table that exists. It does **not** mean the number has been produced, or that it will
  refresh.
- 🟡 **blocked** = the instrument is specified and one named thing is missing. The blocker is
  stated in every row.
- 🔴 **no instrument** = nothing could produce it today, at any cost, without building something.

Two judgement calls worth stating plainly:

1. A metric whose **denominator is empty** is still ✅ if the query runs. `skills.firing_rate_30d`
   is computable and reads *0 of 0*. That is a real reading, and it is the reading that tells you
   the anti-sprawl rule is vacuous.
2. A metric that reads **zero because the thing it measures does not exist** is ✅, not 🔴.
   `nf_a.emission_coverage` = 0 is the most useful number in this document.

## The 34 numbers that exist today

Every one was produced by hand — a grep, a count, or a read — during the 2026-08-24 chapter.
**None of them refreshes.** If the underlying fact changes tomorrow, this table is wrong and
nothing will say so.

| Metric key | Value today | Verdict |
|---|---|---|
| `analytics.candidate_type_count` | **573** measured — but 348 / 375 / 573 / `>=200` all circulate (OD-33) | ✅ yes |
| `analytics.satisfiable_candidate_share` | **25.1%** of 573 insight types satisfiable without POS | ✅ yes |
| `annotation.gold_set_size` | **0** | ✅ yes |
| `corpus.ambiguous_duplicate_count` | **33** unresolved `[[links]]` after OD-32 repaired 519 | ✅ yes |
| `corpus.duplicate_basename_count` | **45** files named `README.md` | ✅ yes |
| `corpus.top_level_planning_docs` | **28** (~1.2 MB) — OD-01 | ✅ yes |
| `decisions.namespace_collisions` | **7** fork namespaces (OD-30 / OD-42) | ✅ yes |
| `decisions.open_count` | **37 open · 24 resolved** rows in the register | ✅ yes |
| `fin.spend_attribution_coverage_pct` | **0%** — same table, second namespace | ✅ yes |
| `graph.frontmatter_coverage_pct` | **793 / 793** org docs carry `type:` | ✅ yes |
| `graph.link_resolution_rate` | **33** unresolved, all prose examples inside contract docs | ✅ yes |
| `kd.docs_added_vs_retired_ratio` | **28 added / 0 retired** | ✅ yes |
| `loops.undefined_close_time_count` | **0** — normalised 102 values → 9 (OD-47) | ✅ yes |
| `nf_a.agent_attributed_spend_pct` | **0%** — `api_spend` has no `agent` column | ✅ yes |
| `nf_a.emission_coverage` | **0** — nothing writes a neural-footprint event | ✅ yes |
| `nf_b.checks_dependent_candidate_share` | **429 / 573 (74.9%)** need POS `checks` | ✅ yes |
| `obs.decision_log_join_rate` | **0%** — no key joins `api_spend` to `decision_log` | ✅ yes |
| `pi.live_counterparties` | **0** — no native POS adapter is `available` | ✅ yes |
| `platform.public_decorator_count` | **11** — same census, second namespace | ✅ yes |
| `platform.unguarded_reachable_routes` | **94** unguarded by omission (137 − 32 webhook − 11 `@Public()`) | ✅ yes |
| `privacy.consent_call_sites` | **0** application callers of the guest tables | ✅ yes |
| `roster.headcount_claim_variance` | **19 / 23 / 24 / 26** — four defensible answers (OD-31) | ✅ yes |
| `roster.silent_default_spec_count` | **4** (`core/agent_registry.py:337`) | ✅ yes |
| `roster.unregistered_module_count` | **3** `BaseAgent` subclasses with zero call sites | ✅ yes |
| `routing.routed_client_share` | **0%** — no router exists | ✅ yes |
| `sec.injection_corpus_size` | **0** | ✅ yes |
| `sec.model_callsites_emitting_cost` | **0 of 7** raw-HTTP gateway call sites emit spend | ✅ yes |
| `sec.public_decorator_count` | **11** | ✅ yes |
| `sec.tenants_with_inference_budget` | **0** — no budget mechanism ships | ✅ yes |
| `sec.unguarded_authenticated_surface` | **94** — same census, second namespace | ✅ yes |
| `skills.firing_rate_30d` | **0 of 0** — the rule is live and vacuous | ✅ yes |
| `skills.registry_size` | **0** committed `SKILL.md` files | ✅ yes |
| `standards.docs_past_60_day_rule` | **198** agendas, all firing together on 2026-10-23 | ✅ yes |
| `triggers.dated_unwatched_count` | **0** — 2 dated triggers, both now watched | ✅ yes |
## Namespace hygiene — findings from the census

The metric namespace has no registry, and it drifted exactly the way `close_time` drifted before
OD-47. **60 namespaces for 325 keys**, and:

| Finding | Evidence |
|---|---|
| **One key has no namespace at all** | `share_of_model_calls_through_wrapper`, owned by [[harness-model-routing-charter]]. Every other key is `namespace.name` |
| **`surface.` and `surfaces.` both exist** | Product owns `surface.*`, Platform owns `surfaces.*`, and **both define `untraceable_route_components`** — the same quantity, two keys, two owners |
| **The same census is published under two keys** | `sec.public_decorator_count` and `platform.public_decorator_count` (both 11); `sec.unguarded_authenticated_surface` and `platform.unguarded_reachable_routes` (both 94); `nf_a.agent_attributed_spend_pct` and `fin.spend_attribution_coverage_pct` (both 0%) |
| **`false_merge_count` means two different things** | `identity.false_merge_count` = products merged wrongly; `nf_b.false_merge_count` = guests merged wrongly. Same leaf name, unrelated subjects |
| **NF-A defines near-duplicates** | `doneability_verdict` / `doneability_verdict_coverage` / `verdict_coverage`; `task_success_rate` / `verified_task_success_rate`; `cost_per_task` / `cost_per_completed_task`. All six read zero, so the redundancy has never been felt |
| **`checklist_items_green` is defined twice** | `conversion.*` and `seo.*`, by two teams in the same division |

This is the same class of defect `analytics.metric_claim_divergence_count` was created to catch —
and it is present in the metric *keys* themselves, one layer above where that metric looks. A
metric registry for the org (the counterpart to `apps/api-gateway/src/analytics/metric-registry.ts`,
which does this job for the product's 33 public metric keys) would close it.

## Live queries

Which units declare metrics at all, and how many:

```dataview
TABLE division, length(metrics) AS "Metrics declared", status, updated
FROM "01-org" OR "02-advisory"
WHERE type = "charter" AND metrics
SORT length(metrics) DESC
```

Charters that declare **no** metric — a charter with no metric cannot be held to anything:

```dataview
TABLE division, status
FROM "01-org" OR "02-advisory"
WHERE type = "charter" AND (!metrics OR length(metrics) = 0)
SORT division ASC
```

Loops and their metrics, so a metric can be traced to the cycle that acts on it:

```dataview
TABLE loop_count, loop_statuses, metrics
FROM "01-org" OR "02-advisory"
WHERE type = "loops" AND loop_count > 0
SORT loop_count DESC
```

> These queries answer *who declared what*. **No query can answer "what is the value"** until
> something emits — which is the entire content of the headline above.

## The full census

Verdicts follow the definitions in *Method*. The owning unit links to its charter, which is
canonical for what the metric means; this table is canonical for nothing.

### Research & Math — 6 metrics (2 yes · 1 blocked · 3 no instrument)

| Metric key | Owning unit | What it measures | Computable today? |
|---|---|---|---|
| `nf.private_telemetry_tables` | [[neural-footprint-instrumentation-charter\|neural-footprint-instrumentation]] | Telemetry tables not exposed to tenants | ✅ **yes** — read the migration set |
| `nf_a.event_completeness` | [[neural-footprint-instrumentation-charter\|neural-footprint-instrumentation]] *(+1)* | Share of NF-A events carrying every required field | 🔴 **no instrument** — no NF-A store exists |
| `nf_a.harness_overhead_ms` | [[harness-model-routing-charter\|harness-model-routing]] *(+1)* | Latency the harness adds per task | 🔴 **no instrument** — OD-03/OD-04 are undecidable on evidence because of this |
| `nf_a.verdict_coverage` | [[evaluation-doneability-charter\|evaluation-doneability]] | Share of tasks with a doneability verdict | 🔴 **no instrument** — no doneability verdict exists anywhere |
| `nf_b.identifier_coverage` | [[neural-footprint-instrumentation-charter\|neural-footprint-instrumentation]] | Guests with a resolvable identifier | 🟡 **blocked** — blocked on NF-B callers |
| `share_of_model_calls_through_wrapper` | [[harness-model-routing-charter\|harness-model-routing]] | Share of model calls through the shared wrapper | ✅ **yes** — grep; **note: this key has no namespace — a convention defect** |

### Platform — 62 metrics (34 yes · 16 blocked · 12 no instrument)

| Metric key | Owning unit | What it measures | Computable today? |
|---|---|---|---|
| `annotation.correction_to_rule_conversion_rate` | [[annotation-ground-truth-charter\|annotation-ground-truth]] | Corrections turned into a rule | 🔴 **no instrument** — no annotation pipeline exists |
| `annotation.gold_set_freshness_days` | [[annotation-ground-truth-charter\|annotation-ground-truth]] *(+1)* | Age of the gold set | ✅ **yes** — 0 — there is no gold set |
| `annotation.gold_set_size` | [[annotation-ground-truth-charter\|annotation-ground-truth]] | Size of the gold set | ✅ **yes** — **0** |
| `annotation.inter_annotator_agreement` | [[annotation-ground-truth-charter\|annotation-ground-truth]] | Agreement between annotators | 🔴 **no instrument** — no annotators, no annotation store |
| `annotation.rubber_stamp_rate` | [[annotation-ground-truth-charter\|annotation-ground-truth]] | Reviews approved without change | 🔴 **no instrument** — no review log |
| `ci.gates_red_consecutive_runs` | [[release-engineering-charter\|release-engineering]] | Consecutive red CI runs on a gate | ✅ **yes** — GitHub Actions history |
| `corpora.demand_weighted_coverage` | [[corpora-enrichment-charter\|corpora-enrichment]] *(+1)* | Corpus coverage weighted by demand | 🟡 **blocked** — blocked on POS data — demand weighting needs sales |
| `corpora.field_confidence_median` | [[corpora-enrichment-charter\|corpora-enrichment]] | Median enrichment field confidence | ✅ **yes** — SQL over the wine corpus |
| `corpora.library_coverage` | [[corpora-enrichment-charter\|corpora-enrichment]] | Share of the target library enriched | ✅ **yes** — SQL over the wine corpus |
| `corpora.source_canary_pass_rate` | [[corpora-enrichment-charter\|corpora-enrichment]] | Enrichment sources still answering | ✅ **yes** — the canary scripts exist in `scripts/` |
| `identity.false_split_count` | [[catalogue-identity-charter\|catalogue-identity]] | Same product held as two identities | ✅ **yes** — SQL + the duplicate queue (S17 ships) |
| `identity.producer_collapse_ratio` | [[catalogue-identity-charter\|catalogue-identity]] | Producers wrongly merged into one | ✅ **yes** — SQL over the producer table |
| `integration.placeholder_hosts_unresolved` | [[integration-engineering-charter\|integration-engineering]] | Connector hosts still placeholders | ✅ **yes** — grep the provider registry |
| `integration.verified_signature_coverage` | [[engineering-charter\|engineering]] *(+1)* | Ingress routes verifying signatures | ✅ **yes** — route census |
| `integration.webhook_silence_duration` | [[integration-engineering-charter\|integration-engineering]] | How long a connector has been silent | 🔴 **no instrument** — no delivery ledger — S09 records the missed-webhook alert as unbuilt |
| `integrity.invariants_with_outcome_side_check_pct` | [[state-integrity-invariants-charter\|state-integrity-invariants]] | Invariants also checked on the outcome side | ✅ **yes** — static audit of the guard scripts |
| `integrity.open_findings_count` | [[state-integrity-invariants-charter\|state-integrity-invariants]] | Open state-integrity findings | ✅ **yes** — count over `questions.md` |
| `integrity.open_findings_oldest_age` | [[state-integrity-invariants-charter\|state-integrity-invariants]] | Age of the oldest such finding | ✅ **yes** — same |
| `inventory.direct_write_paths` | [[inventory-ledger-charter\|inventory-ledger]] | Writes bypassing the ledger | ✅ **yes** — `scripts/check_no_direct_stock_writes.sh` runs today |
| `inventory.ledger_v1_callers` | [[inventory-ledger-charter\|inventory-ledger]] | Callers still on the pre-lot ledger | ✅ **yes** — grep |
| `inventory.projection_divergence_rows` | [[engineering-charter\|engineering]] *(+1)* | Rows where projection and ledger disagree | 🟡 **blocked** — blocked on DB access (OD-49) for automation; SQL works one-off |
| `messaging.drop_rate` | [[messaging-delivery-charter\|messaging-delivery]] | Messages accepted and never delivered | 🔴 **no instrument** — no delivery ledger |
| `messaging.duplicate_delivery_rate` | [[engineering-charter\|engineering]] *(+1)* | Messages delivered more than once | 🔴 **no instrument** — same |
| `messaging.restart_reconciliation_gap` | [[messaging-delivery-charter\|messaging-delivery]] | Messages lost across a restart | 🔴 **no instrument** — same |
| `nf_b.exposure_events` | [[pos-operational-telemetry-ingest-charter\|pos-operational-telemetry-ingest]] | Guest exposure events captured | 🟡 **blocked** — blocked on NF-B callers |
| `nf_b.guest_signal_attribution_accuracy` | [[catalogue-identity-charter\|catalogue-identity]] | Guest signal attributed to the right item | 🟡 **blocked** — blocked on NF-B callers |
| `obs.decision_log_join_rate` | [[observability-telemetry-plumbing-charter\|observability-telemetry-plumbing]] | Share of spend rows joinable to a decision | ✅ **yes** — **measured by inspection — 0%; no key joins `api_spend` to `decision_log`** |
| `obs.metrics_with_liveness_twin_pct` | [[observability-telemetry-plumbing-charter\|observability-telemetry-plumbing]] | Metrics paired with a freshness check | ✅ **yes** — this document is the census; today ~0 |
| `platform.endpoints_protected_by_default_pct` | [[engineering-charter\|engineering]] *(+1)* | Endpoints guarded without opt-in | ✅ **yes** — route census — `TenantGuard` passes through when unauthenticated |
| `platform.public_decorator_count` | [[platform-api-charter\|platform-api]] | Explicit `@Public()` decorators | ✅ **yes** — grep — 11; duplicates `sec.public_decorator_count` |
| `platform.unguarded_reachable_routes` | [[platform-api-charter\|platform-api]] | Reachable routes with no guard | ✅ **yes** — **measured — 94** (137 − 32 webhook − 11 `@Public()`) |
| `pos.line_resolution_rate` | [[data-charter\|data]] *(+1)* | POS lines resolved to a catalogue item | 🟡 **blocked** — blocked on a connected POS — no provider adapter is `available` |
| `pos.provider_schema_drift_findings` | [[pos-operational-telemetry-ingest-charter\|pos-operational-telemetry-ingest]] | Provider payload shapes that changed | 🟡 **blocked** — blocked on a connected POS |
| `pos.unresolved_queue_depth` | [[pos-operational-telemetry-ingest-charter\|pos-operational-telemetry-ingest]] | Depth of the unresolved-line queue | 🟡 **blocked** — blocked on a connected POS; the table exists |
| `pos.worst_restaurant_resolution_rate` | [[pos-operational-telemetry-ingest-charter\|pos-operational-telemetry-ingest]] | Worst per-restaurant resolution rate | 🟡 **blocked** — blocked on a connected POS |
| `procurement.no_touch_reconciliation_rate` | [[procurement-vendor-network-charter\|procurement-vendor-network]] | Deliveries reconciled with no human touch | ✅ **yes** — SQL over the procurement tables; small n |
| `procurement.order_to_delivery_reconciliation_rate` | [[engineering-charter\|engineering]] *(+1)* | Orders matched to a delivery | ✅ **yes** — SQL; small n |
| `procurement.unguarded_money_moving_routes` | [[procurement-vendor-network-charter\|procurement-vendor-network]] | Money-moving routes with no guard | ✅ **yes** — route census |
| `release.env_drift_count` | [[release-engineering-charter\|release-engineering]] | Config differing between environments | 🟡 **blocked** — blocked on OD-49 / environment access |
| `resilience.buffer_evictions` | [[runtime-resilience-charter\|runtime-resilience]] | Work dropped under back-pressure | 🔴 **no instrument** — no runtime metric emission |
| `resilience.circuit_open_duration` | [[runtime-resilience-charter\|runtime-resilience]] | Time a breaker stayed open | 🔴 **no instrument** — same |
| `resilience.retry_amplification_factor` | [[runtime-resilience-charter\|runtime-resilience]] | Load multiplied by retries | 🔴 **no instrument** — same |
| `sales.density` | [[pos-operational-telemetry-ingest-charter\|pos-operational-telemetry-ingest]] | Sales per cover or per seat | 🟡 **blocked** — blocked on a connected POS |
| `schema.days_since_hand_applied_ddl` | [[engineering-charter\|engineering]] *(+1)* | Days since DDL was applied outside a migration | 🟡 **blocked** — blocked on OD-49 — the parity job has never compared anything |
| `schema.function_body_mismatches` | [[schema-migrations-charter\|schema-migrations]] | DB functions differing from the migration | 🟡 **blocked** — blocked on OD-49 |
| `schema.parity_job_green_streak` | [[schema-migrations-charter\|schema-migrations]] | Consecutive green parity runs | 🟡 **blocked** — blocked on OD-49 — a green run here would be vacuous |
| `sre.days_since_verified_restore` | [[release-engineering-charter\|release-engineering]] *(+1)* | Days since a restore was actually tested | ✅ **yes** — answerable today; the honest answer is 'never' |
| `sre.dlq_depth_and_oldest_age` | [[reliability-sre-charter\|reliability-sre]] *(+1)* | Dead-letter depth and age | 🟡 **blocked** — blocked on DB access for automation |
| `sre.mttd_silent_corruption` | [[reliability-sre-charter\|reliability-sre]] *(+1)* | Time to detect corruption that raises no error | 🔴 **no instrument** — no detector exists |
| `sre.time_to_revert` | [[release-engineering-charter\|release-engineering]] *(+1)* | Time from bad deploy to reverted | ✅ **yes** — deploy history |
| `substrate.confidence_threshold_value` | [[substrate-quality-coverage-charter\|substrate-quality-coverage]] | The enrichment confidence cut-off in force | ✅ **yes** — read from config |
| `substrate.governance_tier_distribution` | [[substrate-quality-coverage-charter\|substrate-quality-coverage]] | Rows by governance tier | ✅ **yes** — SQL |
| `substrate.quarantine_rate` | [[data-charter\|data]] *(+1)* | Share of ingested rows quarantined | ✅ **yes** — SQL |
| `substrate.repair_class_closure_rate` | [[substrate-quality-coverage-charter\|substrate-quality-coverage]] | Data-defect classes closed | 🔴 **no instrument** — no defect-class ledger |
| `substrate.rows_without_source_guarantee` | [[data-charter\|data]] *(+1)* | Rows with no provenance | ✅ **yes** — SQL — `wine_regions` is empty, so joins against it pass vacuously |
| `surfaces.reachable_route_ratio` | [[client-surfaces-charter\|client-surfaces]] *(+1)* | Routes reachable from navigation | ✅ **yes** — static route/link analysis of `apps/web` |
| `surfaces.semi_orphaned_routes` | [[client-surfaces-charter\|client-surfaces]] | Routes reachable only by deep link | ✅ **yes** — same |
| `surfaces.untraceable_route_components` | [[client-surfaces-charter\|client-surfaces]] | Routes whose component cannot be resolved | ✅ **yes** — same |
| `synthetic.archetype_representativeness` | [[synthetic-generation-simulation-charter\|synthetic-generation-simulation]] | How well synthetic restaurants match real ones | 🟡 **blocked** — blocked on real POS data to compare against |
| `synthetic.backtest_fidelity_gap` | [[data-charter\|data]] *(+1)* | Gap between synthetic and observed series | 🟡 **blocked** — blocked on a connected POS |
| `synthetic.degrade_profile_coverage` | [[synthetic-generation-simulation-charter\|synthetic-generation-simulation]] | Failure profiles the generator can produce | ✅ **yes** — read the synthetic engine's profile list |
| `synthetic.namespace_leak_count` | [[synthetic-generation-simulation-charter\|synthetic-generation-simulation]] | Synthetic rows escaping into production namespaces | ✅ **yes** — SQL/static check; SimPOS is non-production only since PR #32 |

### Applied AI — 14 metrics (10 yes · 1 blocked · 3 no instrument)

| Metric key | Owning unit | What it measures | Computable today? |
|---|---|---|---|
| `fleet.live_agent_ratio` | [[agent-fleet-charter\|agent-fleet]] *(+1)* | Registered agents with live call sites | ✅ **yes** — static scan — OD-31 counts 19/23/24/26 defensible answers |
| `nf_a.dlq_depth` | [[ai-orchestration-charter\|ai-orchestration]] *(+1)* | Dead-letter depth for agent tasks | 🟡 **blocked** — blocked on DB access (OD-49) for automation; a one-off SQL would work |
| `nf_a.retries` | [[ai-orchestration-charter\|ai-orchestration]] *(+1)* | Retries per agent task | 🔴 **no instrument** — no NF-A store; `AgentMetrics` does not record retries per task |
| `routing.routed_client_share` | [[ai-orchestration-charter\|ai-orchestration]] *(+1)* | Share of model calls going through the router | ✅ **yes** — grep of call sites — no router exists, so 0 |
| `safety.median_time_to_confirm` | [[action-safety-the-human-gate-charter\|action-safety-the-human-gate]] | Time from proposal to human confirm | 🔴 **no instrument** — no NF-A store; approval timestamps are not logged as events |
| `safety.rejection_rate` | [[action-safety-the-human-gate-charter\|action-safety-the-human-gate]] | Share of proposals a human rejects | 🔴 **no instrument** — same |
| `safety.unconfirmed_mutation_count` | [[action-safety-the-human-gate-charter\|action-safety-the-human-gate]] *(+1)* | Mutations executed without confirmation | ✅ **yes** — static route audit — OD-35/OD-40 are found instances |
| `skills.deletions_per_quarter` | [[skill-lifecycle-anti-sprawl-charter\|skill-lifecycle-anti-sprawl]] *(+1)* | Skills retired per quarter | ✅ **yes** — count `.claude/skills/` — 0 of 0 |
| `skills.description_disambiguation_rate` | [[skill-registry-authoring-charter\|skill-registry-authoring]] | Skill descriptions that state when to fire | ✅ **yes** — 0 of 0 |
| `skills.firing_rate_30d` | [[skill-lifecycle-anti-sprawl-charter\|skill-lifecycle-anti-sprawl]] *(+1)* | Skills that fired in 30 days | ✅ **yes** — 0 of 0 — the rule is live and vacuous |
| `skills.harvested_firing_rate_30d` | [[skill-harvesting-charter\|skill-harvesting]] | Harvested skills that fired in 30 days | ✅ **yes** — 0 of 0 |
| `skills.protocol_compliance_rate` | [[skill-registry-authoring-charter\|skill-registry-authoring]] *(+1)* | Skills meeting the 4-step creation protocol | ✅ **yes** — 0 of 0 |
| `skills.registry_size` | [[skill-harvesting-charter\|skill-harvesting]] *(+3)* | Committed `SKILL.md` files | ✅ **yes** — **measured — 0** |
| `skills.script_to_skill_ratio` | [[skill-harvesting-charter\|skill-harvesting]] *(+2)* | One-off scripts vs promoted skills | ✅ **yes** — `scripts/` count vs 0 skills |

### Intelligence — 34 metrics (27 yes · 4 blocked · 3 no instrument)

| Metric key | Owning unit | What it measures | Computable today? |
|---|---|---|---|
| `analytics.candidate_type_count` | [[analytics-engine-charter\|analytics-engine]] | Size of the enumerated insight-type space | ✅ **yes** — import-time build of `INSIGHT_CANDIDATES`; the count OD-33 says is unpinned |
| `analytics.claims_without_provenance` | [[metric-contract-truth-assurance-charter\|metric-contract-truth-assurance]] | Published analytics claims with no traceable source | ✅ **yes** — audit of docs/UI against source; OD-33 is the live instance |
| `analytics.consultant_enabled_restaurants` | [[analytics-bi-charter\|analytics-bi]] *(+1)* | Restaurants with the toggle-gated consultant layer on | ✅ **yes** — SQL over the toggle rows; denominator is near-zero |
| `analytics.engine_foreign_imports` | [[analytics-engine-charter\|analytics-engine]] | Imports reaching into the pure engine from outside it | ✅ **yes** — static import scan of `analytics/engine/` |
| `analytics.engine_service_test_ratio` | [[analytics-bi-charter\|analytics-bi]] *(+1)* | Spec lines vs service lines in the engine | ✅ **yes** — line count |
| `analytics.false_discovery_estimate` | [[analytics-engine-charter\|analytics-engine]] | Share of served insights that are statistical noise | 🟡 **blocked** — blocked on POS data — no real series to estimate FDR against |
| `analytics.insight_acceptance_rate` | [[analytics-bi-charter\|analytics-bi]] *(+1)* | Share of served insights an owner acts on | ✅ **yes** — SQL over `recommendation_actions`; numerator will be ~0 until there are users |
| `analytics.insight_feedback_coverage` | [[insight-narrative-generation-charter\|insight-narrative-generation]] | Share of served insights carrying any feedback signal | ✅ **yes** — `recommendation_impressions` ⋈ `recommendation_actions`; sparse |
| `analytics.insufficient_data_render_rate` | [[insight-narrative-generation-charter\|insight-narrative-generation]] | Share of renders falling back to 'not enough data' | 🔴 **no instrument** — no render-path logging exists |
| `analytics.kpi_ground_truth_agreement` | [[analytics-bi-charter\|analytics-bi]] *(+1)* | Engine output vs hand-computed truth | 🟡 **blocked** — blocked on a gold set — `annotation.gold_set_size` is 0 |
| `analytics.metric_claim_divergence_count` | [[analytics-bi-charter\|analytics-bi]] *(+1)* | Same quantity published as different numbers | ✅ **yes** — measured: the insight count has 4 circulating values (OD-33) |
| `analytics.registry_binding_share` | [[metric-contract-truth-assurance-charter\|metric-contract-truth-assurance]] | Share of published metrics bound to `metric-registry.ts` | ✅ **yes** — static scan against the 33 registry keys |
| `analytics.satisfiable_candidate_share` | [[analytics-bi-charter\|analytics-bi]] *(+1)* | Share of insight types computable from available signals | ✅ **yes** — **measured — 25.1% without POS**; the one org metric with a real number |
| `analytics.served_rule_concentration` | [[insight-narrative-generation-charter\|insight-narrative-generation]] | How few rules produce most served insights | ✅ **yes** — SQL over impressions; sparse |
| `analytics.silent_zero_paths` | [[metric-contract-truth-assurance-charter\|metric-contract-truth-assurance]] | Code paths returning 0 instead of 'no data' | ✅ **yes** — static audit of the engine |
| `analytics.top_rank_ignore_rate` | [[insight-narrative-generation-charter\|insight-narrative-generation]] | Share of top-ranked insights ignored | ✅ **yes** — impressions ⋈ actions; sparse |
| `nf_a.unauthenticated_inference_spend` | [[ai-surface-security-charter\|ai-surface-security]] *(+1)* | Paid model spend driven by unauthenticated callers | 🔴 **no instrument** — `api_spend` has no caller identity column |
| `nf_b.aggregate_guest_signal_consumed` | [[insight-narrative-generation-charter\|insight-narrative-generation]] | Guest signal actually consumed by narrative | 🟡 **blocked** — blocked on NF-B callers — the guest tables have zero application call sites |
| `nf_b.checks_dependent_candidate_share` | [[analytics-engine-charter\|analytics-engine]] | Share of insight types that need POS `checks` | ✅ **yes** — **measured — 429/573 (74.9%)** |
| `sec.autonomous_send_rate` | [[ai-surface-security-charter\|ai-surface-security]] | Share of outbound messages sent without human confirm | ✅ **yes** — SQL over the send log + the full-autonomy flag (`inbound-responder.service.ts:511`) |
| `sec.checklist_12c_items_with_a_reading` | [[security-charter\|security]] | Security-checklist items that have an actual measurement | ✅ **yes** — count against the checklist; most read 'none' |
| `sec.corpus_detection_rate` | [[ai-surface-security-charter\|ai-surface-security]] | Share of the injection corpus the guards catch | 🟡 **blocked** — blocked on an injection corpus — `sec.injection_corpus_size` is 0 |
| `sec.cross_tenant_write_paths` | [[access-control-tenant-isolation-charter\|access-control-tenant-isolation]] | Write paths reachable across tenant boundaries | ✅ **yes** — route census + `TenantGuard` audit (`tenant.guard.ts:38-46`) |
| `sec.distributed_rate_limit_present` | [[perimeter-ingress-integrity-charter\|perimeter-ingress-integrity]] | Whether a shared rate limiter exists | ✅ **yes** — boolean, readable from config today |
| `sec.fail_open_defaults` | [[perimeter-ingress-integrity-charter\|perimeter-ingress-integrity]] *(+1)* | Guards that pass when their input is missing | ✅ **yes** — static audit; OD-39 is a found instance |
| `sec.injection_corpus_size` | [[ai-surface-security-charter\|ai-surface-security]] *(+1)* | Size of the prompt-injection test corpus | ✅ **yes** — count — the corpus does not exist, so the answer is 0 |
| `sec.model_callsites_emitting_cost` | [[ai-surface-security-charter\|ai-surface-security]] | Model call sites that write a spend row | ✅ **yes** — grep — 7 raw-HTTP gateway call sites emit nothing (PLAN P1) |
| `sec.public_decorator_count` | [[access-control-tenant-isolation-charter\|access-control-tenant-isolation]] *(+1)* | Explicit `@Public()` decorators | ✅ **yes** — grep — census recorded 11 |
| `sec.recurrence_guard_present` | [[access-control-tenant-isolation-charter\|access-control-tenant-isolation]] *(+1)* | Whether a CI guard blocks the defect class recurring | ✅ **yes** — read `.github/workflows/` |
| `sec.secrets_in_url_or_bundle` | [[perimeter-ingress-integrity-charter\|perimeter-ingress-integrity]] | Secrets reachable in a URL or a client bundle | ✅ **yes** — static scan; OD-36 is a found instance |
| `sec.tenants_with_inference_budget` | [[ai-surface-security-charter\|ai-surface-security]] | Tenants with a spend cap configured | ✅ **yes** — SQL; expected 0 — no budget mechanism ships |
| `sec.unguarded_authenticated_surface` | [[access-control-tenant-isolation-charter\|access-control-tenant-isolation]] *(+1)* | Authenticated routes with no guard | ✅ **yes** — route census — measured 94 unguarded by omission (OD-19) |
| `sec.unverified_public_ingress` | [[perimeter-ingress-integrity-charter\|perimeter-ingress-integrity]] *(+1)* | Public ingress routes with no signature verification | ✅ **yes** — route census |
| `sec.verdicts_reversed` | [[access-control-tenant-isolation-charter\|access-control-tenant-isolation]] | Classification verdicts later overturned | 🔴 **no instrument** — no verdict ledger exists — OD-19's classification has never been run |

### Product — 66 metrics (29 yes · 24 blocked · 13 no instrument)

| Metric key | Owning unit | What it measures | Computable today? |
|---|---|---|---|
| `askai.allowlist_family_count` | [[ask-ai-charter\|ask-ai]] | Question families Ask AI will answer | ✅ **yes** — read the allowlist |
| `askai.confirm_without_edit_rate` | [[ask-ai-charter\|ask-ai]] *(+1)* | Proposals confirmed unedited | 🔴 **no instrument** — no interaction logging for Ask AI |
| `askai.entry_point_count` | [[ask-ai-charter\|ask-ai]] *(+1)* | Surfaces that can open Ask AI | ✅ **yes** — static scan of `apps/web` |
| `askai.refusal_correctness` | [[ask-ai-charter\|ask-ai]] *(+1)* | Refusals that were the right call | 🔴 **no instrument** — no eval set, no interaction log |
| `design.a11y_violations_per_pr` | [[design-system-motion-substrate-charter\|design-system-motion-substrate]] | Accessibility violations introduced per PR | 🔴 **no instrument** — no a11y gate in CI |
| `design.bespoke_components_added` | [[design-system-motion-substrate-charter\|design-system-motion-substrate]] | One-off components added outside the system | ✅ **yes** — static scan of `packages/ui` vs app-local components |
| `design.blocked_on_endpoint_count` | [[ux-path-burn-down-charter\|ux-path-burn-down]] | UX paths blocked on a missing endpoint | ✅ **yes** — count over the UX path catalogue |
| `design.deferred_unblocker_ratio` | [[design-charter\|design]] *(+1)* | Blocked paths whose unblocker is deferred | ✅ **yes** — same |
| `design.first_run_completion_rate_by_role` | [[activation-in-product-guidance-charter\|activation-in-product-guidance]] | First-run completion by role | 🔴 **no instrument** — no product analytics; no users |
| `design.ledger_drift_days` | [[design-charter\|design]] *(+1)* | Days since the burn-down ledger was updated | ✅ **yes** — file dates |
| `design.open_null_winner_count` | [[exploration-studio-charter\|exploration-studio]] | Sketch explorations with no chosen winner | ✅ **yes** — count over the sketch index |
| `design.options_per_sketch_median` | [[exploration-studio-charter\|exploration-studio]] | Options explored per sketch | ✅ **yes** — same |
| `design.paths_closed_on_service_routes` | [[ux-path-burn-down-charter\|ux-path-burn-down]] | Service-critical UX paths closed | ✅ **yes** — count over the catalogue (~90–100 of 760 closed) |
| `design.paths_closed_per_month` | [[design-charter\|design]] *(+1)* | UX paths closed per month | ✅ **yes** — git history over the catalogue |
| `design.primitive_documented_ratio` | [[design-system-motion-substrate-charter\|design-system-motion-substrate]] | Design primitives with documentation | ✅ **yes** — static scan |
| `design.resolved_question_rate` | [[design-charter\|design]] *(+1)* | Design questions answered vs raised | ✅ **yes** — count over `questions.md` |
| `design.role_default_coverage_pct` | [[activation-in-product-guidance-charter\|activation-in-product-guidance]] | Surfaces with a role-appropriate default | ✅ **yes** — static scan |
| `design.sketch_index_completeness` | [[exploration-studio-charter\|exploration-studio]] | Sketches present in the index | ✅ **yes** — file count vs index |
| `design.surface_items_cut_by_role` | [[activation-in-product-guidance-charter\|activation-in-product-guidance]] | Items hidden per role | ✅ **yes** — static scan |
| `design.system_composition_pct` | [[design-system-motion-substrate-charter\|design-system-motion-substrate]] | UI built from system primitives | ✅ **yes** — static scan |
| `design.time_to_first_real_action_manager_min` | [[activation-in-product-guidance-charter\|activation-in-product-guidance]] | Minutes to a manager's first real action | 🔴 **no instrument** — no product analytics; no users |
| `design.time_to_first_real_action_owner_min` | [[activation-in-product-guidance-charter\|activation-in-product-guidance]] | Minutes to an owner's first real action | 🔴 **no instrument** — same |
| `design.time_to_first_real_action_staff_min` | [[activation-in-product-guidance-charter\|activation-in-product-guidance]] *(+1)* | Minutes to a staff member's first real action | 🔴 **no instrument** — same |
| `design.token_source_count` | [[design-charter\|design]] *(+1)* | Distinct sources defining a design token | ✅ **yes** — static scan |
| `design.winner_shipped_conversion` | [[exploration-studio-charter\|exploration-studio]] | Sketch winners that shipped | ✅ **yes** — sketch index vs shipped routes |
| `floor.kitchen_ready_to_waiter_p95_seconds` | [[product-vision-charter\|product-vision]] *(+1)* | p95 from kitchen-ready to waiter notified | 🔴 **no instrument** — `kitchen-ready` is unmodelled in `CanonicalCheck` — no signal exists at all |
| `floor.misroute_rate` | [[product-vision-charter\|product-vision]] *(+1)* | Alerts sent to the wrong staff member | 🔴 **no instrument** — same — Floor Checker is unbuilt |
| `floor.providers_emitting_kitchen_ready` | [[service-floor-charter\|service-floor]] | POS providers that emit kitchen-ready | ✅ **yes** — read the 27-provider registry; expected 0 |
| `floor.providers_emitting_table_and_server` | [[service-floor-charter\|service-floor]] | Providers emitting table + server on a check | ✅ **yes** — read the registry |
| `inbound.false_accept_count` | [[inbound-understanding-charter\|inbound-understanding]] *(+1)* | Wrong drafts approved by a human | 🔴 **no instrument** — no approval-outcome ledger |
| `inbound.p50_time_to_approve_seconds` | [[inbound-understanding-charter\|inbound-understanding]] | Median time to approve a draft | 🟡 **blocked** — blocked on DB access for automation; timestamps exist in `procurement_conversations` |
| `inbound.proposal_accept_without_edit_rate` | [[inbound-understanding-charter\|inbound-understanding]] *(+1)* | Drafts approved unedited | 🟡 **blocked** — same — the columns exist, the query has never been run |
| `nf_a.outcome` | [[inbound-understanding-charter\|inbound-understanding]] | Task outcome (success / failure / partial) | 🔴 **no instrument** — no NF-A store; `AgentMetrics.success` is not a doneability verdict |
| `nf_b.abuse_hold_rate` | [[consumer-app-points-economy-charter\|consumer-app-points-economy]] | Points claims held for abuse review | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.consented_link_rate` | [[guest-identity-consent-charter\|guest-identity-consent]] | Guests who consented to a check link | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.divergence_within_cohort` | [[guest-experience-charter\|guest-experience]] *(+1)* | Taste spread inside a cohort | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.event_completeness` | [[guest-experience-charter\|guest-experience]] *(+1)* | Guest events carrying every required field | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.events_per_active_guest_month` | [[consumer-app-points-economy-charter\|consumer-app-points-economy]] *(+1)* | Guest events per active guest per month | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.exposure_prior_coverage` | [[taste-fingerprint-charter\|taste-fingerprint]] | Guests with an exposure prior | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.false_merge_count` | [[guest-experience-charter\|guest-experience]] *(+1)* | Distinct guests merged into one | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.k_anonymity_pass_rate` | [[guest-experience-charter\|guest-experience]] *(+1)* | Cohort renders meeting the k-anonymity floor | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.novel_stimulus_hit_rate` | [[taste-fingerprint-charter\|taste-fingerprint]] | Recommendations of unseen items that landed | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.ops_conversion` | [[guest-experience-charter\|guest-experience]] *(+1)* | Guest signal that changed an operator decision | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.photo_consent_rate` | [[guest-value-monetization-charter\|guest-value-monetization]] | Guests consenting to photo use | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.points_confirm_rate` | [[consumer-app-points-economy-charter\|consumer-app-points-economy]] *(+1)* | Points claims confirmed | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.refusal_count` | [[guest-identity-consent-charter\|guest-identity-consent]] | Guests refusing the consent gate | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.review_quality_pass_rate` | [[consumer-app-points-economy-charter\|consumer-app-points-economy]] | Guest reviews passing the quality bar | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.segment_to_decision_latency` | [[guest-value-monetization-charter\|guest-value-monetization]] | Time from segment built to decision made | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.sub_k_render_attempts` | [[guest-value-monetization-charter\|guest-value-monetization]] | Renders blocked for being under k | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.subject_coverage` | [[guest-experience-charter\|guest-experience]] *(+1)* | Guests with an NF-B record | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.tourist_delta_coverage` | [[taste-fingerprint-charter\|taste-fingerprint]] | Coverage of the tourist-vs-local split | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.unverified_identifier_share` | [[guest-identity-consent-charter\|guest-identity-consent]] | Guest identifiers never verified | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.verified_visit_rate` | [[consumer-app-points-economy-charter\|consumer-app-points-economy]] | Visits verified against a check | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `pi.canonical_shape_drift` | [[pos-bridge-charter\|pos-bridge]] | Provider payloads drifting from the canonical shape | 🟡 **blocked** — blocked on a connected POS |
| `pi.doc_corrections_carried` | [[partnerships-integrations-charter\|partnerships-integrations]] | Partner-doc corrections carried back into the registry | ✅ **yes** — git history over the registry |
| `pi.live_counterparties` | [[partnerships-integrations-charter\|partnerships-integrations]] *(+1)* | Partners with a live integration | ✅ **yes** — **measured — 0 native adapters are `available`** |
| `pi.merchant_backed_providers` | [[partnerships-integrations-charter\|partnerships-integrations]] *(+1)* | Providers with a merchant agreement | ✅ **yes** — read the registry; 0 |
| `pi.time_to_first_response` | [[partner-alliance-development-charter\|partner-alliance-development]] | Partner response latency | 🔴 **no instrument** — no partner CRM or engagement log |
| `pi.unblocking_agreements` | [[partner-alliance-development-charter\|partner-alliance-development]] *(+1)* | Agreements that unblocked a build | 🔴 **no instrument** — same |
| `pi.verified_ingress_ratio` | [[connector-platform-trust-charter\|connector-platform-trust]] *(+1)* | Connector ingress verifying signatures | ✅ **yes** — route census |
| `supply.needed_sku_denominator_size` | [[supply-discovery-charter\|supply-discovery]] | SKUs a restaurant needs but cannot source | 🟡 **blocked** — blocked on a connected POS — the denominator flatters without it |
| `supply.price_freshness_p50_days` | [[product-vision-charter\|product-vision]] *(+1)* | Median age of a vendor price | ✅ **yes** — SQL over the price history |
| `supply.sku_dual_price_coverage_pct` | [[product-vision-charter\|product-vision]] *(+1)* | SKUs with two comparable vendor prices | ✅ **yes** — SQL |
| `surface.routes_without_owning_module` | [[surface-portfolio-charter\|surface-portfolio]] | Routes with no owning module | ✅ **yes** — static scan |
| `surface.unowned_surface_count` | [[product-vision-charter\|product-vision]] *(+1)* | Surfaces with no owning unit | ✅ **yes** — static scan vs the org map |
| `surface.untraceable_route_components` | [[surface-portfolio-charter\|surface-portfolio]] | Routes whose component cannot be resolved | ✅ **yes** — static scan; duplicates `surfaces.untraceable_route_components` |

### Commercial — 48 metrics (25 yes · 7 blocked · 16 no instrument)

| Metric key | Owning unit | What it measures | Computable today? |
|---|---|---|---|
| `answer_surface.assistant_citations` | [[growth-charter\|growth]] *(+1)* | Times an AI assistant cites us | 🔴 **no instrument** — no external monitoring account |
| `content.draft_queue_weeks` | [[content-production-charter\|content-production]] | Weeks of drafts in the queue | ✅ **yes** — count the queue; it is a file list |
| `content.faq_orphan_pages` | [[content-production-charter\|content-production]] *(+1)* | FAQ pages nothing links to | ✅ **yes** — link check |
| `content.first_pass_clear_rate` | [[content-production-charter\|content-production]] | Drafts clearing the editorial gate first time | 🔴 **no instrument** — no editorial ledger exists |
| `content.published_units_per_week` | [[content-production-charter\|content-production]] *(+1)* | Published pieces per week | ✅ **yes** — git history; currently 0 |
| `conversion.checklist_items_green` | [[conversion-funnel-charter\|conversion-funnel]] | Conversion checklist items passing | ✅ **yes** — read the checklist |
| `conversion.privacy_coupling_violations` | [[conversion-funnel-charter\|conversion-funnel]] | Funnel tracking coupled to personal data | ✅ **yes** — static scan |
| `demand.queue_depth_weeks` | [[search-demand-research-charter\|search-demand-research]] | Weeks of researched demand in the queue | ✅ **yes** — count the queue |
| `demand.queue_rejection_reasons` | [[search-demand-research-charter\|search-demand-research]] | Why demand items were rejected | 🔴 **no instrument** — no rejection ledger |
| `demand.uncovered_keyword_count` | [[growth-charter\|growth]] *(+1)* | Keywords with no page | 🔴 **no instrument** — no keyword-research tool account |
| `demand.wedge_share_of_corpus` | [[growth-charter\|growth]] *(+1)* | Share of content on the wedge topic | ✅ **yes** — corpus scan; currently 0 published |
| `editorial.claims_now_stale` | [[editorial-gate-charter\|editorial-gate]] | Published claims that have gone stale | ✅ **yes** — corpus scan |
| `editorial.claims_traceable_pct` | [[editorial-gate-charter\|editorial-gate]] *(+1)* | Published claims with a citation | ✅ **yes** — corpus scan |
| `editorial.gate_bypass_count` | [[editorial-gate-charter\|editorial-gate]] *(+1)* | Publishes that skipped the gate | 🔴 **no instrument** — no gate exists to bypass yet |
| `editorial.overstated_claim_catches` | [[editorial-gate-charter\|editorial-gate]] | Overstatements caught before publish | 🔴 **no instrument** — same |
| `editorial.rejection_rate` | [[editorial-gate-charter\|editorial-gate]] | Drafts rejected at the gate | 🔴 **no instrument** — same |
| `fin.cost_to_serve_per_restaurant_month` | [[finance-pricing-charter\|finance-pricing]] *(+1)* | Monthly cost to serve one restaurant | 🟡 **blocked** — blocked on NF-A — `api_spend` has no `restaurant_id` on most rows and no agent attribution |
| `fin.external_price_quotes_logged` | [[finance-pricing-charter\|finance-pricing]] *(+1)* | Competitor price quotes recorded | ✅ **yes** — count the file; currently 0 — OD-23 is open |
| `fin.gross_margin_per_restaurant_month` | [[unit-economics-pricing-charter\|unit-economics-pricing]] | Margin per restaurant per month | 🟡 **blocked** — blocked on OD-23 (no price) **and** NF-A (no cost attribution) |
| `fin.hours_since_last_spend_row` | [[finance-pricing-charter\|finance-pricing]] *(+1)* | Hours since the last `api_spend` row | ✅ **yes** — `select max(timestamp) from api_spend` — **the one liveness metric that works today** |
| `fin.metered_invocation_coverage_pct` | [[finance-pricing-charter\|finance-pricing]] *(+1)* | Model invocations that write a spend row | ✅ **yes** — grep — 7 gateway call sites write nothing |
| `fin.monthly_provider_spend_vs_cap_pct` | [[finance-pricing-charter\|finance-pricing]] *(+1)* | Spend against a cap | 🟡 **blocked** — blocked — no cap is configured anywhere |
| `fin.non_design_partner_restaurant_count` | [[finance-pricing-charter\|finance-pricing]] *(+1)* | Paying restaurants that are not design partners | ✅ **yes** — SQL; expected 0 |
| `fin.spend_attribution_coverage_pct` | [[finance-pricing-charter\|finance-pricing]] *(+1)* | Spend rows attributable to an agent or task | ✅ **yes** — **the answer is 0% — `api_spend` has no `agent` column** (`baseline:2231-2240`) |
| `fin.spend_reconciliation_variance_pct` | [[finance-pricing-charter\|finance-pricing]] *(+1)* | Our spend total vs the provider invoice | ✅ **yes** — SQL vs the provider console; manual |
| `funnel.fabricated_social_proof_count` | [[conversion-funnel-charter\|conversion-funnel]] *(+1)* | Social-proof claims with no source | ✅ **yes** — scan the marketing surfaces |
| `funnel.measurable_steps` | [[conversion-funnel-charter\|conversion-funnel]] *(+1)* | Funnel steps that emit anything | ✅ **yes** — static scan — expected near 0 |
| `funnel.step_dropoff` | [[conversion-funnel-charter\|conversion-funnel]] | Drop-off between funnel steps | 🔴 **no instrument** — no product analytics |
| `funnel.visit_to_activated_rate` | [[conversion-funnel-charter\|conversion-funnel]] *(+1)* | Visitors reaching first real action | 🔴 **no instrument** — same |
| `nf_b.choice` | [[customer-relationship-research-charter\|customer-relationship-research]] *(+1)* | What a guest chose | 🟡 **blocked** — blocked on NF-B callers |
| `nf_b.context` | [[customer-relationship-research-charter\|customer-relationship-research]] *(+1)* | Context around a guest choice (region, season, companions) | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `nf_b.source_count` | [[design-partner-operations-charter\|design-partner-operations]] *(+1)* | Distinct sources of guest signal | 🟡 **blocked** — blocked on NF-B callers — 3 tables, 564 lines of migration, **zero application call sites** |
| `sales.blocker_age_max` | [[design-partner-operations-charter\|design-partner-operations]] | Age of the oldest design-partner blocker | ✅ **yes** — read the partner notes |
| `sales.claim_provenance_rate` | [[outbound-engine-charter\|outbound-engine]] | Outbound claims with a source | ✅ **yes** — scan the outbound templates |
| `sales.complaint_rate` | [[outbound-engine-charter\|outbound-engine]] | Spam complaints per send | 🔴 **no instrument** — no sending infrastructure in use |
| `sales.design_partner_touch_streak` | [[design-partner-operations-charter\|design-partner-operations]] *(+1)* | Consecutive weeks of partner contact | 🔴 **no instrument** — no CRM or contact log |
| `sales.qualified_conversation_rate` | [[outbound-engine-charter\|outbound-engine]] *(+1)* | Conversations that qualified | 🔴 **no instrument** — same |
| `sales.reply_rate` | [[outbound-engine-charter\|outbound-engine]] | Replies per outbound send | 🔴 **no instrument** — same |
| `sales.sending_identity_isolated` | [[outbound-engine-charter\|outbound-engine]] *(+1)* | Whether outbound uses a separate domain | ✅ **yes** — boolean, checkable from DNS/config |
| `sales.suppression_integrity` | [[outbound-engine-charter\|outbound-engine]] | Whether the suppression list is honoured | ✅ **yes** — static check; no list exists yet |
| `sales.time_to_first_connection` | [[design-partner-operations-charter\|design-partner-operations]] *(+1)* | Days from signup to first integration | 🟡 **blocked** — blocked on a connected POS |
| `sales.unprompted_sessions_7d` | [[design-partner-operations-charter\|design-partner-operations]] *(+1)* | Partner sessions with no prompting | 🔴 **no instrument** — no product analytics |
| `sales.verified_dollars_recovered` | [[design-partner-operations-charter\|design-partner-operations]] *(+1)* | Money a partner actually recovered | 🔴 **no instrument** — no outcome ledger; the credit-claim path opens claims but never sends |
| `seo.checklist_items_green` | [[technical-seo-ai-answer-surface-charter\|technical-seo-ai-answer-surface]] | Technical SEO checklist items passing | ✅ **yes** — read the checklist |
| `seo.indexed_pages` | [[growth-charter\|growth]] *(+1)* | Pages in the search index | 🔴 **no instrument** — no Search Console account connected |
| `seo.soft_404_rate` | [[growth-charter\|growth]] *(+1)* | Pages returning 200 with no content | ✅ **yes** — crawl of the deployed site |
| `seo.title_in_source_pct` | [[technical-seo-ai-answer-surface-charter\|technical-seo-ai-answer-surface]] | Pages with a title in server-rendered HTML | ✅ **yes** — crawl — the app is a Vite SPA, so expect near 0 |
| `seo.unowned_requirements` | [[technical-seo-ai-answer-surface-charter\|technical-seo-ai-answer-surface]] | SEO requirements with no owner | ✅ **yes** — read the requirement list |

### Corporate — 54 metrics (43 yes · 1 blocked · 10 no instrument)

| Metric key | Owning unit | What it measures | Computable today? |
|---|---|---|---|
| `compliance.notice_accuracy` | [[compliance-privacy-charter\|compliance-privacy]] *(+1)* | Whether the privacy notice matches behaviour | ✅ **yes** — read `Privacy.tsx` against the code — OD-27 records it still says 'WineOps' |
| `compliance.obligation_coverage` | [[compliance-privacy-charter\|compliance-privacy]] *(+1)* | Regulatory obligations with a named control | ✅ **yes** — read the obligation list |
| `compliance.questionnaire_answerable_rate` | [[regulatory-posture-charter\|regulatory-posture]] | Security-questionnaire items answerable | ✅ **yes** — read the questionnaire against evidence |
| `compliance.subprocessor_classification` | [[compliance-privacy-charter\|compliance-privacy]] *(+1)* | Subprocessors classified | ✅ **yes** — read `EXTERNAL_CONNECTIONS.md` |
| `compliance.unevidenced_clause_count` | [[regulatory-posture-charter\|regulatory-posture]] | Contract clauses with no evidence behind them | ✅ **yes** — corpus scan |
| `corpus.ambiguous_duplicate_count` | [[corpus-archive-charter\|corpus-archive]] *(+1)* | Files whose basename is ambiguous | ✅ **yes** — **measured — 33 ambiguous `[[links]]` remain after OD-32's 519 repairs** |
| `corpus.duplicate_basename_count` | [[corpus-archive-charter\|corpus-archive]] *(+1)* | Basenames used by more than one file | ✅ **yes** — `find` + sort — 45 files named `README.md` |
| `corpus.orphan_doc_count` | [[corpus-archive-charter\|corpus-archive]] | Documents nothing links to | ✅ **yes** — link graph over `.planning/` |
| `corpus.top_level_planning_docs` | [[corpus-archive-charter\|corpus-archive]] | Top-level `.planning/*.md` files | ✅ **yes** — **measured — 28** (OD-01) |
| `graph.ambiguous_basename_count` | [[graph-retrieval-charter\|graph-retrieval]] | Basenames Obsidian cannot resolve uniquely | ✅ **yes** — file scan |
| `graph.dataview_executable` | [[graph-retrieval-charter\|graph-retrieval]] | Whether the Dataview queries actually run | ✅ **yes** — open the vault; the loop frontmatter fix made this true |
| `graph.frontmatter_coverage_pct` | [[graph-retrieval-charter\|graph-retrieval]] *(+1)* | Docs carrying `type`/`division`/`links` | ✅ **yes** — **measured — 792/792 org docs carry frontmatter** |
| `graph.link_resolution_rate` | [[graph-retrieval-charter\|graph-retrieval]] *(+1)* | Wikilinks that resolve | ✅ **yes** — link check — 33 unresolved remain, all prose examples |
| `graph.linked_file_ratio` | [[graph-retrieval-charter\|graph-retrieval]] | Files with at least one inbound link | ✅ **yes** — link graph |
| `kd.docs_added_vs_retired_ratio` | [[knowledge-documentation-charter\|knowledge-documentation]] | Documents added per document retired | ✅ **yes** — **measured — 28 added / 0 retired** at the loop's own last reading |
| `legal.annex_satisfiability_signoff` | [[commercial-workforce-agreements-charter\|commercial-workforce-agreements]] *(+1)* | Annex commitments signed off as satisfiable | 🔴 **no instrument** — no signoff record exists |
| `legal.cap_table_tie_out_divergence` | [[instruments-equity-charter\|instruments-equity]] | Cap table vs instruments divergence | 🔴 **no instrument** — no cap table in this repo |
| `legal.clause_library_hit_rate` | [[commercial-workforce-agreements-charter\|commercial-workforce-agreements]] *(+1)* | Drafts served from the clause library | 🔴 **no instrument** — no clause library exists |
| `legal.consent_record_completeness` | [[instruments-equity-charter\|instruments-equity]] | Consents with a complete record | 🔴 **no instrument** — no consent record store |
| `legal.counsel_gate_compliance` | [[instruments-equity-charter\|instruments-equity]] *(+1)* | Instruments that passed the counsel gate | 🔴 **no instrument** — no gate log |
| `legal.instrument_chain_integrity` | [[instruments-equity-charter\|instruments-equity]] *(+1)* | Instrument chain internally consistent | 🔴 **no instrument** — no instrument register in this repo |
| `legal.named_reviewer_coverage` | [[commercial-workforce-agreements-charter\|commercial-workforce-agreements]] | Agreements with a named reviewer | 🔴 **no instrument** — same |
| `legal.request_to_executable_draft_days` | [[commercial-workforce-agreements-charter\|commercial-workforce-agreements]] *(+1)* | Days from request to a signable draft | 🔴 **no instrument** — no request log |
| `nf_a.agent_attributed_spend_pct` | [[performance-doneability-charter\|performance-doneability]] | Spend attributable to a named agent | ✅ **yes** — **0% — `api_spend` has no `agent` column**; the number exists and it is zero |
| `nf_b.research_store_erasability` | [[compliance-privacy-charter\|compliance-privacy]] | Whether the research log can honour an erasure | ✅ **yes** — readable from the schema design today |
| `privacy.consent_call_sites` | [[compliance-privacy-charter\|compliance-privacy]] *(+1)* | Application call sites hitting the consent gate | ✅ **yes** — grep — **0** |
| `privacy.consent_gate_denials` | [[compliance-privacy-charter\|compliance-privacy]] *(+1)* | Times the consent gate refused | 🟡 **blocked** — blocked on NF-B callers — the gate is never called |
| `privacy.erasure_completeness` | [[compliance-privacy-charter\|compliance-privacy]] *(+1)* | Stores an erasure actually clears | ✅ **yes** — schema audit |
| `privacy.guard_allowlist_size` | [[privacy-engineering-charter\|privacy-engineering]] | Entries in the privacy guard allowlist | ✅ **yes** — read `check_no_raw_guest_channels.sh` / `check_no_guest_name_matching.sh` |
| `privacy.pii_definition_count` | [[compliance-privacy-charter\|compliance-privacy]] *(+1)* | Distinct definitions of PII in the corpus | ✅ **yes** — corpus scan |
| `privacy.store_inventory_coverage` | [[privacy-engineering-charter\|privacy-engineering]] | Data stores inventoried | ✅ **yes** — migration scan vs the inventory doc |
| `regops.deadline_miss_count` | [[regulated-operations-charter\|regulated-operations]] | Regulatory deadlines missed | 🔴 **no instrument** — no deadline register; the unit is ⏸ paused |
| `regops.excise_reconciliation_variance` | [[regulated-operations-charter\|regulated-operations]] | Excise reported vs computed | 🔴 **no instrument** — same |
| `regops.jurisdiction_count` | [[regulated-operations-charter\|regulated-operations]] | Jurisdictions in scope | ✅ **yes** — read the charter; the unit is ⏸ paused |
| `regops.trigger_check_freshness` | [[regulated-operations-charter\|regulated-operations]] | Age of the last regulatory trigger check | ✅ **yes** — file dates |
| `roster.declared_stub_count` | [[roster-lifecycle-charter\|roster-lifecycle]] | Agents declared but stubbed | ✅ **yes** — static scan — part of OD-31's ≥7 defects |
| `roster.headcount_claim_variance` | [[roster-lifecycle-charter\|roster-lifecycle]] | Spread between agent-count claims | ✅ **yes** — **measured — 4 defensible answers: 19 / 23 / 24 / 26** (OD-31) |
| `roster.maturity_level_evidenced_pct` | [[people-agent-ops-charter\|people-agent-ops]] *(+1)* | Agents whose maturity claim has evidence | ✅ **yes** — static scan |
| `roster.retirement_count` | [[roster-lifecycle-charter\|roster-lifecycle]] | Agents retired | ✅ **yes** — git history; 0 |
| `roster.silent_default_spec_count` | [[people-agent-ops-charter\|people-agent-ops]] *(+1)* | Agents resolving spec from a silent `{}` | ✅ **yes** — **measured — 4** (`core/agent_registry.py:337`) |
| `roster.truth_pct` | [[people-agent-ops-charter\|people-agent-ops]] *(+1)* | Share of roster claims that survive verification | ✅ **yes** — static scan of `services/agent-orchestrator/` |
| `roster.unregistered_module_count` | [[people-agent-ops-charter\|people-agent-ops]] *(+1)* | `BaseAgent` subclasses never registered | ✅ **yes** — **measured — 3** |
| `standards.contract_self_compliance_pct` | [[standards-verification-charter\|standards-verification]] | Contracts this org obeys its own version of | ✅ **yes** — corpus scan — ORG_STRUCTURE §5 failed its own contract for 482 loops |
| `standards.correction_age_days` | [[standards-verification-charter\|standards-verification]] | Age of an unapplied correction | ✅ **yes** — corpus scan |
| `standards.docs_past_60_day_rule` | [[standards-verification-charter\|standards-verification]] | Agendas older than 60 days | ✅ **yes** — file dates — **198 agendas all fire together on 2026-10-23** |
| `standards.regenerated_companion_age_days` | [[standards-verification-charter\|standards-verification]] | Age of a generated companion vs its source | ✅ **yes** — file dates |
| `standards.stale_brand_doc_count` | [[standards-verification-charter\|standards-verification]] | Docs still saying 'WineOps' | ✅ **yes** — grep — OD-27 records live instances in `Privacy.tsx` |
| `standards.stale_claim_rate` | [[knowledge-documentation-charter\|knowledge-documentation]] *(+1)* | Claims that no longer hold | ✅ **yes** — corpus scan |
| `standards.unpinned_claim_count` | [[standards-verification-charter\|standards-verification]] | Numeric claims with no test pinning them | ✅ **yes** — **OD-33 is the canonical instance — 4 values, one `>= 200` assertion** |
| `strategy.citation_drift_rate` | [[positioning-fundraise-readiness-charter\|positioning-fundraise-readiness]] *(+1)* | Citations that no longer support the claim | ✅ **yes** — corpus scan |
| `strategy.claim_overstatement_count` | [[positioning-fundraise-readiness-charter\|positioning-fundraise-readiness]] *(+1)* | Claims stronger than the evidence | ✅ **yes** — corpus scan — OD-37 is a found instance |
| `strategy.claim_to_evidence_coverage` | [[positioning-fundraise-readiness-charter\|positioning-fundraise-readiness]] *(+1)* | Claims with a `file:line` behind them | ✅ **yes** — corpus scan |
| `strategy.diligence_pack_completeness` | [[positioning-fundraise-readiness-charter\|positioning-fundraise-readiness]] *(+1)* | Diligence items with an artifact | ✅ **yes** — read the pack; it does not exist yet |
| `strategy.wedge_metric_instrumentation` | [[positioning-fundraise-readiness-charter\|positioning-fundraise-readiness]] *(+1)* | Whether the wedge metric is instrumented | ✅ **yes** — **the answer is no — NF-A emits nothing** |

### Advisory — 33 metrics (26 yes · 1 blocked · 6 no instrument)

| Metric key | Owning unit | What it measures | Computable today? |
|---|---|---|---|
| `arch.direct_provider_callsites` | [[architecture-review-charter\|architecture-review]] | Call sites bypassing the provider wrapper | ✅ **yes** — grep |
| `arch.diverged_invariant_count` | [[architecture-review-charter\|architecture-review]] | Invariants implemented differently in two places | ✅ **yes** — static comparison |
| `arch.duplicated_invariants` | [[architecture-review-charter\|architecture-review]] | Invariants asserted in more than one layer | ✅ **yes** — static comparison |
| `arch.finding_age_days_max` | [[architecture-review-charter\|architecture-review]] | Age of the oldest open advisory finding | ✅ **yes** — read the `questions.md` set — artifact #8 now exists (OD-41) |
| `arch.findings_closed_by_decision_ratio` | [[architecture-review-charter\|architecture-review]] | Findings closed by a decision vs otherwise | 🔴 **no instrument** — no findings ledger with close reasons exists |
| `arch.findings_closed_by_silence` | [[architecture-review-charter\|architecture-review]] | Findings that lapsed without a decision | 🔴 **no instrument** — same — nothing records how a finding closed |
| `arch.handmade_ddl_objects` | [[architecture-review-charter\|architecture-review]] | Live DB objects no migration created | 🟡 **blocked** — blocked on OD-49 — the schema-parity job has no connection string |
| `arch.layer_bypass_callsites` | [[architecture-review-charter\|architecture-review]] | Call sites skipping an L0–L6 layer | ✅ **yes** — static import scan against the layer stack |
| `arch.layer_violations_open` | [[architecture-review-charter\|architecture-review]] | Open L0–L6 dependency violations | ✅ **yes** — count over `questions.md` |
| `arch.sweeps_since_last_new_finding_class` | [[architecture-review-charter\|architecture-review]] | Sweeps yielding no new class of finding | 🔴 **no instrument** — advisory has run one pass; no sweep log |
| `corpus.contradiction_count` | [[decision-office-charter\|decision-office]] | Documents asserting contradicting facts | ✅ **yes** — corpus scan; several already recorded (ORG_STRUCTURE corrections) |
| `corpus.stale_citation_count` | [[decision-office-charter\|decision-office]] | Citations pointing at moved or deleted anchors | ✅ **yes** — link check over `.planning/` |
| `decisions.close_rate_per_week` | [[decision-office-charter\|decision-office]] | Decisions resolved per week | ✅ **yes** — count the Resolved table in `OPEN-DECISIONS.md` |
| `decisions.decided_here_count` | [[decision-office-charter\|decision-office]] | Decisions the Decision Office itself closed | ✅ **yes** — count over the ADR log |
| `decisions.intake_rate` | [[decision-office-charter\|decision-office]] | New forks raised per week | ✅ **yes** — count the Open table |
| `decisions.intake_returned_count` | [[decision-office-charter\|decision-office]] | Intakes rejected as not decisions | 🔴 **no instrument** — no intake ledger exists |
| `decisions.median_age_days` | [[decision-office-charter\|decision-office]] | Median age of an open decision | ✅ **yes** — the register carries dates |
| `decisions.namespace_collisions` | [[decision-office-charter\|decision-office]] | Fork IDs colliding across namespaces | ✅ **yes** — **measured — 7 namespaces, OD-30/OD-42** |
| `decisions.oldest_age_days` | [[decision-office-charter\|decision-office]] | Age of the oldest open decision | ✅ **yes** — register dates |
| `decisions.open_count` | [[decision-office-charter\|decision-office]] | Open decisions | ✅ **yes** — **measured — 37 open rows, 24 resolved** |
| `decisions.unfiled_fork_count` | [[decision-office-charter\|decision-office]] | Forks raised in prose but never filed | ✅ **yes** — grep for `⬦ FORK` against the register |
| `decisions.unowned_count` | [[decision-office-charter\|decision-office]] | Open decisions with no named unblocker | ✅ **yes** — read the register's fourth column |
| `loops.status_vocabulary_drift` | [[decision-office-charter\|decision-office]] | Loop `status` values outside the closed set | ✅ **yes** — `build_loop_index.py` regenerates the distribution |
| `loops.undefined_close_time_count` | [[decision-office-charter\|decision-office]] | Loops with no `close_time` | ✅ **yes** — same script — currently 0 after OD-47 |
| `rt.finding_actionability` | [[red-team-charter\|red-team]] | Share of Red Team findings that name a next action | ✅ **yes** — read `red-team` output; one pass exists |
| `rt.finding_return_hours` | [[red-team-charter\|red-team]] | Turnaround from target named to finding delivered | 🔴 **no instrument** — no engagement log exists |
| `rt.locked_decision_challenge_rate` | [[red-team-charter\|red-team]] | Share of locked ADRs actually challenged | ✅ **yes** — 8 ADRs; count which carry a Red Team challenge |
| `rt.open_finding_age_days` | [[red-team-charter\|red-team]] | Age of open Red Team findings | ✅ **yes** — count over `questions.md` |
| `rt.reaffirmation_rate` | [[red-team-charter\|red-team]] | Challenged decisions that survived | ✅ **yes** — same source; small n |
| `rt.self_selected_target_share` | [[red-team-charter\|red-team]] | Targets Red Team chose vs was assigned | 🔴 **no instrument** — no engagement log exists |
| `rt.undeclared_decision_count` | [[red-team-charter\|red-team]] | Choices made without being filed as decisions | ✅ **yes** — corpus scan against the register |
| `triggers.dated_unwatched_count` | [[decision-office-charter\|decision-office]] | Dated triggers with no watcher | ✅ **yes** — **measured — 2 dates now watched by `watch_loops.py`** |
| `triggers.fired_but_unactioned_count` | [[decision-office-charter\|decision-office]] | Triggers that fired and nothing happened | ✅ **yes** — the watcher reports to the job summary; first fire is 2026-10-23 |

### Cross-division — 8 metrics claimed by units in more than one division (2 yes · 0 blocked · 6 no instrument)

| Metric key | Units claiming it | What it measures | Computable today? |
|---|---|---|---|
| `identity.false_merge_count` | 3 units across Platform, Research & Math | Distinct products merged into one | ✅ **yes** — `eval_merge_policies.py` exists and runs in CI |
| `nf_a.cost_per_completed_task` | 6 units across Commercial, Corporate, Research & Math | Cost of a task that actually completed | 🔴 **no instrument** — needs both cost attribution and a verdict; has neither |
| `nf_a.cost_per_task` | 8 units across Applied AI, Commercial, Corporate, Platform, Product | Cost of one agent task | 🔴 **no instrument** — `api_spend` has no `agent`/`task_type`; no key joins it to `decision_log` |
| `nf_a.doneability_verdict` | 6 units across Advisory, Corporate, Product | The pass/fail verdict on an agent task | 🔴 **no instrument** — **no doneability verdict exists anywhere in the codebase** |
| `nf_a.doneability_verdict_coverage` | 4 units across Applied AI, Corporate | Tasks carrying a doneability verdict | 🔴 **no instrument** — same — denominator has no numerator |
| `nf_a.emission_coverage` | 3 units across Corporate, Platform | Model call sites emitting an NF-A event | ✅ **yes** — grep — **the answer is 0**; this is the metric that measures the bottleneck |
| `nf_a.task_success_rate` | 8 units across Applied AI, Corporate, Platform, Product | Share of agent tasks that succeeded | 🔴 **no instrument** — `AgentMetrics.success` means 'did not throw', not 'was done' |
| `nf_a.verified_task_success_rate` | 4 units across Corporate, Research & Math | Success rate confirmed against a verdict | 🔴 **no instrument** — no verdict exists to verify against |