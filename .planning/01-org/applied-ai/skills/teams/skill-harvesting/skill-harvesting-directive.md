---
type: directive
division: applied-ai
department: skills
team: skill-harvesting
status: new
metrics: [skills.harvested_firing_rate_30d, skills.registry_size]
updated: 2026-08-24
links: ["[[skill-harvesting-charter]]", "[[skill-harvesting-premortem]]", "[[skill-harvesting-loops]]", "[[skills-directive]]", "[[skill-registry-authoring-directive]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[technology]]"]
---

# Skill Harvesting — Directive

How *this* team decides. Shape: **a staffing gate in front of a rate-limited
candidate filter**. The unusual part is the first half — most units decide about
work; this one must first decide whether it is allowed to exist this quarter.

## The gate, then the filter

```mermaid
graph TD
  subgraph GATE["Staffing gate — evaluated monthly by the registry census"]
    G1{"registry_size >= 15<br/>OR protocol-compliance green<br/>2 consecutive quarters?"}
    G1 -->|no| G2["DO NOT STAFF.<br/>Harvest stays a quarterly task inside<br/>skill-registry-authoring."]
    G1 -->|yes| G3{"Is firing measurable?<br/>(proposed clause — TECH-F4)"}
    G3 -->|no| G4["⚠️ Staffing now makes the disband<br/>condition unevaluable. Premortem M4.<br/>Escalate before staffing."]
    G3 -->|yes| G5["STAFF"]
  end
  G5 --> F1
  subgraph FILTER["Candidate filter — once staffed"]
    F1["Procedure spotted in scripts/,<br/>workflows, or commit patterns"] --> F2{"Evidence of RECURRENCE,<br/>not merely existence?"}
    F2 -->|"one commit, no callers"| R1["REJECT · one-off tooling.<br/>Premortem M2."]
    F2 -->|"recurs"| F3{"past_instance resolves to<br/>something OTHER than the<br/>file being wrapped?"}
    F3 -->|no| R2["REJECT · circular evidence"]
    F3 -->|yes| F4{"Admissions this month<br/>< rate limit?"}
    F4 -->|no| Q["HOLD in queue.<br/>The backlog is not a deadline."]
    F4 -->|yes| F5["Submit as a normal candidate to<br/>skill-registry-authoring's §3.3 gate.<br/>No bulk path."]
    Q --> F4
  end
  F5 --> RA[[skill-registry-authoring-charter|"skill-registry-authoring"]]
```

## Decision rights

**Ours — but only once staffed, which is not now:**

- Whether a spotted procedure becomes a candidate.
- Rejecting a candidate for one-off-ness or circular evidence.
- Queue order and the firing prediction attached to each candidate.
- Declaring a harvest sweep finished with **zero** candidates — a legitimate and
  underrated outcome.

**Never ours:**

| Not our call | Whose | Why |
|---|---|---|
| **Whether this team staffs** | Founder / [[skills-directive]], on the monthly census | A gated team that self-activates has no gate. This is the single most important line in the file. |
| Admitting a candidate to the registry | [[skill-registry-authoring-directive]] | Harvest volume must never bypass §3.3 |
| The admission rate limit | [[skill-lifecycle-anti-sprawl-charter]] | It is set by *review capacity*, so the reviewer sets it |
| Amending the entry trigger | Founder — **TECH-F4** | A written trigger is amended by decision, not by judgement ([[technology]] §4.3) |
| Deleting the scripts we harvest from | Engineering / Data / Reliability | The script stays theirs; we extract the procedure |

## Escalation trigger

1. **Anyone proposes staffing before the gate is met.** Escalate rather than comply,
   even if the reasoning is good — especially then. [[skill-harvesting-premortem]]
   M1 begins with a persuasive argument about 59 obvious wins.
2. **Anyone proposes a bulk-admission path.** There is no version of this that is
   safe; the rate limit is the mechanism.
3. **Gate met but firing still unmeasurable.** Escalate the M4 amendment before
   staffing, not after.
4. **2026-11-24 arrives with no scheduled re-evaluation of the trigger.** M3 — the
   team is drifting into permanent paper existence.
5. **Two consecutive sweeps produce zero admissible candidates.** Evidence that the
   reservoir was thinner than it looked; report it, because it is an argument for
   deleting this team rather than a failure to hide.

## Standing rule

**The backlog is not a deadline.** 59 unowned procedures have sat for a year without
harm. Every failure mode in [[skill-harvesting-premortem]] except M3 starts with
treating the reservoir's size as urgency. It is inventory, not debt — and inventory
that has cost nothing to hold will keep costing nothing.
