---
type: agent-stack
division: product
department: guest-experience
parent_department: product-vision
status: designed
updated: 2026-08-27
metrics: [nf_b.subject_coverage, nf_b.false_merge_count, nf_b.event_completeness, nf_b.events_per_active_guest_month, nf_b.points_confirm_rate, nf_b.ops_conversion, nf_b.k_anonymity_pass_rate]
links: ["[[guest-experience-charter]]", "[[guest-experience-schedule]]", "[[guest-experience-loops]]", "[[guest-experience-agenda-board]]", "[[0034-agent-stack-artifact]]", "[[0029-p3-plan-of-record]]", "[[skills-charter]]", "[[product-vision-charter]]", "[[compliance-privacy-charter]]", "[[guest-identity-consent-agent-stack]]", "[[taste-fingerprint-agent-stack]]", "[[consumer-app-points-economy-agent-stack]]", "[[guest-value-monetization-agent-stack]]"]
---

# Guest Experience — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This is a **sub-layer** stack: it orchestrates itself and reports upward to
> [[product-vision-charter]], it does not do the four teams' work. Mechanisms are
> referenced, never restated — harness → [[harness-runtime-charter]] (**OD-03 open**),
> model choice → [[model-routing-inference-economics-charter]], the mutation gate →
> [[action-safety-the-human-gate-charter]], skills → [[skills-charter]].
>
> **The constraint that shapes every card below.** NF-B is **HELD** by founder
> call, recorded in [[0029-p3-plan-of-record]] §3: the three-table slice is finished,
> application call sites measured **zero** on 2026-08-26, and it has no caller because
> *which guest surface it serves* is undecided (OD-05, OD-07). §6.4 of that ADR names
> the failure mode by name — *"NF-B gets wired minimally by someone being helpful."*
> **No agent in this sub-layer may write that caller.** Wiring it is an agent choosing
> the guest product, which is a founder call.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `guest-experience-orchestrator` | Roll the four teams' `nf_b.*` metric sets onto one board while keeping the undefined/zero distinction intact, and escalate the two-quarters-at-zero `nf_b.ops_conversion` trigger to Product & Vision | NEW |

One row deliberately. Three of the four teams are unstaffed or blocked; a sub-layer
agent that did their work would be the only agent in the sub-layer with anything to do,
which is how a rollup becomes a build.

## 2. Agent cards

```yaml
agent: guest-experience-orchestrator
unit: guest-experience
triggers:
  - schedule: "weekly — coverage-and-refusals read"        # mirrored in [[guest-experience-schedule]]
  - schedule: "quarterly — ops-conversion review"           # the escalation trigger, same doc
  - topic: nf_b.event_emitted                               # publisher: NONE (gap — see §5)
consumes:
  - the four team agenda-boards (Dataview output)
  - "neural_footprint_event where subject_type = 'guest' (supabase/migrations/20260824141116_neural_footprint_event.sql:23-24) — zero rows today"
  - "the CI verdicts of the guest guards (.github/workflows/schema-parity.yml:185-212)"
  - "[[guest-experience-loops]] rows nf-b-subject-coverage … nf-b-k-anonymity-gate"
emits:
  - "[[guest-experience-agenda-board]] rollup — the metric SET, never an average (charter §Metrics)"
  - escalation notes into [[guest-experience-agenda-full]] §Questions
  - nf_a events (task_type: guest_board_rollup)
routing_class: extraction        # reading boards and counting denominators is not judgment
quality_bar: "every board row reads as a measured value, `0 (structurally — no writer)`, or `undefined (no denominator)`. A number derived from a zero denominator is a failed run, not a low score (charter §Metrics)"
autonomy:
  read: autonomous
  propose: autonomous            # board edits and escalations land as PRs
  mutate_stock_money_outbound: confirm   # constant; this agent has no such surface
memory: guest-experience
escalates_to: "[[product-vision-charter]]"   # per charter: two consecutive quarters of nf_b.ops_conversion at zero returns this charter for a scope decision
```

**The card's own hard rule:** the orchestrator never writes, wires, or proposes an
application caller for `guests` / `guest_identifiers` / `guest_check_links`. It reports
the zero; it does not fix it ([[0029-p3-plan-of-record]] §3, §6.4).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `nf-b-denominator-read` | T2 | Weekly board refresh, or any request for a guest metric | Every `nf_b.*` row prints its denominator and is labelled measured / structurally-zero / undefined; `nf_b.subject_coverage` never appears without `nf_b.refusal_count` beside it | The 2026-08-24 charter session established structural zero by grep over `apps/api-gateway/src`, `apps/web/src`, `apps/mobile/src` ([[guest-experience-charter]] §Evidence); re-verified 2026-08-27 — the only app-side reference is still `apps/api-gateway/src/settings/feature-flag-registry.ts:145-147` | NEW |
| `guest-evidence-recheck` | T2 | Any session about to act on a claim in a guest charter | Every cited `path:line` re-read against the working tree; each stale claim restated with the current citation rather than propagated | 2026-08-27, three claims from the 2026-08-24 set had already moved: the merge gate is now wired (`.github/workflows/schema-parity.yml:185-212`, charter said nothing ran it); OD-11 is recorded closed in the register (Path C, ADR 0008) while three charters still read it as open; and `subject_type` shipped with a fourth value, `operator` (`20260824141116_neural_footprint_event.sql:21-24`), which is option (a) of the charter's own unhomed-signal flag | NEW |

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]); the
four team-level skill sets, listed in their own stacks.

## 4. Memory

- **Procedural** — the §3 skills; candidates from consolidation go to
  [[skill-harvesting-charter]]'s queue through the §3.3 gate.
- **Episodic** — nf_a `task_type: guest_board_rollup` and `guest_evidence_recheck`,
  with `context.team` as a jsonb key so a per-team slice is a filter, not a join.
  **The subject split matters here:** the agent's own runs are NF-A; NF-B is the
  *subject matter* it reports on, and NF-B has no rows — `nfe_guest_choice`
  (`20260824141116_neural_footprint_event.sql:51-54`) is an index with no writer.
- **Semantic** — `memory/` beside this file, one fact per file, `source` /
  `confidence` / `last_verified` frontmatter; index `guest-experience-MEMORY.md`. Its
  founding facts are known: the denominator is structurally zero and why, NF-B is held
  by decision rather than backlog, and which charter claims have expired. Writes are PRs.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. The
  564-line migration and the 41 UX paths are `path:line` retrieval targets (CLAUDE.md §2).

**Consolidation** — monthly, mirrored in [[guest-experience-schedule]]'s
`guest-agenda-sync`: read the sub-layer's NF-A slice and the four boards; write one
fact per durable finding, **failures first** — a metric that moved without a writer
becomes a fact naming the mechanism; expire facts unverified for 90 days; emit skill
candidates. One PR; "no delta" is stated, never left silent.

## 5. Async contract

Cross-unit interaction is loops ([[guest-experience-loops]]), NF-A events, vault PRs,
and skill candidates only. Gap rows, stated rather than assumed away:

| Gap | Why it is a gap |
|---|---|
| `nf_b.event_emitted` has no publisher | The guest partial index exists and nothing writes it; only `subject_type='agent'` is emitted anywhere (`model-client.service.ts:415`, `services/agent-orchestrator/services/neural_footprint.py:108`). The weekly schedule is the only real trigger |
| Escalation to Product & Vision is a doc edit, not an event | Acceptable async path (vault PR), but nothing notifies — their schedule must poll [[guest-experience-agenda-full]] §Questions |
| OD-05 / OD-07 movement has no publisher | Both are founder forks tracked in [[OPEN-DECISIONS]]; the `od-07-watch` job reads a document. A fork that closes quietly is invisible to this stack until the next weekly run |
| The unhomed operator signal has no consumer | `recommendation_actions` is the richest human-preference data in the repo and the migration now carries `subject_type='operator'` (`:21-24,:56-59`) with **zero emitters** — the charter's flag is half-answered in schema and unanswered in code. Not this sub-layer's to claim |

## 6. Evidence today

- **NEW — the orchestrator and both skills.** Nothing rolls these boards up; the
  agenda-board Dataview renders and does not escalate.
- **EXISTS — the guard substrate it reads.** `.github/workflows/schema-parity.yml:185-212`
  runs `eval_guest_merge_policies.py` plus both PII guards on every commit. This
  **corrects** [[guest-identity-consent-charter]] §Evidence gap 2, which recorded the
  gate as available-but-unwired on 2026-08-24.
- **EXISTS, unwritten — the NF production store.** `neural_footprint_event` shipped
  2026-08-24 with a guest partial index (`:51-54`). Zero guest rows, by decision.
- **NEW — everything in §4.** No `memory/` directory exists for any unit; creating one
  is build, not this artifact ([[0034-agent-stack-artifact]]).
