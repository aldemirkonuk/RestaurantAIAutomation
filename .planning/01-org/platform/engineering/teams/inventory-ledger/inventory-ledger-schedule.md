---
type: schedule
division: platform
department: engineering
team: inventory-ledger
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[inventory-ledger-charter]]", "[[inventory-ledger-loops]]", "[[engineering-schedule]]", "[[sre-state-integrity]]", "[[skills-charter]]"]
---

# Inventory & Ledger — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per PR | `scripts/check_no_direct_stock_writes.sh` via `.github/workflows/ci.yml` — run by [[sre-state-integrity]] | Direct-write guard pass/fail (**syntax only**; `:10` says so) |
| **Daily** | Projection divergence sample — L-IL-1 | `inventory.projection_divergence_rows`; non-zero opens a P1 |
| Daily | Alarm-state check: green CI ∧ non-zero divergence | Immediate escalation to [[engineering-loops]] L-ENG-3 |
| Weekly | Guard/outcome reconciliation — L-IL-2 | Guard coverage gaps, notably `supabase/migrations/**` function bodies |
| Weekly | Count adjustment provenance — L-IL-5 | Adjustments with no matching movement row |
| Weekly | Cross-hop duplication scan — L-IL-4 | Duplicate movements per originating event |
| Fortnightly | Ledger v1 caller census — L-IL-3 | Distinct v1 callers; new call sites escalate |
| Monthly | Scenario re-walk against `.planning/INVENTORY_ADD_REMOVE_SCENARIOS.md` | Divergence-definition drift between scenarios and sampler |
| Quarterly | `.planning/INVENTORY_SOTA_PLAN.md` phase-gate review (3 gated phases, 13 locked decisions) | Phase advance or explicit hold |

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**None built yet.** Proposed, each tied to a scheduled job above:

| Proposed skill | Fires on | Why a skill rather than a script |
|---|---|---|
| `projection-divergence-sample` | Daily | The query is trivial; the judgement is triaging *which* divergence and whether it is the same cause as yesterday |
| `stock-write-path-audit` | PR touching stock tables or SQL functions | Must reason about dynamic table names and function bodies — precisely the cases a grep cannot handle |
| `movement-provenance-trace` | A divergence, or a suspected duplicate | Walks POS event → bridge → movement → projection and names the hop that lost or duplicated |

**Constraint on all three:** a skill may **read** stock and may **propose** a
reconciliation, but may never write stock outside `apply_stock_movement`. There is no
carve-out for automated reconciliation — an agent writing directly is premortem M5 with
better tooling.

Registry governance sits with [[skills-charter]] (Applied AI); this team authors and
retires its own skills within that registry.
