---
name: FORK-REGISTRY
type: registry
updated: 2026-08-24
owner: decision-office
supersedes: >-
  The 13 in-document "⚠️ ID collision, flagged not resolved" notices that each
  division carried separately (ai-orchestration, agent-evaluation-gates ×5,
  research-math ×2, evaluation-doneability, architecture-review ×3, product-vision ×4,
  design ×3, ux-path-burn-down). Those are merged into this one file, per the
  retire-to-write rule (CLAUDE.md §4).
---

# Fork Registry — the authoritative map of every locally-minted fork ID

> **What this is.** [`OPEN-DECISIONS.md`](../../decisions/OPEN-DECISIONS.md) is the
> canonical register and its `OD-nn` IDs are the only `OD-` IDs that exist. This file
> maps every *locally minted* fork ID — the ones parallel generator agents created
> against their own counters — to a non-colliding namespaced ID, and lists the
> documents that cite it.
>
> **Rule now in force:** a session that mints a fork ID **must not** use the `OD-`
> prefix. Use its division's `<DIV>-Fn` namespace, add the row here, and (if the fork
> is the founder's) propose it under §5 rather than editing the register directly.

Closes [OD-30](../../decisions/OPEN-DECISIONS.md) and [OD-42](../../decisions/OPEN-DECISIONS.md).

---

## 1. The collision that was measured

Seven namespaces were in use. Six IDs carried more than one meaning:

| ID | Canonical meaning (register) | Second meaning (Technology) | Third meaning (Product) |
|---|---|---|---|
| `OD-19` | 94 endpoints unguarded by omission | 25 teams for one division | — |
| `OD-20` | 🔴 Analytics consultant endpoints unauthenticated | Engineering at 8 teams | Product division team layer |
| `OD-21` | Obsidian structural workflow (locked) | The evaluation seam | Vendor Finder boundary |
| `OD-22` | Tooling & reference library | Skills at 3 vs 2 | Guest monetization ownership |
| `OD-23` | Revenue target and pricing unverified | 7-artifact anatomy for teams | Connector trust boundary |
| `OD-24` | Skills self-retirement trigger | Guardian-agent co-ownership | Design's commissioning authority |

Plus three namespaces that did not collide with the register but were confusable or
ambiguous: `OD-Cn` (Corporate — reads as an `OD-` register ID), `F-n` (Intelligence —
ambiguous against Commercial's `CM-Fn`), and `CM-Fn` (Commercial — the only one that
worked).

**Hard rule applied throughout: no cited canonical `OD-nn` was reassigned.** Every
rewrite below moved a *local* fork off a canonical ID; not one canonical ID changed
meaning.

---

## 2. Reconciliation table

### Technology division → `TECH-Fn`

Defined at `foundation/teams/technology.md` §7 (lines 843–848).

| Old ID | New ID | Meaning |
|---|---|---|
| `OD-19` *(local)* | **`TECH-F1`** | **25 teams for one division.** Is the team layer chartered at this granularity, or only for departments whose scope demonstrably exceeds one owner (Engineering, Data)? |
| `OD-20` *(local)* | **`TECH-F2`** | **Engineering at 8.** Are Schema & Migrations and Messaging & Delivery teams, or functions inside Platform & API? |
| `OD-21` *(local)* | **`TECH-F3`** | **The evaluation seam.** Does `aio-evaluation-gates` (operations) coexist with Research & Math (methodology), or is it one team? |
| `OD-22` *(local)* | **`TECH-F4`** | **Skills at 3 vs 2.** `skl-harvesting` carries an entry trigger — chartered now with the trigger, or not chartered until it fires? |
| `OD-23` *(local)* | **`TECH-F5`** | **Does the team layer get the 7-artifact anatomy?** Proposal: teams get 3 (charter · premortem · loops), not 7. ≈175 documents ride on it. |
| `OD-24` *(local)* | **`TECH-F6`** | **Guardian-agent co-ownership.** Agent Fleet owns the code, SRE owns the findings. Workable, or does one team own guardians end to end? |

### Product division → `PROD-Fn`

Defined at `foundation/teams/product.md` §6 (lines 858–862).

| Old ID | New ID | Meaning |
|---|---|---|
| `OD-20` *(local)* | **`PROD-F1`** | **Product division team layer** — 17 teams as proposed, or the reduced set in §5.3? |
| `OD-21` *(local)* | **`PROD-F2`** | **Vendor Finder boundary** — does supply discovery sit in Product & Vision or merge into Partnerships? Carries a dated day-90 dissolution trigger. |
| `OD-22` *(local)* | **`PROD-F3`** | **Guest monetization ownership** — advertising + photo-as-promotion in Guest Experience, or in Commercial? |
| `OD-23` *(local)* | **`PROD-F4`** | **Connector trust boundary** — does Partnerships own the per-connector trust contract while Engineering owns runtime, or is verification wholly Security's? |
| `OD-24` *(local)* | **`PROD-F5`** | **Design's commissioning authority** — can `ux-path-burn-down` commission the endpoints its deferred paths are blocked on, or only report *blocked*? |

### Intelligence division → `INTEL-Fn`

`F-1`–`F-5` defined at `foundation/teams/intelligence.md` §6 (lines 517–521);
`F-6`/`F-7` minted later in `01-org/intelligence/analytics-bi/analytics-bi-charter.md`.

| Old ID | New ID | Meaning |
|---|---|---|
| `F-1` | **`INTEL-F1`** | **OD-19's denominator is wrong** — "~86" vs a per-module sum of 103. *(Reported resolved at 94 in `security-charter.md:116`.)* |
| `F-2` | **`INTEL-F2`** | **`vendor-portal` is misclassified** as a webhook module. Does OD-19 classify **per route** rather than per module? |
| `F-3` | **`INTEL-F3`** | **NF has no `subject_type` for the restaurant operator.** Add `operator`, or route it outside NF? Interacts with OD-11. |
| `F-4` | **`INTEL-F4`** | **Do SEC-1 and SEC-2 start merged?** One team with two charters until the endpoint campaign ships. |
| `F-5` | **`INTEL-F5`** | **Are the seven raw-HTTP NestJS callsites in scope for OD-03?** Decides whether OD-03 governs a majority or a minority of model calls. |
| `F-6` | **`INTEL-F6`** | **Which insight-type count is canonical**, and what test pins it? *(Same question as canonical OD-33 — file once.)* |
| `F-7` | **`INTEL-F7`** | Is `ANALYTICS_FEATURE_CATALOG.md` a planning document or a record of what exists? |

### Corporate division → `CORP-Fn`

`OD-C1`–`OD-C5` defined at `foundation/teams/corporate.md` §7 (lines 494–498);
`OD-C6`–`OD-C8` minted later in
`01-org/corporate/knowledge-documentation/knowledge-documentation-agenda-full.md:115-117`.

| Old ID | New ID | Meaning |
|---|---|---|
| `OD-C1` | **`CORP-F1`** | **Does a *team* get the 7-artifact anatomy, or only a department?** *(Same question as `TECH-F5` — file once.)* |
| `OD-C2` | **`CORP-F2`** | **DPA/BAA ownership split** — Legal owns the instrument, Compliance owns the obligations. Confirm, or give one team both? |
| `OD-C3` | **`CORP-F3`** | **Strategy stays one team until a term sheet.** Confirm the trigger, or split now? |
| `OD-C4` | **`CORP-F4`** | **Is Regulated Operations (alcohol/excise) Corporate's at all**, or Product's once a licensing feature exists? |
| `OD-C5` | **`CORP-F5`** | **Does `SpendLogger.log()` gain an `agent` parameter?** Without it, NF-A's "cost per task" is not derivable. Belongs with OD-11. |
| `OD-C6` | **`CORP-F6`** | Does `standards-verification` belong to Knowledge & Documentation or to the Decision Office? *(Decision Office has declined it in writing.)* |
| `OD-C7` | **`CORP-F7`** | Does `.claude/skills/` get created (and `.agents/skills/` migrated), or do the ~99 `schedule.md` assertions get corrected? *(Half-closed by a side effect: the directory now exists with zero `SKILL.md`.)* |
| `OD-C8` | **`CORP-F8`** | Is **retire-to-write** department-only or org-wide? *(Answered — adopted org-wide as canonical OD-34.)* |

### Commercial division → `CM-Fn` — **unchanged**

`CM-F1`–`CM-F6` (`foundation/teams/commercial.md` §6, lines 629–634) never collided.
Commercial's convention is the one this registry generalises org-wide.

### Advisory-raised findings — **unchanged**

Already namespaced and not colliding; kept verbatim.

| Namespace | Source | Items |
|---|---|---|
| `AR-n` | `02-advisory/architecture-review/` | `AR-0` … `AR-6` |
| `RT-Fn` | `02-advisory/red-team/red-team-agenda-full.md:296-301` | `RT-F1` … `RT-F6` |
| `DO-n` | `02-advisory/decision-office/decision-office-questions.md:22` | `DO-1` |

### Not a fork — **unchanged**

`DEP-06` is a **deployment-requirement id** (75 citations across 39 files), not a fork.
It is left exactly as it is and must not be pulled into any fork namespace.

---

## 3. What was deliberately **not** rewritten

Three classes of citation were left verbatim, on purpose:

1. **Canonical `OD-nn` references that genuinely mean the register item.** The largest
   groups: `OD-19` throughout `01-org/intelligence/security/` and
   `01-org/product/partnerships-integrations/` (endpoint classification); `OD-20`
   throughout `01-org/intelligence/analytics-bi/` and `01-org/research-math/` (the
   unauthenticated analytics spend); `OD-21` throughout
   `01-org/corporate/knowledge-documentation/` (Obsidian workflow); `OD-22` in the same
   department (tooling library); `OD-23` throughout
   `01-org/corporate/strategy-fundraising/` and `01-org/commercial/finance-pricing/`
   (the revenue target); `OD-24` in `02-advisory/red-team/` (Skills self-retirement).

2. **Dated census passages in `02-advisory/red-team/` and
   `02-advisory/decision-office/`** that *measure* the pre-reconciliation state —
   "seven namespaces", "`OD-C1`–`OD-C8` never reached the register", "`OD-20…24` carry
   three meanings each", the per-ID citation-count table. Rewriting a measurement
   falsifies it. These read as history; this registry is the current state.

3. **`DEP-06`**, per above.

Every *live* citation — one a reader would follow in order to act on the fork — was
rewritten. Where a document asserted *"this fork has no usable ID"*, the assertion was
corrected rather than the token swapped, because that assertion is no longer true.

---

## 4. Citation index

Generated 2026-08-24 by scanning `01-org/`, `02-advisory/`, `03-scenarios/`, and
`foundation/teams/`. Paths are relative to `.planning/`.

<!-- CITATION-INDEX-START -->

### TECH-Fn — Technology division (`foundation/teams/technology.md` §7)

**`TECH-F1`** — 12 citations in 11 files

- `01-org/applied-ai/ai-orchestration/ai-orchestration-agenda-board.md`
- `01-org/applied-ai/ai-orchestration/ai-orchestration-agenda-full.md`
- `01-org/platform/data/data-agenda-board.md`
- `01-org/platform/data/data-charter.md`
- `01-org/platform/engineering/engineering-agenda-full.md`
- `01-org/platform/engineering/engineering-charter.md`
- `01-org/platform/engineering/engineering-directive.md`
- `01-org/platform/engineering/engineering-schedule.md`
- `01-org/platform/reliability-sre/reliability-sre-agenda-board.md`
- `01-org/platform/reliability-sre/reliability-sre-charter.md`
- `foundation/teams/technology.md`

**`TECH-F2`** — 13 citations in 11 files

- `01-org/platform/engineering/engineering-agenda-full.md`
- `01-org/platform/engineering/engineering-charter.md`
- `01-org/platform/engineering/engineering-directive.md`
- `01-org/platform/engineering/engineering-schedule.md`
- `01-org/platform/engineering/teams/messaging-delivery/messaging-delivery-agenda-board.md`
- `01-org/platform/engineering/teams/messaging-delivery/messaging-delivery-agenda-full.md`
- `01-org/platform/engineering/teams/messaging-delivery/messaging-delivery-charter.md`
- `01-org/platform/engineering/teams/platform-api/platform-api-agenda-full.md`
- `01-org/platform/engineering/teams/schema-migrations/schema-migrations-agenda-full.md`
- `01-org/platform/engineering/teams/schema-migrations/schema-migrations-charter.md`
- `foundation/teams/technology.md`

**`TECH-F3`** — 26 citations in 17 files

- `01-org/applied-ai/ai-orchestration/ai-orchestration-agenda-board.md`
- `01-org/applied-ai/ai-orchestration/ai-orchestration-agenda-full.md`
- `01-org/applied-ai/ai-orchestration/ai-orchestration-charter.md`
- `01-org/applied-ai/ai-orchestration/teams/agent-evaluation-gates/agent-evaluation-gates-agenda-board.md`
- `01-org/applied-ai/ai-orchestration/teams/agent-evaluation-gates/agent-evaluation-gates-agenda-full.md`
- `01-org/applied-ai/ai-orchestration/teams/agent-evaluation-gates/agent-evaluation-gates-charter.md`
- `01-org/applied-ai/ai-orchestration/teams/agent-evaluation-gates/agent-evaluation-gates-directive.md`
- `01-org/applied-ai/ai-orchestration/teams/agent-evaluation-gates/agent-evaluation-gates-loops.md`
- `01-org/applied-ai/ai-orchestration/teams/agent-evaluation-gates/agent-evaluation-gates-premortem.md`
- `01-org/research-math/research-math-agenda-board.md`
- `01-org/research-math/research-math-charter.md`
- `01-org/research-math/research-math-loops.md`
- `01-org/research-math/teams/evaluation-doneability/evaluation-doneability-charter.md`
- `02-advisory/architecture-review/architecture-review-agenda-board.md`
- `02-advisory/architecture-review/architecture-review-agenda-full.md`
- `02-advisory/architecture-review/architecture-review-charter.md`
- `foundation/teams/technology.md`

**`TECH-F4`** — 16 citations in 12 files

- `01-org/applied-ai/skills/skills-agenda-board.md`
- `01-org/applied-ai/skills/skills-agenda-full.md`
- `01-org/applied-ai/skills/skills-charter.md`
- `01-org/applied-ai/skills/skills-directive.md`
- `01-org/applied-ai/skills/skills-premortem.md`
- `01-org/applied-ai/skills/teams/skill-harvesting/skill-harvesting-agenda-board.md`
- `01-org/applied-ai/skills/teams/skill-harvesting/skill-harvesting-agenda-full.md`
- `01-org/applied-ai/skills/teams/skill-harvesting/skill-harvesting-charter.md`
- `01-org/applied-ai/skills/teams/skill-harvesting/skill-harvesting-directive.md`
- `01-org/applied-ai/skills/teams/skill-harvesting/skill-harvesting-loops.md`
- `01-org/applied-ai/skills/teams/skill-harvesting/skill-harvesting-premortem.md`
- `foundation/teams/technology.md`

**`TECH-F5`** — 15 citations in 13 files

- `01-org/applied-ai/ai-orchestration/ai-orchestration-agenda-board.md`
- `01-org/applied-ai/ai-orchestration/ai-orchestration-charter.md`
- `01-org/corporate/people-agent-ops/people-agent-ops-charter.md`
- `01-org/platform/data/data-agenda-board.md`
- `01-org/platform/data/data-agenda-full.md`
- `01-org/platform/data/data-charter.md`
- `01-org/platform/engineering/engineering-agenda-full.md`
- `01-org/platform/engineering/engineering-charter.md`
- `01-org/platform/engineering/engineering-directive.md`
- `01-org/platform/engineering/engineering-schedule.md`
- `01-org/platform/reliability-sre/reliability-sre-agenda-board.md`
- `01-org/platform/reliability-sre/reliability-sre-charter.md`
- `foundation/teams/technology.md`

**`TECH-F6`** — 37 citations in 21 files

- `01-org/applied-ai/ai-orchestration/ai-orchestration-agenda-board.md`
- `01-org/applied-ai/ai-orchestration/ai-orchestration-charter.md`
- `01-org/applied-ai/ai-orchestration/ai-orchestration-directive.md`
- `01-org/applied-ai/ai-orchestration/ai-orchestration-loops.md`
- `01-org/applied-ai/ai-orchestration/ai-orchestration-schedule.md`
- `01-org/applied-ai/ai-orchestration/teams/agent-fleet/agent-fleet-agenda-board.md`
- `01-org/applied-ai/ai-orchestration/teams/agent-fleet/agent-fleet-agenda-full.md`
- `01-org/applied-ai/ai-orchestration/teams/agent-fleet/agent-fleet-charter.md`
- `01-org/applied-ai/ai-orchestration/teams/agent-fleet/agent-fleet-directive.md`
- `01-org/applied-ai/ai-orchestration/teams/agent-fleet/agent-fleet-loops.md`
- `01-org/applied-ai/ai-orchestration/teams/agent-fleet/agent-fleet-premortem.md`
- `01-org/applied-ai/ai-orchestration/teams/agent-fleet/agent-fleet-schedule.md`
- `01-org/platform/reliability-sre/reliability-sre-agenda-board.md`
- `01-org/platform/reliability-sre/reliability-sre-agenda-full.md`
- `01-org/platform/reliability-sre/reliability-sre-charter.md`
- `01-org/platform/reliability-sre/teams/state-integrity-invariants/state-integrity-invariants-agenda-board.md`
- `01-org/platform/reliability-sre/teams/state-integrity-invariants/state-integrity-invariants-agenda-full.md`
- `01-org/platform/reliability-sre/teams/state-integrity-invariants/state-integrity-invariants-charter.md`
- `01-org/platform/reliability-sre/teams/state-integrity-invariants/state-integrity-invariants-directive.md`
- `01-org/platform/reliability-sre/teams/state-integrity-invariants/state-integrity-invariants-premortem.md`
- `foundation/teams/technology.md`

### PROD-Fn — Product division (`foundation/teams/product.md` §6)

**`PROD-F1`** — 11 citations in 9 files

- `01-org/product/design/design-agenda-board.md`
- `01-org/product/design/design-agenda-full.md`
- `01-org/product/design/design-charter.md`
- `01-org/product/guest-experience/guest-experience-charter.md`
- `01-org/product/product-vision/product-vision-agenda-full.md`
- `01-org/product/product-vision/product-vision-charter.md`
- `01-org/product/product-vision/product-vision-directive.md`
- `01-org/product/product-vision/product-vision-premortem.md`
- `foundation/teams/product.md`

**`PROD-F2`** — 35 citations in 18 files

- `01-org/product/partnerships-integrations/partnerships-integrations-agenda-board.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-charter.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-directive.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-loops.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-premortem.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-schedule.md`
- `01-org/product/partnerships-integrations/teams/supplier-distributor-network/supplier-distributor-network-agenda-board.md`
- `01-org/product/partnerships-integrations/teams/supplier-distributor-network/supplier-distributor-network-agenda-full.md`
- `01-org/product/partnerships-integrations/teams/supplier-distributor-network/supplier-distributor-network-charter.md`
- `01-org/product/partnerships-integrations/teams/supplier-distributor-network/supplier-distributor-network-directive.md`
- `01-org/product/partnerships-integrations/teams/supplier-distributor-network/supplier-distributor-network-loops.md`
- `01-org/product/partnerships-integrations/teams/supplier-distributor-network/supplier-distributor-network-premortem.md`
- `01-org/product/partnerships-integrations/teams/supplier-distributor-network/supplier-distributor-network-schedule.md`
- `01-org/product/product-vision/product-vision-charter.md`
- `02-advisory/decision-office/decision-office-agenda-board.md`
- `02-advisory/decision-office/decision-office-charter.md`
- `02-advisory/decision-office/decision-office-loops.md`
- `foundation/teams/product.md`

**`PROD-F3`** — 14 citations in 8 files

- `01-org/product/guest-experience/guest-experience-agenda-board.md`
- `01-org/product/guest-experience/guest-experience-agenda-full.md`
- `01-org/product/guest-experience/guest-experience-charter.md`
- `01-org/product/guest-experience/teams/guest-value-monetization/guest-value-monetization-agenda-board.md`
- `01-org/product/guest-experience/teams/guest-value-monetization/guest-value-monetization-agenda-full.md`
- `01-org/product/guest-experience/teams/guest-value-monetization/guest-value-monetization-charter.md`
- `01-org/product/guest-experience/teams/guest-value-monetization/guest-value-monetization-directive.md`
- `foundation/teams/product.md`

**`PROD-F4`** — 13 citations in 10 files

- `01-org/product/partnerships-integrations/partnerships-integrations-agenda-board.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-agenda-full.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-charter.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-schedule.md`
- `01-org/product/partnerships-integrations/teams/connector-platform-trust/connector-platform-trust-agenda-board.md`
- `01-org/product/partnerships-integrations/teams/connector-platform-trust/connector-platform-trust-agenda-full.md`
- `01-org/product/partnerships-integrations/teams/connector-platform-trust/connector-platform-trust-charter.md`
- `01-org/product/partnerships-integrations/teams/connector-platform-trust/connector-platform-trust-directive.md`
- `01-org/product/partnerships-integrations/teams/connector-platform-trust/connector-platform-trust-premortem.md`
- `foundation/teams/product.md`

**`PROD-F5`** — 11 citations in 9 files

- `01-org/product/design/design-agenda-board.md`
- `01-org/product/design/design-agenda-full.md`
- `01-org/product/design/design-charter.md`
- `01-org/product/design/teams/ux-path-burn-down/ux-path-burn-down-charter.md`
- `01-org/product/product-vision/product-vision-agenda-full.md`
- `01-org/product/product-vision/product-vision-charter.md`
- `01-org/product/product-vision/product-vision-directive.md`
- `01-org/product/product-vision/product-vision-premortem.md`
- `foundation/teams/product.md`

### INTEL-Fn — Intelligence division (`foundation/teams/intelligence.md` §6 + Analytics & BI)

**`INTEL-F1`** — 2 citations in 2 files

- `01-org/intelligence/security/security-charter.md`
- `foundation/teams/intelligence.md`

**`INTEL-F2`** — 3 citations in 2 files

- `01-org/intelligence/security/security-charter.md`
- `foundation/teams/intelligence.md`

**`INTEL-F3`** — 41 citations in 25 files

- `01-org/intelligence/analytics-bi/analytics-bi-agenda-board.md`
- `01-org/intelligence/analytics-bi/analytics-bi-agenda-full.md`
- `01-org/intelligence/analytics-bi/analytics-bi-charter.md`
- `01-org/intelligence/analytics-bi/analytics-bi-directive.md`
- `01-org/intelligence/analytics-bi/analytics-bi-loops.md`
- `01-org/intelligence/analytics-bi/teams/insight-narrative-generation/insight-narrative-generation-agenda-board.md`
- `01-org/intelligence/analytics-bi/teams/insight-narrative-generation/insight-narrative-generation-agenda-full.md`
- `01-org/intelligence/analytics-bi/teams/insight-narrative-generation/insight-narrative-generation-charter.md`
- `01-org/intelligence/analytics-bi/teams/insight-narrative-generation/insight-narrative-generation-directive.md`
- `01-org/intelligence/analytics-bi/teams/insight-narrative-generation/insight-narrative-generation-loops.md`
- `01-org/intelligence/analytics-bi/teams/insight-narrative-generation/insight-narrative-generation-premortem.md`
- `01-org/research-math/research-math-agenda-board.md`
- `01-org/research-math/research-math-agenda-full.md`
- `01-org/research-math/research-math-charter.md`
- `01-org/research-math/research-math-loops.md`
- `01-org/research-math/research-math-premortem.md`
- `01-org/research-math/research-math-schedule.md`
- `01-org/research-math/teams/neural-footprint-instrumentation/neural-footprint-instrumentation-agenda-board.md`
- `01-org/research-math/teams/neural-footprint-instrumentation/neural-footprint-instrumentation-agenda-full.md`
- `01-org/research-math/teams/neural-footprint-instrumentation/neural-footprint-instrumentation-charter.md`
- `01-org/research-math/teams/neural-footprint-instrumentation/neural-footprint-instrumentation-directive.md`
- `01-org/research-math/teams/neural-footprint-instrumentation/neural-footprint-instrumentation-loops.md`
- `01-org/research-math/teams/neural-footprint-instrumentation/neural-footprint-instrumentation-premortem.md`
- `01-org/research-math/teams/neural-footprint-instrumentation/neural-footprint-instrumentation-schedule.md`
- `foundation/teams/intelligence.md`

**`INTEL-F4`** — 9 citations in 8 files

- `01-org/intelligence/security/security-agenda-board.md`
- `01-org/intelligence/security/security-agenda-full.md`
- `01-org/intelligence/security/security-charter.md`
- `01-org/intelligence/security/security-directive.md`
- `01-org/intelligence/security/teams/access-control-tenant-isolation/access-control-tenant-isolation-agenda-board.md`
- `01-org/intelligence/security/teams/access-control-tenant-isolation/access-control-tenant-isolation-charter.md`
- `01-org/intelligence/security/teams/perimeter-ingress-integrity/perimeter-ingress-integrity-charter.md`
- `foundation/teams/intelligence.md`

**`INTEL-F5`** — 9 citations in 7 files

- `01-org/research-math/research-math-agenda-board.md`
- `01-org/research-math/research-math-agenda-full.md`
- `01-org/research-math/research-math-charter.md`
- `01-org/research-math/teams/harness-model-routing/harness-model-routing-agenda-board.md`
- `01-org/research-math/teams/harness-model-routing/harness-model-routing-agenda-full.md`
- `01-org/research-math/teams/harness-model-routing/harness-model-routing-directive.md`
- `foundation/teams/intelligence.md`

**`INTEL-F6`** — 5 citations in 5 files

- `01-org/intelligence/analytics-bi/analytics-bi-agenda-full.md`
- `01-org/intelligence/analytics-bi/analytics-bi-charter.md`
- `01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-agenda-full.md`
- `01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-directive.md`
- `foundation/teams/intelligence.md`

**`INTEL-F7`** — 5 citations in 5 files

- `01-org/intelligence/analytics-bi/analytics-bi-agenda-full.md`
- `01-org/intelligence/analytics-bi/analytics-bi-charter.md`
- `01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-agenda-full.md`
- `01-org/intelligence/analytics-bi/teams/metric-contract-truth-assurance/metric-contract-truth-assurance-directive.md`
- `foundation/teams/intelligence.md`

### CORP-Fn — Corporate division (`foundation/teams/corporate.md` §7 + Knowledge & Documentation)

**`CORP-F1`** — 7 citations in 6 files

- `01-org/corporate/legal/legal-agenda-board.md`
- `01-org/corporate/legal/legal-charter.md`
- `01-org/corporate/people-agent-ops/people-agent-ops-charter.md`
- `01-org/corporate/strategy-fundraising/strategy-fundraising-agenda-board.md`
- `01-org/corporate/strategy-fundraising/strategy-fundraising-charter.md`
- `foundation/teams/corporate.md`

**`CORP-F2`** — 21 citations in 18 files

- `01-org/corporate/compliance-privacy/compliance-privacy-agenda-board.md`
- `01-org/corporate/compliance-privacy/compliance-privacy-agenda-full.md`
- `01-org/corporate/compliance-privacy/compliance-privacy-charter.md`
- `01-org/corporate/compliance-privacy/compliance-privacy-directive.md`
- `01-org/corporate/compliance-privacy/teams/regulated-operations/regulated-operations-charter.md`
- `01-org/corporate/compliance-privacy/teams/regulated-operations/regulated-operations-directive.md`
- `01-org/corporate/compliance-privacy/teams/regulatory-posture/regulatory-posture-agenda-board.md`
- `01-org/corporate/compliance-privacy/teams/regulatory-posture/regulatory-posture-agenda-full.md`
- `01-org/corporate/compliance-privacy/teams/regulatory-posture/regulatory-posture-charter.md`
- `01-org/corporate/compliance-privacy/teams/regulatory-posture/regulatory-posture-directive.md`
- `01-org/corporate/legal/legal-agenda-board.md`
- `01-org/corporate/legal/legal-agenda-full.md`
- `01-org/corporate/legal/legal-charter.md`
- `01-org/corporate/legal/legal-directive.md`
- `01-org/corporate/legal/teams/commercial-workforce-agreements/commercial-workforce-agreements-agenda-board.md`
- `01-org/corporate/legal/teams/commercial-workforce-agreements/commercial-workforce-agreements-agenda-full.md`
- `01-org/corporate/legal/teams/commercial-workforce-agreements/commercial-workforce-agreements-charter.md`
- `foundation/teams/corporate.md`

**`CORP-F3`** — 13 citations in 10 files

- `01-org/corporate/strategy-fundraising/strategy-fundraising-agenda-board.md`
- `01-org/corporate/strategy-fundraising/strategy-fundraising-agenda-full.md`
- `01-org/corporate/strategy-fundraising/strategy-fundraising-charter.md`
- `01-org/corporate/strategy-fundraising/strategy-fundraising-directive.md`
- `01-org/corporate/strategy-fundraising/strategy-fundraising-loops.md`
- `01-org/corporate/strategy-fundraising/teams/positioning-fundraise-readiness/positioning-fundraise-readiness-agenda-board.md`
- `01-org/corporate/strategy-fundraising/teams/positioning-fundraise-readiness/positioning-fundraise-readiness-agenda-full.md`
- `01-org/corporate/strategy-fundraising/teams/positioning-fundraise-readiness/positioning-fundraise-readiness-charter.md`
- `01-org/corporate/strategy-fundraising/teams/positioning-fundraise-readiness/positioning-fundraise-readiness-directive.md`
- `foundation/teams/corporate.md`

**`CORP-F4`** — 13 citations in 10 files

- `01-org/corporate/compliance-privacy/compliance-privacy-agenda-board.md`
- `01-org/corporate/compliance-privacy/compliance-privacy-agenda-full.md`
- `01-org/corporate/compliance-privacy/compliance-privacy-charter.md`
- `01-org/corporate/compliance-privacy/compliance-privacy-directive.md`
- `01-org/corporate/compliance-privacy/teams/regulated-operations/regulated-operations-agenda-board.md`
- `01-org/corporate/compliance-privacy/teams/regulated-operations/regulated-operations-agenda-full.md`
- `01-org/corporate/compliance-privacy/teams/regulated-operations/regulated-operations-charter.md`
- `01-org/corporate/compliance-privacy/teams/regulated-operations/regulated-operations-directive.md`
- `01-org/corporate/compliance-privacy/teams/regulated-operations/regulated-operations-schedule.md`
- `foundation/teams/corporate.md`

**`CORP-F5`** — 40 citations in 16 files

- `01-org/corporate/people-agent-ops/people-agent-ops-agenda-board.md`
- `01-org/corporate/people-agent-ops/people-agent-ops-agenda-full.md`
- `01-org/corporate/people-agent-ops/people-agent-ops-charter.md`
- `01-org/corporate/people-agent-ops/people-agent-ops-directive.md`
- `01-org/corporate/people-agent-ops/people-agent-ops-loops.md`
- `01-org/corporate/people-agent-ops/people-agent-ops-premortem.md`
- `01-org/corporate/people-agent-ops/people-agent-ops-schedule.md`
- `01-org/corporate/people-agent-ops/teams/performance-doneability/performance-doneability-agenda-board.md`
- `01-org/corporate/people-agent-ops/teams/performance-doneability/performance-doneability-agenda-full.md`
- `01-org/corporate/people-agent-ops/teams/performance-doneability/performance-doneability-charter.md`
- `01-org/corporate/people-agent-ops/teams/performance-doneability/performance-doneability-directive.md`
- `01-org/corporate/people-agent-ops/teams/performance-doneability/performance-doneability-loops.md`
- `01-org/corporate/people-agent-ops/teams/performance-doneability/performance-doneability-premortem.md`
- `01-org/corporate/people-agent-ops/teams/performance-doneability/performance-doneability-schedule.md`
- `02-advisory/decision-office/decision-office-premortem.md`
- `foundation/teams/corporate.md`

**`CORP-F6`** — 18 citations in 11 files

- `01-org/corporate/knowledge-documentation/knowledge-documentation-agenda-full.md`
- `01-org/corporate/knowledge-documentation/knowledge-documentation-charter.md`
- `01-org/corporate/knowledge-documentation/teams/standards-verification/standards-verification-agenda-full.md`
- `01-org/corporate/knowledge-documentation/teams/standards-verification/standards-verification-charter.md`
- `02-advisory/decision-office/decision-office-agenda-board.md`
- `02-advisory/decision-office/decision-office-agenda-full.md`
- `02-advisory/decision-office/decision-office-charter.md`
- `02-advisory/decision-office/decision-office-directive.md`
- `02-advisory/decision-office/decision-office-loops.md`
- `02-advisory/decision-office/decision-office-premortem.md`
- `foundation/teams/corporate.md`

**`CORP-F7`** — 10 citations in 10 files

- `01-org/corporate/knowledge-documentation/knowledge-documentation-agenda-full.md`
- `01-org/corporate/knowledge-documentation/knowledge-documentation-schedule.md`
- `01-org/corporate/knowledge-documentation/teams/corpus-archive/corpus-archive-schedule.md`
- `01-org/corporate/knowledge-documentation/teams/graph-retrieval/graph-retrieval-schedule.md`
- `01-org/corporate/knowledge-documentation/teams/standards-verification/standards-verification-agenda-board.md`
- `01-org/corporate/knowledge-documentation/teams/standards-verification/standards-verification-schedule.md`
- `02-advisory/decision-office/decision-office-agenda-board.md`
- `02-advisory/decision-office/decision-office-charter.md`
- `02-advisory/decision-office/decision-office-loops.md`
- `02-advisory/decision-office/decision-office-schedule.md`

**`CORP-F8`** — 3 citations in 3 files

- `01-org/corporate/knowledge-documentation/knowledge-documentation-agenda-full.md`
- `01-org/corporate/knowledge-documentation/knowledge-documentation-directive.md`
- `foundation/teams/corporate.md`

### CM-Fn — Commercial division (`foundation/teams/commercial.md` §6) — unchanged

**`CM-F1`** — 18 citations in 13 files

- `01-org/commercial/growth/growth-agenda-board.md`
- `01-org/commercial/growth/growth-charter.md`
- `01-org/commercial/growth/growth-premortem.md`
- `01-org/commercial/growth/growth-schedule.md`
- `01-org/commercial/growth/teams/content-production/content-production-charter.md`
- `01-org/commercial/growth/teams/editorial-gate/editorial-gate-agenda-full.md`
- `01-org/commercial/growth/teams/editorial-gate/editorial-gate-charter.md`
- `01-org/commercial/growth/teams/editorial-gate/editorial-gate-premortem.md`
- `02-advisory/decision-office/decision-office-agenda-board.md`
- `02-advisory/decision-office/decision-office-agenda-full.md`
- `02-advisory/decision-office/decision-office-charter.md`
- `02-advisory/decision-office/decision-office-loops.md`
- `foundation/teams/commercial.md`

**`CM-F2`** — 7 citations in 6 files

- `01-org/commercial/growth/growth-charter.md`
- `01-org/commercial/growth/growth-schedule.md`
- `01-org/commercial/growth/teams/content-production/content-production-directive.md`
- `01-org/commercial/growth/teams/content-production/content-production-loops.md`
- `01-org/commercial/growth/teams/content-production/content-production-premortem.md`
- `foundation/teams/commercial.md`

**`CM-F3`** — 61 citations in 24 files

- `01-org/commercial/sales/sales-agenda-board.md`
- `01-org/commercial/sales/sales-agenda-full.md`
- `01-org/commercial/sales/sales-charter.md`
- `01-org/commercial/sales/sales-directive.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-agenda-board.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-agenda-full.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-charter.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-directive.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-loops.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-premortem.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-schedule.md`
- `01-org/product/partnerships-integrations/teams/partner-alliance-development/partner-alliance-development-charter.md`
- `01-org/product/partnerships-integrations/teams/partner-alliance-development/partner-alliance-development-loops.md`
- `01-org/product/partnerships-integrations/teams/supplier-distributor-network/supplier-distributor-network-agenda-board.md`
- `01-org/product/partnerships-integrations/teams/supplier-distributor-network/supplier-distributor-network-agenda-full.md`
- `01-org/product/partnerships-integrations/teams/supplier-distributor-network/supplier-distributor-network-charter.md`
- `01-org/product/partnerships-integrations/teams/supplier-distributor-network/supplier-distributor-network-directive.md`
- `01-org/product/partnerships-integrations/teams/supplier-distributor-network/supplier-distributor-network-loops.md`
- `01-org/product/partnerships-integrations/teams/supplier-distributor-network/supplier-distributor-network-premortem.md`
- `01-org/product/partnerships-integrations/teams/supplier-distributor-network/supplier-distributor-network-schedule.md`
- `02-advisory/decision-office/decision-office-agenda-board.md`
- `02-advisory/decision-office/decision-office-charter.md`
- `02-advisory/decision-office/decision-office-loops.md`
- `foundation/teams/commercial.md`

**`CM-F4`** — 17 citations in 11 files

- `01-org/commercial/finance-pricing/finance-pricing-agenda-board.md`
- `01-org/commercial/finance-pricing/finance-pricing-agenda-full.md`
- `01-org/commercial/finance-pricing/finance-pricing-charter.md`
- `01-org/commercial/finance-pricing/finance-pricing-directive.md`
- `01-org/commercial/finance-pricing/finance-pricing-loops.md`
- `01-org/commercial/finance-pricing/finance-pricing-premortem.md`
- `01-org/commercial/finance-pricing/finance-pricing-schedule.md`
- `01-org/commercial/finance-pricing/teams/unit-economics-pricing/unit-economics-pricing-agenda-board.md`
- `01-org/commercial/finance-pricing/teams/unit-economics-pricing/unit-economics-pricing-charter.md`
- `01-org/commercial/growth/growth-charter.md`
- `foundation/teams/commercial.md`

**`CM-F5`** — 24 citations in 12 files

- `01-org/commercial/media-brand/media-brand-agenda-board.md`
- `01-org/commercial/media-brand/media-brand-agenda-full.md`
- `01-org/commercial/media-brand/media-brand-charter.md`
- `01-org/commercial/media-brand/media-brand-directive.md`
- `01-org/commercial/media-brand/media-brand-schedule.md`
- `01-org/commercial/media-brand/teams/brand-identity/brand-identity-agenda-board.md`
- `01-org/commercial/media-brand/teams/brand-identity/brand-identity-agenda-full.md`
- `01-org/commercial/media-brand/teams/brand-identity/brand-identity-charter.md`
- `01-org/commercial/media-brand/teams/brand-identity/brand-identity-directive.md`
- `01-org/commercial/media-brand/teams/brand-identity/brand-identity-premortem.md`
- `01-org/commercial/media-brand/teams/brand-identity/brand-identity-schedule.md`
- `foundation/teams/commercial.md`

**`CM-F6`** — 21 citations in 13 files

- `01-org/commercial/media-brand/media-brand-charter.md`
- `01-org/commercial/media-brand/media-brand-premortem.md`
- `01-org/commercial/media-brand/teams/social-community/social-community-agenda-board.md`
- `01-org/commercial/media-brand/teams/social-community/social-community-agenda-full.md`
- `01-org/commercial/media-brand/teams/social-community/social-community-charter.md`
- `01-org/commercial/media-brand/teams/social-community/social-community-directive.md`
- `01-org/commercial/sales/sales-agenda-board.md`
- `01-org/commercial/sales/sales-agenda-full.md`
- `01-org/commercial/sales/sales-charter.md`
- `01-org/product/partnerships-integrations/partnerships-integrations-charter.md`
- `01-org/product/partnerships-integrations/teams/supplier-distributor-network/supplier-distributor-network-charter.md`
- `02-advisory/decision-office/decision-office-charter.md`
- `foundation/teams/commercial.md`

<!-- CITATION-INDEX-END -->

---

## 5. Candidates for the canonical register

These are **proposals only** — [`OPEN-DECISIONS.md`](../../decisions/OPEN-DECISIONS.md)
was deliberately not edited by this pass (other work is touching it). Ordered by cost of
leaving them open.

### 5.1 File these — they are the founder's, and something is blocked on each

| Fork | Why it belongs in the register |
|---|---|
| **`TECH-F5` + `CORP-F1`** *(one question, minted twice)* | *Do teams get 7 artifacts or 3?* Two divisions independently raised it. It is the single largest upkeep decision in the corpus — ≈175 documents ride on the answer, and 99 units are already being generated against the "7" reading. **File once, not twice.** |
| **`CORP-F5`** | *Does `SpendLogger.log()` gain an `agent` parameter?* 40 citations. Without it, NF-A's named "cost per task" metric is not derivable, so it silently blocks OD-11's schema session. Schema + call-site change. |
| **`INTEL-F3`** | *Does NF get an `operator` `subject_type`?* 41 citations. Blocks Analytics & BI's AB-2 primary metric from having a home, and the window closes when OD-11's schema lands. Both Research & Math and Analytics & BI have written "decide this **inside** the OD-11 session, not after it". |
| **`TECH-F3`** | *The evaluation seam.* Two teams in two divisions claim the same mandate. Sibling of canonical OD-29 (the routing seam) — the two should be answered together, by the same principle. |
| **`TECH-F6`** | *Guardian-agent co-ownership.* Fleet owns the code, SRE owns the findings; neither will own the guardian canary, which is the operational test of whether the split works. Two of the four guardian agents are still stubs, so closing it is cheap **now**. |
| **`PROD-F5`** | *Design's commissioning authority.* Named by its own charter as "the fork that determines whether the department's largest team can function." A burn-down team that cannot commission endpoints reports *blocked* for a year. |
| **`PROD-F4`** | *Connector trust boundary.* Currently **asserted** in a charter rather than decided, and it spans Product / Engineering / Security. An asserted boundary is the shape OD-29 already got wrong once. |
| **`CM-F3`** | *Distributor connectivity — Sales or Partnerships?* 61 citations, the most-cited unfiled fork in the corpus, and unowned by either side today. |
| **`PROD-F2`** | *Vendor Finder boundary.* Already carries a **dated** consequence — day 90 (≈2026-11-22), `CM-F3` and `PROD-F2` both open with `pi.live_counterparties == 0` triggers a team-dissolution proposal. A dated trigger against an unregistered fork will fire against nothing. |
| **`INTEL-F5`** | *Are the seven raw-HTTP NestJS callsites in scope for OD-03?* This does not open a new decision, it **scopes an existing one** — if they are out of scope, OD-03 governs a minority of production model traffic. Attach as an amendment to OD-03. |
| **`INTEL-F2`** | *Classify per route, not per module.* Same shape: an amendment to canonical OD-19's method, not a new fork. The per-module labels prescribed the wrong control once already. |
| **`CORP-F6`** | *Does `standards-verification` reparent under the Decision Office?* The Decision Office has **declined in writing**; declining is within its authority, accepting is not. Needs a founder yes/no to close either way. |
| **`CORP-F7`** | *`.claude/skills/` — create and migrate, or correct ~99 `schedule.md` assertions?* Now **half-closed by a side effect**: the directory exists, is tracked, and holds zero `SKILL.md`, while ~99 documents still assert it does not exist. |

### 5.2 Do **not** file — already covered

| Fork | Disposition |
|---|---|
| **`INTEL-F6`** | Duplicate of canonical **OD-33** (insight-type count; the fix is an exact-count assertion, not a number). |
| **`CORP-F8`** | Answered — retire-to-write adopted org-wide as canonical **OD-34** (CLAUDE.md §4). |
| **`INTEL-F1`** | Reported resolved at **94** (`01-org/intelligence/security/security-charter.md:116`). Keep as a closed row here; nothing for the founder. |

### 5.3 Local, and should stay local

`TECH-F1`, `TECH-F2`, `TECH-F4`, `PROD-F1`, `PROD-F3`, `INTEL-F4`, `INTEL-F7`,
`CORP-F2`, `CORP-F3`, `CORP-F4`, `CM-F1`, `CM-F2`, `CM-F4`, `CM-F5`, `CM-F6` — all are
internal shape questions a division can answer for itself, or are already superseded by
a resolved decision (`CORP-F1`/`TECH-F5` subsumes several of the count questions). They
stay in this registry so they remain citable and closeable, and escalate only if a
division cannot settle them.

---

## 6. Standing rule proposed by this pass

> **No session mints an `OD-` ID.** `OD-nn` is issued only by
> [`OPEN-DECISIONS.md`](../../decisions/OPEN-DECISIONS.md). A session that hits a fork
> writes it to its division namespace (`TECH-F` · `PROD-F` · `INTEL-F` · `CORP-F` ·
> `COMM-F`/`CM-F` · `PLAT-F`), adds a row to this registry, and proposes it under §5.
> `fork-id-collision-scan` (`decision-office-schedule.md`) checks this: every
> identifier-shaped token in `01-org/` and `02-advisory/` must resolve to exactly one
> row — here or in the register.

*`PLAT-Fn` is reserved and currently unused: the Platform division's forks were all
raised in `foundation/teams/technology.md` and carry `TECH-Fn`.*
