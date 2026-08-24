# Organization Structure — Mudavym

- **Status:** **LOCKED** 2026-08-24 — see [ADR 0007](../decisions/0007-org-structure.md). Team layer in progress; division count (5 vs 6) pending team-layer evidence.
- **Keywords:** divisions, departments, advisory, matrix, premortem, loops, obsidian, graphify
- **Links:** [foundation README](README.md), [decisions](../decisions/README.md)

---

## 1. Shape

Three layers, not one list:

```
Division  →  Department  →  Sub-layer / Team
                 ↑
        Advisory (cross-cutting, sits outside the line)
```

The division layer exists so twenty departments are not twenty peers reporting into
one point, and so the loop graph (§4) has readable clusters instead of a dense mesh.

---

## 2. The line organization — LOCKED

| Division | Departments | Sub-layers |
|---|---|---|
| **Platform** | Engineering · Data · Reliability/SRE | — |
| **Applied AI** | AI Orchestration · Skills | — |
| **Intelligence** | Research & Math · Security · Analytics & BI | — |
| **Product** | Product & Vision · Design · Partnerships & Integrations | Guest Experience *(under Product & Vision)* |
| **Commercial** | Growth · Sales · Media & Brand | Finance & Pricing *(under Growth)* |
| **Corporate** | Legal · Knowledge & Documentation · Compliance & Privacy · People & Agent Ops · Strategy & Fundraising | — |

**6 divisions · 19 departments · 2 sub-layers · 3 advisory · 75 teams.**

> Correction 2026-08-24: earlier drafts said "20 departments". The list has always
> been 19 (5+3+3+3+5); the count was wrong, not the roster. Technology was split into
> **Platform** (Engineering, Data, Reliability/SRE) and **Applied AI** (AI Orchestration,
> Skills) on the evidence of its 25-team span, taking divisions from 5 to 6.

Rationale for the four newest (locked this round): **Analytics & BI** owns the metrics
narrative that sells the product, which is a different job from Data's substrate;
**Compliance & Privacy** covers GDPR/CCPA, DPAs, and the consent gate that Media's
customer research already depends on; **People & Agent Ops** is the AI-native HR
function whose workforce is agents and whose primary input is NF-A; **Strategy &
Fundraising** owns the YC path and the SAFE/board/stock documents Legal's list implies.

---

## 3. Advisory layer — LOCKED (3 of 4 adopted)

Independent functions that own a department-equivalent charter but deliberately
**cut across every division** rather than sitting inside one. They exist to make the
"review after review after review" mandate structural instead of aspirational — an
advisory function that reports inside the line it reviews is not independent.

| Advisory | Reviews | Why it must sit outside the line |
|---|---|---|
| **Architecture Review** | All of Technology + Product | Owns the L0–L6 layer-dependency rule (foundation §1). A layer violation is invisible to the department committing it. |
| **Red Team** | Decisions, everywhere | **Scoped by founder:** detects and attacks *decisions*, and does premortem thinking — not general security testing (Security builds defenses in the line). Output must make "what's next" easy to navigate. |
| **Decision Office** | Everything | Owns the ADR log, the open-decision queue, and loop close-times. Ensures decisions actually close rather than drifting — the failure mode this whole chapter exists to prevent. |
| ~~Ethics & Responsible AI~~ | — | **Considered, not adopted** (2026-08-24). Agent-autonomy limits and guest-data use fall to Compliance & Privacy in the line. |

**Engagement model — LOCKED findings-only.** Advisory functions do not approve or block. They
produce written findings against a named unit, and the finding lands in that unit's
`questions.md` and — if it implies a decision — in `OPEN-DECISIONS.md`.

---

## 4. Unit anatomy — LOCKED

Every department and advisory function gets the same seven artifacts, so a unit built
in one session is the same shape as one built in another.

| # | File | Contents |
|---|---|---|
| 1 | `charter.md` | Mandate, boundaries, explicit non-goals, parent division |
| 2 | `premortem.md` | **How this unit fails.** Written at founding, before success is assumed |
| 3 | `agenda-full.md` | The working document: what/how/why, next steps, reasoning. **Must open with a `> PROVISIONAL — no work done yet` banner until the unit does real work.** |
| 4 | `agenda-board.md` | Glanceable status. Bullets only, no prose (vision §12F). **Same provisional banner rule.** |
| 5 | `directive.md` | How *this* unit decides — an explicit decision graph, shape differs per unit (vision §12G/§12L) |
| 6 | `loops.md` | Feedback loops owned: what it measures → what it changes → close-time |
| 7 | `schedule.md` | Recurring work + index of skills owned (`.claude/skills/`) |

**Premortem is artifact #2 deliberately.** A unit that cannot articulate its own
failure mode before it starts has not been thought through.

**Volume, honestly:** 99 units (19 departments + 2 sub-layers + 3 advisory + 75 teams)
× 7 artifacts = **693 documents**. That is the cost of
"full hierarchy." It is achievable in parallel, but it is real upkeep — the anti-sprawl
rules in foundation §3.3 and §6 apply here too: an agenda that has not changed in 60
days is either finished or fiction.

---

## 5. Loop graph conventions — Obsidian + Graphify

Loops are documented now and executable later (OD-12 resolved). To make that true
rather than aspirational, every `loops.md` entry carries machine-readable frontmatter:

```yaml
---
type: loop
id: nf-a-harness-improvement
owner: research-and-math
measures: [nf_a.task_success_rate, nf_a.cost_per_task]
changes: [harness.routing_policy, skills.registry]
inputs_from: [ai-orchestration, skills]
outputs_to: [engineering, people-and-agent-ops]
close_time: weekly
status: proposed
---
```

Rules:
- **Every loop names its close-time.** A loop that cannot state how fast it closes is
  a diagram, not a loop.
- **Every unit doc carries `type`, `division`, and `links`** so Graphify and Obsidian's
  graph view cluster correctly.
- Cross-links use `[[slug]]`. An unresolved `[[link]]` marks a doc worth writing.

---

## 6. Open forks from this document

| ID | Fork |
|---|---|
| OD-18 | Division count: 5, or split Technology into Platform + Applied AI? **Deferred pending team-layer evidence.** (§2) |
