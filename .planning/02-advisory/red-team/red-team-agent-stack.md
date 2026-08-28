---
type: agent-stack
division: advisory
department: red-team
status: designed
updated: 2026-08-27
metrics: [rt.finding_return_hours, rt.locked_decision_challenge_rate, rt.reaffirmation_rate, rt.finding_actionability, rt.open_finding_age_days, rt.undeclared_decision_count, rt.self_selected_target_share, nf_a.doneability_verdict]
links: ["[[red-team-charter]]", "[[red-team-schedule]]", "[[red-team-loops]]", "[[red-team-premortem]]", "[[red-team-directive]]", "[[red-team-questions]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[decision-office-charter]]", "[[architecture-review-charter]]", "[[security-charter]]"]
---

# Red Team — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> Advisory sits **outside the line**, **findings-only, locked** ([[ORG_STRUCTURE]] §3,
> OD-16): read anything, propose findings, own nothing. This is the most constrained card
> of the three, for the reason [[red-team-schedule]] states outright — **every skill this
> function proposes is a reader or a checker, and none generates a finding**; a skill that
> drafts objections is [[red-team-premortem]] M1 with a cron entry. Mechanisms referenced
> only — harness → [[harness-runtime-charter]] (**OD-03 open**), model choice →
> [[model-routing-inference-economics-charter]], mutation gate →
> [[action-safety-the-human-gate-charter]], skills → [[skills-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `rt-target-scout` | Keep the attack queue and the 7-finding cap honest — surface targets from the four intake channels, compute the countable half of the score, check finding format and the return clock — and never run the attack | NEW |

One row, and its boundary is the point: the reconstruction step ([[red-team-directive]]
phase 2) is the judgement this function exists for, and an agent that performed it would be
attacking on the strength of whatever it retrieved first.

## 2. Agent cards

```yaml
agent: rt-target-scout
unit: red-team
triggers:
  - topic: decision.locked   # publisher: NONE (gap — nothing emits when an ADR reaches Locked, and O1's 7-day window is the tightest clock in the advisory layer)
  - schedule: "weekly — target selection and cap check"       # [[red-team-schedule]]
  - schedule: "monthly — undeclared-decision sweep (L-RT-3)"
  - schedule: "quarterly — premortem signal check, self-audit pair"
consumes:
  - "decisions/0001…0034 — locked ADRs, channel C1 (publisher: whoever locks one)"
  - "decisions/OPEN-DECISIONS.md §Open — channel C2 (publisher: [[decision-office-charter]])"
  - "82 referral lines across 67 units naming [[red-team-charter]] — channel C3 (publishers: the referring units)"
  - "01-org/ + 02-advisory/ prose — channel C4; no publisher by design, it is a sweep"
emits:
  - "finding shells (target, owner, channel, three countable factors) → [[red-team-questions]] (consumer: this function's human attack step)"
  - "completed findings into the target unit's <slug>-questions.md within 72h (consumer: that unit)"
  - "review-trail rows on the attacked ADR (consumer: [[decision-office-charter]])"
  - "registration requests for undeclared decisions (consumer: [[decision-office-charter]])"
  - "the rt.reaffirmation_rate × rt.finding_actionability pair, quarterly, never separately (consumer: founder)"
  - "nf_a events (task_type: rt_target_scan)"
routing_class: extraction     # enumerate candidates and count citations; the ranking that matters is not this agent's
quality_bar: "the format gate — a finding with no named owner or with ≠1 next action is rejected inside this function ([[red-team-directive]] R4). nf_a.doneability_verdict is named on the charter but has no basis for this task type yet (the first, reconciliation_v1, went live 2026-08-25) — PARTIAL, not a reading"
autonomy:
  read: autonomous
  propose: autonomous         # finding shells and registration requests land as PRs
  mutate_stock_money_outbound: confirm   # constant; this agent has no such surface
memory: red-team
escalates_to: "founder (the quarterly pair, per [[red-team-schedule]]); [[decision-office-charter]] for findings at 30 days (L-RT-6)"
```

**Three hard rules on the card.** (1) It computes `blast_radius`, `evidence_strength` and
`freshness` — all countable — and leaves **`irreversibility` blank for a human**. An agent
that scored irreversibility would be ranking targets, which is the attack's first move.
(2) It never fills a finding's reconstruction or verdict. (3) It never cites a
controller's `path:line` as a *subject*: Security attacks systems, Red Team attacks
reasoning ([[red-team-premortem]] M5), and that line is founder-scoped
(`ORG_STRUCTURE.md:61`).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `undeclared-decision-sweep` | T2 | Monthly (L-RT-3) | Every decision-shaped paragraph with no ADR/OD id listed as a candidate; locally staged fork IDs absent from the register named | **`OD-C1`–`OD-C8`** staged inside Corporate's unit documents, none in the register; `OD-C5` alone cited **38×** | NEW |
| `decision-index-reconcile` | T2 | Monthly; any ADR added or superseded | `decisions/README.md` matches the files on disk and the register's row count | `decisions/README.md:45` said *"8 items"* against 23 open rows; `:29` said *"5 divisions, 20 departments"* against ADR 0007's 6 / 19 | NEW |
| `split-merge-trigger-audit` | T2 | Quarterly | Every charter naming a split trigger without a merge or retirement trigger listed | **OD-26** measured 11 split / 3 merge; a re-measurement hours later read **15 / 3** — the asymmetry widened while the fork sat open | NEW |

**Five proposed skills are not rows here, and that is the protocol working.**
`finding-format-gate`, `finding-return-clock`, `assumption-extract`,
`premortem-signal-check` and `ratchet-metric-pair` have **no past instance** — no finding
has ever been filed under this name — so under [[README|foundation-README]] §3.3 rule 3 they
may not be written until the function has run one real attack cycle. Repeating that here
rather than quietly promoting them is the whole test. Tiers are [[skills-charter]]'s.

## 4. Memory

- **Procedural** — the §3 skills; consolidation candidates go to
  [[skill-harvesting-charter]]'s queue and still face the §3.3 gate.
- **Episodic** — nf_a `task_type: rt_target_scan`, one event per selection cycle and per
  sweep. Needs `context.decision_id` and `context.channel` (C1–C4) as jsonb keys so
  `rt.self_selected_target_share` is one filter, not a hand-count — the metric exists to
  catch this function becoming a referral desk (M4), and a metric computed by hand will not
  be computed.
- **Semantic** — `memory/` beside this file, `red-team-MEMORY.md` as index, one fact per
  file with `source` / `confidence` / `last_verified`. Its founding facts are the
  reaffirmation precedents, because they are what a healthy loss looks like:
  `0001-mudavym-single-entity.md:50` (challenged, argued, reaffirmed on the record),
  `0007-org-structure.md:84-88` (Claude's 9-department proposal overruled, both recorded),
  `0006-neural-footprint-architecture.md:80-83` (NF-C argued down to a gated track). Every
  write is a PR.
- **Working** — this card, the MEMORY index, charter §How a target is selected, the finding
  format. The target document is loaded **at the reconstruction step, not before**:
  [[red-team-directive]] phase 2 opens the assumptions before the evidence, and preloading
  the evidence inverts that order.

**Consolidation** — quarterly, alongside the self-audit and mirrored in
[[red-team-schedule]]: read the cycle's slice; write one fact per durable finding,
**failures first** — an attack that produced no actionable next step becomes a fact naming
the mechanism (target chosen by arrival order, evidence never opened, owner never named),
never "low yield"; expire facts unverified 90 days; propose skill candidates. One PR;
"no delta" is stated.

## 5. Async contract

Cross-unit interaction is loops ([[red-team-loops]] — six, per-event through quarterly,
all `proposed`), NF-A events, vault PRs, and skill candidates. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `decision.locked` has no publisher | Nothing emits when an ADR reaches Locked, so O1's 7-day window is watched only by the weekly selection job — which can miss it by six days. **25 ADRs already carry a Locked status** and the window has passed on every one |
| `rt.finding_return_hours` has no instrument | The 72-hour leg needs `finding-return-clock`, which is ineligible under §3.3 until a finding exists. The metric is real; the measurement is not, and calling it a reading would be the M2 lie |
| The 7-finding cap has no store | Open findings are counted from the `questions.md` files, which hold **zero rows** today — so the cap is vacuous rather than binding, and will bind for the first time without warning |

## 6. Evidence today

- **NEW — the scout, the queue, the format, the cap, all three skills.** No attack has been
  run and no finding filed under this name.
- **EXISTS — the surface, grown since the charter.** The charter counted 7 ADRs and 23 open
  forks; today `decisions/` holds **34** ADRs (`0001`–`0034`, 25 Locked) and
  `OPEN-DECISIONS.md` **39** open rows. C3 remains **82 referral lines across 67 units** —
  inbound demand that predates the first finding.
- **EXISTS — the delivery target, since the charter was written.** The charter grades
  `questions.md` as "zero exist"; every unit now has one, created 2026-08-24 by
  `scripts/build_questions_files.py` under OD-41, carrying the 42-day escalation rule.
- **PARTIAL — `nf_a.doneability_verdict`.** Emission shipped in P1; verdict coverage is near
  zero outside `reconciliation_v1` (2026-08-25,
  [[0017-doneability-verdicts-are-sidecar-claims]]). A dependency, not a reading.
- **NEW — the track record.** The charter's closing sentence holds: this function is a
  hypothesis, and the first thing it should do once it exists is attack this charter — and
  this card.
