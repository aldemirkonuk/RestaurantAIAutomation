---
type: agent-stack
division: advisory
department: decision-office
status: designed
updated: 2026-08-27
metrics: [decisions.open_count, decisions.median_age_days, decisions.unowned_count, decisions.close_rate_per_week, decisions.namespace_collisions, loops.undefined_close_time_count, triggers.dated_unwatched_count]
links: ["[[decision-office-charter]]", "[[decision-office-schedule]]", "[[decision-office-loops]]", "[[decision-office-premortem]]", "[[decision-office-questions]]", "[[FORK-REGISTRY]]", "[[OPEN-DECISIONS]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[red-team-charter]]", "[[architecture-review-charter]]", "[[LOOP-MAP]]"]
---

# Decision Office — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> Advisory sits **outside the line**, **findings-only, locked** ([[ORG_STRUCTURE]] §3,
> OD-16). **The Decision Office decides nothing** — the charter's load-bearing sentence,
> and the first constraint on this card: the agent tracks, surfaces and escalates, and an
> autonomy tier above `propose` would invert [`CLAUDE.md`](../../../CLAUDE.md) §0.1 using
> the office built to enforce it. Mechanisms referenced only — harness →
> [[harness-runtime-charter]] (**OD-03 open**), model choice →
> [[model-routing-inference-economics-charter]], mutation gate →
> [[action-safety-the-human-gate-charter]], skills → [[skills-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `decision-register-clerk` | Keep every open row's owner, filed-date and age true, watch the dated triggers and the loop close-times, surface collisions and contradictions — and never pick | NEW |

One row. A second agent that *resolved* anything would be [[decision-office-premortem]] M3
arriving with a cron entry.

## 2. Agent cards

```yaml
agent: decision-register-clerk
unit: decision-office
triggers:
  - schedule: "weekly — register triage, dated-trigger scan, escalation ageing"   # [[decision-office-schedule]]
  - schedule: "monthly — unfiled-fork sweep, loop close-time audit, contradiction + stale-citation sweep"
  - topic: decisions.row_appended   # publisher: NONE (gap — the register is a concurrent write target; OD-28…OD-31 were appended by parallel sessions mid-charter)
consumes:
  - "decisions/OPEN-DECISIONS.md — 39 open rows today (publisher: any session; see the gap row)"
  - "decisions/0001…0034 + decisions/README.md (publisher: whoever locks an ADR)"
  - "00-index/loops.json — 485 loops (publisher: scripts/build_loop_index.py)"
  - "[[FORK-REGISTRY]] — this unit's own namespace reconciliation"
  - "every unit's <slug>-questions.md (publisher: scripts/build_questions_files.py, OD-41)"
emits:
  - "owner + filed_date + age on every open row → the weekly digest (consumer: founder)"
  - "collision and supersession records into [[FORK-REGISTRY]] (consumer: any session minting an ID)"
  - "findings into the owning unit's <slug>-questions.md (consumer: that unit)"
  - "third re-raise escalations (consumer: [[red-team-charter]], per schedule L2)"
  - "nf_a events (task_type: register_triage)"
routing_class: mechanical    # count, age, diff, mint. A judgment class here would be the card admitting it decides
quality_bar: "every open row carries owner + filed_date + age, or the digest names the rows that do not; the digest ships whether or not anything moved. NONE (gap) — ADR 0017 has no verdict basis for register hygiene"
autonomy:
  read: autonomous
  propose: autonomous        # digests, register rows and findings land as PRs
  mutate_stock_money_outbound: confirm   # constant; this agent has no such surface
memory: decision-office
escalates_to: "founder (weekly digest); [[red-team-charter]] on the third re-raise"
```

**Two hard rules on the card.** (1) It never edits the *meaning* of a cited row and never
reassigns a cited ID: OD-23 was silently rewritten under **51** citing documents, and the
clerk's remedy is a new ID plus a recorded supersession, never an in-place rewrite.
(2) It never fills a fork's outcome — the two live routings below are what that costs:

- **OD-25** (`OPEN-DECISIONS.md:33`) — which department owns the weekly skill-health job.
  Two foundation documents name two owners; the 2026-08-24 call fixed the *principle* and
  not the department (`:131`). The clerk records both citations, the founder picks. **Open.**
- **TECH-F3** ([[FORK-REGISTRY]]`:64,200,649`) — the evaluation seam, **26 citations across
  17 files**, sibling of OD-29. This office issued the ID after the local `OD-21` collided
  with the canonical one; issuing an identifier is registrar work, choosing which side
  absorbs the other is not. **Open.**

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `fork-id-collision-scan` | T2 | Any session about to mint a fork ID; the monthly unfiled-fork sweep | Every identifier-shaped token in `01-org/` + `02-advisory/` resolves to exactly one row, or is listed as a collision | **2026-08-24 session.** `OD-19`…`OD-24` carried 2–3 meanings each; three generators hand-corrected their own briefs (`product-vision-charter.md:133`, `design-agenda-board.md:104`, `supplier-distributor-network-charter.md:73`) | NEW |
| `register-triage-digest` | T2 | Weekly, or before a founder session | Every open row carries owner + filed-date + age; the digest leads with the oldest | **2026-08-24 session.** 23 rows read by hand to establish `unowned_count = 23`; the register was 35 rows by the end of the same session | NEW |
| `dated-trigger-calendar` | T2 | Weekly scan; fires on the date | Every dated trigger has a `days_until` and a terminal state | **2026-08-24 session.** Six triggers found by grepping five date literals across 581 files; four collide on **2026-11-24** and none had a watcher | NEW |
| `loop-close-time-audit` | T2 | Monthly | All loops parsed; undefined close-times, status drift, and the `proposed` share reported | **2026-08-24 session.** `privacy-engineering-loops.md:188` (`close_time: UNDEFINED`) and `content-production-loops.md:58` (`status: monthly`) were both found by hand | NEW |

**Two candidates stay off this table on purpose.** `stale-citation-verify` has one instance
(`YC_WEDGE_PLAN.md:401` → `ReceivingWorkspace.tsx`, a citation that *inverted*) and its seam
belongs to [[standards-verification-charter]] first; `adr-index-parity` has **no** instance.
The office that reports on everyone else's §3.3 compliance gets no exception. Tiers are
[[skills-charter]]'s to confirm.

## 4. Memory

- **Procedural** — the §3 skills; consolidation candidates go to
  [[skill-harvesting-charter]]'s queue and still face the §3.3 gate.
- **Episodic** — nf_a `task_type: register_triage` and `fork_scan`, one event per run.
  Needs `context.fork_id` as a jsonb key so "every touch of OD-23" is one filter. The
  charter's rule holds: **no `nf_a.*` metric appears in this unit's `metrics`** — these
  events are a memory substrate, not borrowed credibility.
- **Semantic** — `memory/` beside this file, `decision-office-MEMORY.md` as index, one fact
  per file with `source` / `confidence` / `last_verified`. Founding facts already measured:
  the **7:1** fill-to-drain ratio (14 filed, 2 closed, one session); four dated triggers
  landing together on 2026-11-24; OD-23's rewrite under 51 citers; and **194 agenda
  documents** carrying one `updated: 2026-08-24`, so the 60-day clock expires as one event
  around 2026-10-23. Every write is a PR.
- **Working** — this card, the MEMORY index, charter §Authority. Loading the authority limit
  at task start is the cheapest counter-pressure against [[decision-office-premortem]] M3;
  the register is a retrieval target, not a preload.

**Consolidation** — monthly, mirrored in [[decision-office-schedule]]: read the triage and
sweep slice since the last run; write one fact per durable finding, **failures first** — a
fork aged past its close_time becomes a fact naming *why it did not close* (no owner, no
filed date, contested seam), never "still open"; expire facts unverified 90 days; propose
skill candidates. One PR; "no delta" is stated, never silence.

## 5. Async contract

Cross-unit interaction is loops ([[decision-office-loops]] — six, weekly through
quarterly, all `proposed`), NF-A events, vault PRs, and skill candidates. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `decisions.row_appended` has no publisher | The register is written concurrently by other sessions with no notification; the weekly triage bounds the blind spot at 7 days |
| Findings into another unit's `questions.md` notify nobody | The files exist (OD-41); nothing pushes. Every advisory function shares this gap |
| `decisions.median_age_days` has no instrument | 39 of 39 open rows carry no filed date, so the ADR 0002 tripwire — "grows faster than it drains" — still cannot fire. The clerk's first job is to create the column it is graded on |

## 6. Evidence today

- **NEW — the clerk and all four skills.** No triage runs; every cited instance is the
  2026-08-24 generation session doing the work by hand.
- **EXISTS — the substrate, larger than the charter records.** 34 ADRs (`0001`–`0034`, 25
  carrying a Locked status), `OPEN-DECISIONS.md` at **39** open rows (charter says 35), and
  this unit's own [[FORK-REGISTRY]] — the namespace reconciliation named as its first
  assignment — written and on disk.
- **EXISTS — the loop census, which closes a stated blocker.** `00-index/LOOP-MAP.md` and
  `00-index/DECISION-INDEX.md` now exist (charter §Evidence says they do not), generated by
  `scripts/build_loop_index.py`: **485 loops across 100 units**, with `loop_ids` /
  `loop_close_times` / `loop_statuses` in frontmatter where Dataview can index them. So
  `loop-close-time-audit`'s blocker is **closed** and `loops.undefined_close_time_count`
  reads **0** against `00-index/loops.json`; the live number is the status mix — **438 of
  485 `proposed`, 3 active, 2 running.**
- **PARTIAL — the register as an instrument.** Still no owner column, no date column, no
  triage state. Everything §4 describes is NEW.
