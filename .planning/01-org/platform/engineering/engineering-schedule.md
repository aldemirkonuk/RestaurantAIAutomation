---
type: schedule
division: platform
department: engineering
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[engineering-charter]]", "[[engineering-loops]]", "[[engineering-agenda-board]]", "[[schema-migrations-schedule]]", "[[platform-api-schedule]]", "[[client-surfaces-schedule]]"]
---

# Engineering — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per PR | CI guard set — `scripts/check_no_direct_stock_writes.sh`, `scripts/check_no_guest_name_matching.sh`, `scripts/check_beverage_identity_parity.py`, `scripts/check_display_name_parity.py` (wired in `.github/workflows/ci.yml`) | Pass/fail per invariant |
| Per PR | Schema parity — `scripts/check_schema_parity.sh` via `.github/workflows/schema-parity.yml` (run by `[[state-integrity-invariants-charter|sre-state-integrity]]`, authored against [[schema-migrations-charter]]) | Drift diff; resets `schema.days_since_hand_applied_ddl` on red |
| Daily | Projection divergence sample — rows where `stock_live` ≠ sum of lots | `inventory.projection_divergence_rows` |
| Daily | Public-route census — reachable routes with no guard, and `@Public()` count | `platform.unguarded_reachable_routes`, `platform.public_decorator_count` |
| Weekly | The eight-wrongness board — L-ENG-1 | [[engineering-agenda-board]] refresh |
| Weekly | Seam arbitration — L-ENG-2 | Assignments or `OPEN-DECISIONS.md` entries |
| Weekly | Public-surface exposure — L-ENG-5 | Two-number report to [[security-charter]] |
| Monthly | Guard/outcome reconciliation — L-ENG-3 | List of grep-guards with no outcome twin |
| Monthly | Irreversible-class review — L-ENG-4 | Every merge, migration, and mass-send reviewed |
| Quarterly | Charter staleness sweep — anything untouched 60+ days is finished or fiction (foundation §3.3, §6) | Archive or revision |
| Quarterly | Team-shape review against OD-19 / OD-20 / OD-23 | Recommendation to [[decision-office-charter]] |

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion — the anti-sprawl rule applies here exactly as it does to agendas.

Engineering's skill surface is **proposed, not built**. Candidates, each tied to a
recurring job above rather than invented for coverage:

| Proposed skill | Fires on | Owning team |
|---|---|---|
| `endpoint-guard-census` | Daily public-route census | [[platform-api-charter]] |
| `projection-divergence-sample` | Daily stock reconciliation | [[inventory-ledger-charter]] |
| `migration-authoring` | New DDL — enforces repo-as-source-of-truth | [[schema-migrations-charter]] |
| `merge-safety-review` | Any identity merge against the labelled set | [[catalogue-identity-charter]] |
| `route-reachability-audit` | Weekly orphan-route check | [[client-surfaces-charter]] |
| `webhook-signature-audit` | Public-route signature coverage | [[integration-engineering-charter]] |

**Nothing in this table exists yet.** It is listed so that a skill is created against a
scheduled job with a close-time, rather than a skill being created and a job invented to
justify it. Ownership of the registry itself sits with [[skills-charter]] (Applied AI
division), not here — Engineering authors skills, it does not govern the registry.
