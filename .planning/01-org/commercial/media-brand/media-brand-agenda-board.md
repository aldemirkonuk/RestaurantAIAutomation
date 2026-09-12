---
type: agenda-board
division: commercial
department: media-brand
status: active
metrics: [nf_b.choice, nf_b.context]
updated: 2026-08-28
links:
  - "[[media-brand-charter]]"
  - "[[media-brand-agenda-full]]"
  - "[[media-brand-loops]]"
  - "[[media-brand-agent-stack]]"
  - "[[0039-activation-plan-of-record]]"
---

# Media & Brand — Board

**Dated 2026-08-28.** Queries, not a second copy of the agenda. The eighteen tasks live in
[[media-brand-agenda-full]]; everything below reads them or reads the vault. If a row here
disagrees with the agenda, the agenda is right and this file is stale.

## The eighteen, rendered from the agenda

```dataview
TASK
FROM "01-org/commercial/media-brand"
WHERE !completed
GROUP BY file.link
```

## Done, so the burn-down is visible

```dataview
TASK
FROM "01-org/commercial/media-brand"
WHERE completed
GROUP BY file.link
```

## Every document in this department

```dataview
TABLE type, status, updated
FROM "01-org"
WHERE department = this.department
SORT team ASC, type ASC
```

## Team status roll-up

```dataview
TABLE WITHOUT ID
  team AS "Team",
  status AS "Evidence grade",
  updated AS "Last touched"
FROM "01-org"
WHERE department = this.department AND type = "charter" AND team
SORT team ASC
```

## Anything in this department stale for 60 days

```dataview
TABLE type, team, updated
FROM "01-org"
WHERE department = this.department AND date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops this department owns, by close-time

```dataview
TABLE team, status
FROM "01-org"
WHERE department = this.department AND type = "loops"
SORT team ASC
```

## Advisory findings and unanswered questions across the department

```dataview
TABLE open_questions, updated
FROM "01-org"
WHERE department = this.department AND type = "questions" AND open_questions > 0
SORT open_questions DESC
```

---

## The metric set — two numbers, never one

Per `mb-outward-warden`'s quality bar: a row carries a value, or the words *not measurable*
with its dependency named. Re-measured 2026-08-28, not carried forward.

| Team | Metric | Value | Dependency if unmeasurable |
|---|---|---|---|
| M1 Brand Identity | Legacy **name** refs in shipped surfaces → 0 | **360** lines / 195 files *(was 351/193 on 2026-08-24)* | — |
| M1 Brand Identity | Legacy **domain** refs in shipped surfaces → 0 | **39** lines / 27 files *(was 33/25 on 2026-08-24)* | — |
| M2 Narrative & Collateral | Artifacts leading with the one sentence | **not measurable** | No outward artifact exists to audit — MB-9 / MB-10 clear this |
| M3 Social & Community | Referred sessions reaching an activated account | **not measurable** | No product analytics; Sentry is the only telemetry SDK — Growth G5 |
| M4 Customer Relationship Research | Findings per consented cohort | **not measurable** | No approval register — and per MB-14, no consent enforcement either |
| M4 Customer Relationship Research | Records touched with `consent_withdrawn_at` set | **0**, and it is a hard override, not a target | — |

**Both M1 numbers moved the wrong way in four days with zero guards in place.** That is the
argument for MB-4 landing in week one.

## Standing locks — what is forbidden, as visible as what is scheduled

| Lock | Source | Forbids | Still permits |
|---|---|---|---|
| **Brand / landing visuals: HELD** | `decisions/README.md:76`; re-confirmed 2026-08-28, [[0039-activation-plan-of-record]] | Commissioning any visual — wordmark, palette, type, landing page, Blender | Voice, identity, naming, tone-of-voice groundwork (MB-1, MB-2); in-product **copy** corrections (MB-7) |
| **Pricing model: DEFERRED** | [[0039-activation-plan-of-record]] | Any price in any outward artifact | A `PRICING — DEFERRED` row in the claim ledger (MB-10) |
| **Consent gate** | `media-brand-directive.md:46-52`; charter §non-goals | Any research touch — publicness of the data is not an argument | Writing requirements against the gate Compliance & Privacy owns (MB-13, MB-15) |
| **CM-F5 — identifiers** | `media-brand-charter.md:82-86` | Renaming workspace scopes, container names, deploy targets, the Expo slug | Handing the tier-3 list to Engineering with the slug hazard written down |
| **Rebrand posture** | the id-less 'Rebrand posture' row, `OPEN-DECISIONS.md` Resolved table | Executing the sweep before the brand direction exists | A ratchet that forbids the counts from **growing** (MB-4) — pending founder question 6 |

## Seams this agenda touches

| Unit | What crosses | Direction |
|---|---|---|
| [[engineering-charter\|Platform → Engineering]] | The CI job for MB-4; the tier-3 list and the Expo slug hazard; a destination for MB-5's two new classes | Ask filed to their questions file |
| [[editorial-gate-charter\|Growth G3]] | MB-1's voice guide is the thing G3 enforces; M3's entry trigger is G3 clearing an article | We define, they apply |
| [[compliance-privacy-charter\|Corporate → Compliance & Privacy]] | MB-13's requirements pack; MB-14's finding; they own the consent-gate spec | We state requirements, they own the mechanism |
| [[design-partner-operations-charter\|Sales S1]] | The verified recovery number MB-10 may not state until their loop closes once | Blocked on them, honestly |
| [[guest-experience-charter\|Product → Guest Experience]] | MB-14's finding touches guest consent enforcement | Finding filed, not fixed |
| [[strategy-fundraising-charter\|Corporate → Strategy & Fundraising]] | Whether MB-11's demo may be shown at all | Their decision, not ours |
| [[design-charter\|Product → Design]] | The `AuthShell.tsx` seam: wordmark and sentence ours, form and states theirs | Boundary, watched |
| [[decision-office-charter\|Decision Office]] | CM-F5 and CM-F6 are open forks | Escalation path |

## Not ours, and not scheduled here

- Workspace and deploy identifiers → Engineering, fork **CM-F5**
- Product analytics, without which M3's metric cannot exist → Growth G5
- The legal basis for consent → Compliance & Privacy
- The YC path and the decision to apply → Strategy & Fundraising
- Product interaction design → Product → Design

## Canvas

One picture of this agenda: `.planning/sketches/067-media-brand-agenda-canvas/canvas.html`.
