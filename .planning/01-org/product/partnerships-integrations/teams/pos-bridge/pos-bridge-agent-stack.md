---
type: agent-stack
division: product
department: partnerships-integrations
team: pos-bridge
status: designed
updated: 2026-08-27
metrics: [pi.merchant_backed_providers, pi.canonical_shape_drift, nf_a.task_success_rate]
links: ["[[pos-bridge-charter]]", "[[pos-bridge-schedule]]", "[[pos-bridge-loops]]", "[[pos-bridge-questions]]", "[[0034-agent-stack-artifact]]", "[[partnerships-integrations-agent-stack]]", "[[connector-platform-trust-agent-stack]]", "[[skills-charter]]", "[[action-safety-the-human-gate-charter]]"]
---

# POS Bridge — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The one unit in this department whose pipeline is **built and proven**, which changes what
> its agents are for: not construction, but keeping a working thing honest. One of the two
> already exists in code as a service — the catalogue matcher — and is carded here for the
> first time. Harness → [[harness-runtime-charter]] (**OD-03 open**), model choice →
> [[model-routing-inference-economics-charter]], the gate →
> [[action-safety-the-human-gate-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `pos-bridge-warden` | Keep four numbers true — registry status vs what actually builds, canonical-shape neutrality, real-venue throughput, and route posture — and touch none of them | NEW |
| `catalogue-match-proposer` | Score a POS item against the wine catalogue, auto-map only at `>= 0.9` **and** unambiguous, queue everything else for a human, and never drop a line | PARTIAL — `catalog-matcher.service.ts:108-177`, queue-never-drop at `:159-167`, human gate at `pos-hub.controller.ts:178, :199` |

Two rows because they are different task shapes: the warden counts, the proposer judges.
Merging them would put a judgment agent in charge of grading its own census.

## 2. Agent cards

```yaml
agent: pos-bridge-warden
unit: pos-bridge
triggers:
  - schedule: "monthly — registry audit + adapter-gate decision"   # [[pos-bridge-schedule]]
  - schedule: "weekly — real-throughput read"
  - topic: pos.types_changed                    # publisher: NONE (gap — only a PR diff on pos-types.ts; the per-PR job is CI's, and that wiring is [[engineering-charter]]'s and unbuilt)
consumes:
  - "pos-provider.registry.ts (27 entries; registrySummary() at :328; capability model :17-25)"
  - "pos_checks — real-venue rows only, excluding SimPOS generic_webhook AND the 66 P3PROOF-* proof rows (POS-BRIDGE-AUDIT.md:622-628)"
  - "pos-types.ts and the 10 routes at ENDPOINTS.md:355-368"
emits:
  - "registry diff and the four counts → [[pos-bridge-agenda-board]]"
  - "pi.merchant_backed_providers, pi.canonical_shape_drift → [[partnerships-integrations-agent-stack|pi-bridge-board]]"
  - "findings → [[pos-bridge-questions]]"
  - "nf_a events (task_type: pos_registry_audit)"
routing_class: mechanical      # grep, count, diff — no judgment call in the loop
quality_bar: "the census is reproducible: a rerun on the same commit yields the same four counts, and any provider whose scaffolded claim no longer builds is demoted in the same run; NONE (gap) — ADR 0017 has no grader for audits"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant
memory: pos-bridge
escalates_to: "[[partnerships-integrations-charter]]"
```

**The warden's hard rule:** it never edits an adapter or the registry — a demotion is a
proposal in a PR. A warden that fixes what it counts cannot report the count honestly.

```yaml
agent: catalogue-match-proposer
unit: pos-bridge
triggers:
  - topic: pos.catalog_pulled                  # publisher: pullPosCatalog() — but it throws for any source other than 'simpos' (catalog-matcher.service.ts:187-191), so for every real provider this is a gap
  - topic: pos.line_unresolved                 # publisher: pos-hub.service.ts:341-367 (writes pos_unresolved_lines)
consumes:
  - "simpos_catalog (the only catalogue that can be pulled today)"
  - "the restaurant's inventory catalogue"
  - "pos_unresolved_lines"
emits:
  - "pos_catalog_match_proposals → consumed by the human gate (pos-hub.controller.ts:178, :199)"
  - "pos_item_mappings on auto-map → consumed by loadItemMappings (pos-hub.service.ts:247)"
  - "nf_a events (task_type: pos_catalog_match_proposal) — one per proposal, the human's approve/reject arriving as a sidecar verdict (ADR 0017)"
routing_class: judgment        # a fuzzy string against a catalogue, with a confidence and a threshold
quality_bar: "nf_a.task_success_rate = approve vs reject at the human gate, read against dwell time so a rubber-stamp is visible; NONE (gap) — the gate has never graded a real venue's proposal"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant
memory: pos-bridge
escalates_to: "[[partnerships-integrations-charter]]"
```

**Named for the gate's owner, not decided here.** The `>= 0.9` auto-map writes
`pos_item_mappings`, which `applyStockEffects` later reads to move stock
(`pos-hub.service.ts:371`) — the one write by this unit's agents that reaches inventory with
no human in the loop. Whether that counts as a stock mutation under FUTURES §8.1 is
[[action-safety-the-human-gate-charter]]'s call. Flagged, not answered.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `pos-registry-audit` | T2 | Monthly, or any provider status change | Every provider's status reconciled against what builds and connects; unsupported `scaffolded` demoted; the count reported | 2026-08-24: found **27** providers where `foundation/teams/product.md:658` claims 30 ([[pos-bridge-charter]] §Evidence) | NEW |
| `pos-adapter-scaffold` | T1 | A named venue is waiting on a provider with no normalizer | Normalizer + spec exist, capabilities assigned, registry entry moved to `scaffolded`, the `generic_webhook` contract unbroken | Executed twice already, in code: Square (`pos-provider.registry.ts:71, :76`) and Clover (`:83, :88`) were both scaffolded this way — the procedure exists in the repo, just not as a written skill | NEW |

Consumed, owned elsewhere: `ingress-route-audit` and `connector-trust-contract`
([[connector-platform-trust-schedule]]) cover the 10 `pos-hub` routes; envelope →
[[skills-charter]].

**Two rows deleted rather than kept.** [[pos-bridge-schedule]] proposes
`canonical-shape-review` and `match-gate-review`, both labelled *"Not yet fired"*. No past
instance, so no row. The audit's `voided` finding (`POS-BRIDGE-AUDIT.md:589-612`) does
**not** rescue the first: that was shape-vs-persistence, not the two-provider neutrality
rule the skill defines.

## 4. Memory

- **Procedural** — the §3 skills; candidates go to [[skill-harvesting-charter]]'s queue and
  still face §3.3.
- **Episodic** — nf_a `task_type: pos_registry_audit` and `pos_catalog_match_proposal`. The
  proposer's family needs `context.confidence`, `context.provider` and `context.auto_mapped`
  as jsonb keys, or the question worth asking — *does accuracy fall off below the 0.9
  threshold?* — becomes a join nobody can write. **`pos-hub` emits no nf_a today** (§6).
- **Semantic** — `memory/` beside this file, index `pos-bridge-MEMORY.md`. Three founding
  facts already exist and would be its first files: *27 providers, not 30* (2026-08-24 grep);
  *the pipeline is proven — 1.4% → 67.4%* (`POS-BRIDGE-AUDIT.md:535`); *the 92 production
  mappings were orphans with `sale_unit = null`, now deleted and refused by an FK*
  ([[0030-pos-mapping-inventory-integrity]]). Provenance frontmatter per ADR 0034; every
  write is a PR.
- **Working** — the card, the MEMORY index, charter §Mandate and §Metrics. The registry, the
  644-line audit and `pos-hub.service.ts` are retrieval targets by `path:line` (CLAUDE.md §2).

**Consolidation** — monthly: diff this month's census against last month's facts; a provider
that changed status, or a canonical field that gained or lost a second populating provider,
becomes a fact naming the mechanism. **Failures first:** every rejected proposal becomes a
fact about *why* the proposer was wrong — a threshold, a tokenizer, a provider's naming
convention — never "accuracy dipped". Expire facts unverified 90 days. One PR; "no delta"
stated when true.

## 5. Async contract

Loops ([[pos-bridge-loops]] — `pos-registry-truth`, `pos-canonical-neutrality`,
`pos-catalog-match-gate`, `pos-hub-route-posture`, `pos-real-throughput`), nf_a events,
vault PRs, skill candidates. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `pos_unresolved_lines` has a publisher and no consumer | A non-wine line is skipped entirely at `pos-hub.service.ts:329` and **nobody is ever asked about it** (`POS-BRIDGE-AUDIT.md:310-322`). The proof run parked 39 lines there and no loop reads them — the `core/orchestrator.py:198-206` failure with the arrows reversed |
| `pos.catalog_pulled` cannot fire for a real provider | `pullPosCatalog()` throws for anything but `'simpos'` (`catalog-matcher.service.ts:187-191`), so at a real venue the proposer has no input and mapping is item-by-item through `POST /pos-hub/mappings/:restaurantId` |
| No pull path exists at all | 13 of 27 providers declare `webhooks: false`, no `@Cron` calls a POS, no cursor is stored (POS-Q4). Blocked on **OD-A**, which stays open — this card presupposes no outcome |
| `pos_checks.correlation_id` is never set | POS rows cannot join the correlation-id timeline (`POS-BRIDGE-AUDIT.md:614-620`), so an nf_a event and the check that caused it cannot be tied together |
| The weekly throughput read excludes the wrong set | [[pos-bridge-schedule]] says "excluding SimPOS-sourced `generic_webhook`". Since 2026-08-24 it must also exclude the 66 `P3PROOF-*` rows left in production deliberately (`POS-BRIDGE-AUDIT.md:622-628`), or the metric reads 66 and means 0 |

## 6. Evidence today

- **EXISTS — the pipeline, proven end to end (2026-08-24).** 66 signed canonical checks
  driven through the live webhook into production moved satisfiable insight types from
  **8 (1.4%) to 386 (67.4%)** (`.planning/04-specs/POS-BRIDGE-AUDIT.md:535`); idempotency held
  on replay and the signature gate rejected all five negative cases with zero rows written
  (`:558-568`); three defects were fixed and proven by 14 regression tests that **failed
  against the pre-fix code and pass after** (`:589-612`). Referential integrity is now
  enforced in the database ([[0030-pos-mapping-inventory-integrity]],
  [[0015-pos-referential-integrity]], [[0011-pos-sale-volume-contract]]).
- **EXISTS — the module.** 10 files, 27 providers, per-provider capability model
  (`pos-provider.registry.ts:17-25`), 10 endpoints behind a class-level `JwtAuthGuard`
  (`pos-hub.controller.ts:36`), the simulator at `apps/api-gateway/src/simpos/`.
- **PARTIAL — `catalogue-match-proposer`.** Service and gate exist; it can pull only SimPOS's
  catalogue (`catalog-matcher.service.ts:187-191`), a no-candidate proposal can only be
  rejected (`:417-418`), and it is wine-only by literal (`:141`, `:424`). Never graded a real
  venue's item.
- **NEW — everything agent-shaped:** `pos-bridge-warden`, both skills as skills, every nf_a
  emission, the `memory/` layer. The governing number is unchanged —
  **`pi.merchant_backed_providers` = 0.** Proven capability, zero throughput.
