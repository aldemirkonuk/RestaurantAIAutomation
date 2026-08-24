---
type: schedule
division: commercial
department: media-brand
team: social-community
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[social-community-charter]]"
  - "[[social-community-loops]]"
  - "[[media-brand-schedule]]"
---

# Social & Community (M3) — Schedule & Skills

## Recurring work

### While dormant — this is the whole table

| Cadence | Job | Emits |
|---|---|---|
| Weekly | **Entry-trigger watch.** Has a long-form article cleared G3? One line, yes or no | `social-entry-trigger-watch` |
| Quarterly | Handle and name availability check | `social-name-availability` |

Two jobs, both cheap, both closing a specific failure mechanism. A dormant team with a
longer schedule than this is not dormant.

**The weekly watch is explicitly exempt from the three-runs-no-action deletion rule**
([README §6](../../../../../foundation/README.md)) while the team is dormant. It is designed
to produce no action almost every time it runs. Without the written exemption, the
anti-sprawl rule would delete the one mechanism preventing premortem mechanism 2 — the
trigger firing and nobody noticing.

### After the trigger fires — not scheduled yet

| Cadence | Job | Emits |
|---|---|---|
| Per post | G3 clearance — a post is published content | — |
| Weekly | Reply sweep; count replies unanswered past 48h | `social-reply-routing` |
| Monthly | Referred activation — sessions and activated accounts | `social-referred-activation` |

These are written now and scheduled later, so the launch week executes a list instead of
inventing one.

## Skills owned

Skills live in `.claude/skills/`. **None exist, and none should be built yet.**

[README §3.3](../../../../../foundation/README.md) requires a real past instance before a
skill is committed, and this team has no past. Building a posting or scheduling skill for a
team that has never posted would be the clearest possible case of the speculative skill the
rule exists to prevent — and, given the 30-day staleness rule, it would be reviewed for
deletion before its first firing.

**What would be built, when the trigger fires:**

### `post-preflight` — T2 department, **not built**

- **Trigger.** Before any post.
- **Doneability.** Confirms the item cleared G3, confirms it links to something that exists,
  applies M1's voice guide, and checks the routing rule's address is current.
- **Real past instance.** None yet. **Required before this is committed.**
- **Owner.** M3.

### `trigger-watch` — T3 operational, **buildable now, barely worth it**

- **Trigger.** Weekly.
- **Doneability.** Returns yes or no.
- **Real past instance.** Premortem mechanism 2 — a trigger that fires unnoticed. That is a
  documented mechanism rather than a past instance, so this stays a scheduled human line
  until it is worth automating. A one-bit weekly check does not need a skill; it needs
  somebody's calendar.
- **Owner.** M3.

---

## Explicitly not owned here

| Work | Owner | Why |
|---|---|---|
| Writing posts' source material | Growth G2 | Distribution, not production |
| Clearing anything for publication | Growth G3 | Including posts |
| Funnel instrumentation | Growth G5 | This team's metric depends on it and cannot build it |
| The support address a reply routes to | Brand Identity M1 | Currently still the previous company's |
| Researching anyone who interacts with us | Nobody, today | M4's gate, and the register does not exist |
