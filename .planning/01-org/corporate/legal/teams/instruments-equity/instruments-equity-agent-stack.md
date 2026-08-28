---
type: agent-stack
division: corporate
department: legal
team: instruments-equity
status: designed
updated: 2026-08-27
metrics: [legal.instrument_chain_integrity, legal.counsel_gate_compliance, legal.consent_record_completeness, legal.cap_table_tie_out_divergence]
links: ["[[instruments-equity-charter]]", "[[instruments-equity-schedule]]", "[[instruments-equity-loops]]", "[[instruments-equity-directive]]", "[[instruments-equity-premortem]]", "[[0034-agent-stack-artifact]]", "[[legal-agent-stack]]", "[[commercial-workforce-agreements-agent-stack]]", "[[skills-charter]]", "[[positioning-fundraise-readiness-charter]]"]
---

# Instruments & Equity — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The one-way-door team gets the most constrained card in this division: **its agent is a
> checker and owns no generative drafting skill, by design** ([[instruments-equity-directive]]
> IE-6). A checker that is wrong produces a false hold, which is annoying; a drafter that is
> wrong produces a plausible instrument, which is unrecoverable ([[legal-premortem]] M5).
> Drafting here is counsel's work, and **no agent signs, files or sends**.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `ie-chain-warden` | Refuse the `executed` transition when any leg of the chain is missing, refuse a consent dated after the action it authorises, and report cap-table divergence — drafting nothing, ever | NEW |

One row, and it is a **refusal surface, not a work surface**. This team is *armed rather
than running* (charter §Entry conditions); a larger roster would staff an empty register.

## 2. Agent cards

```yaml
agent: ie-chain-warden
unit: instruments-equity
triggers:
  - topic: instrument.entering_executed   # publisher: NONE (gap — there is no register and no state machine; the transition is a human saying so)
  - topic: board.action_recorded          # publisher: NONE (gap — no board record exists anywhere in the repo)
  - schedule: "monthly — verbal-commitment reconciliation (L-IE-4); ageing sweep on signed-not-executed"   # [[instruments-equity-schedule]]
  - schedule: "quarterly — cap-table tie-out (L-IE-2, every instrument and never a sample); retention check; activation check (L-IE-5)"
consumes:
  - the instrument register and the executed-original chain — NONE (gap): neither exists (charter §Evidence)
  - the cap table — NONE (gap): no cap table exists
  - the board and consent record — NONE (gap): no board record exists
  - "[[0001-mudavym-single-entity]]:38 — one entity, therefore exactly one cap table to tie out to"
emits:
  - "a HOLD on the executed transition, naming the missing leg → the founder, per [[instruments-equity-directive]] IE-1/IE-3"
  - "a refusal of any back-dated consent → legal.consent_record_completeness"
  - "legal.cap_table_tie_out_divergence → [[instruments-equity-agenda-board]] and the rollup in [[legal-agent-stack]]"
  - "a monthly list of names carrying a verbal commitment with no open request → the founder (empty is the good answer)"
  - nf_a events (task_type: instrument_chain_check)
routing_class: mechanical        # four legs present or not; a consent date before an action date or not. No judgment call exists in this loop, and no draft
quality_bar: "a hold is reproducible: rerun against the same register state yields the same verdict and names the same missing leg. NONE (gap) — ADR 0017 defines no grader for legal checks, and the terminal gate is human and absolute: outside-counsel review before signature ([[legal-directive]] R1, legal.counsel_gate_compliance target 100% permanently)"
autonomy:
  read: autonomous
  propose: autonomous            # holds, refusals and divergence lists land as register entries and PRs
  mutate_stock_money_outbound: confirm    # constant; equity is the company's stock, and this agent has no execution surface at all
memory: instruments-equity
escalates_to: "[[legal-charter]]"   # then OPEN-DECISIONS.md — any proposal to exempt an instrument from R1 or R2 escalates on the *first* request, not the tenth
```

**Two hard rules the card carries itself.** `ie-chain-warden` never drafts and never
infers a term — a request without the founder's written terms is a HOLD ([[legal-directive]]
R3). And when paper and cap table disagree, the correction is **always applied to the cap
table, never to the paper** ([[instruments-equity-schedule]]).

## 3. Skills

*Empty, and it is arithmetic rather than omission.* The register holds **0 of 0**
instruments (charter §Metrics), so the four checkers named in
[[instruments-equity-schedule]] — `instrument-chain-check`, `cap-table-tie-out`,
`consent-record-completeness`, `commitment-gap-scan` — have no past instance to cite: the
events they check have never occurred. A row before then is the speculative skill
README §3.3 rule 3 forbids, and this is the team where a plausible-looking artifact does
the most damage.

These checkers may legitimately **not fire for a quarter**, so the 30-day deletion review
is replaced by review at the quarterly activation check L-IE-5 — an exemption that dies
with the team if L-LEG-5 merges it.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]], Applied AI).

## 4. Memory

- **Procedural** — none yet (§3). Growth path is L-IE-5's quarterly activation check, not
  the 30-day cadence; the first checker to fire against a real instrument becomes a
  candidate in [[skill-harvesting-charter]]'s queue, still facing the §3.3 gate.
- **Episodic** — nf_a `task_type: instrument_chain_check`. Needs `context.instrument_type`,
  `context.missing_leg`, and the `consent_date` / `action_date` pair as jsonb keys, so the
  **ordering** property is a filter rather than a re-read of every consent. This layer is
  empty for whole quarters by design: no episodes here is a quiet register, not a broken
  agent.
- **Semantic** — `memory/` beside this file, one fact per file with `source` ·
  `confidence` · `last_verified`; index `instruments-equity-MEMORY.md`. File one is
  already known: **the repo contains a substantial codebase and no IP assignment** — an
  empty-register observation, not a legal opinion (source: charter §Evidence /
  `corporate.md:75-79`, 2026-08-24). File two: ADR 0001 fixes one entity, one cap table.
  Every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, the directive's gate list.
  Instruments are retrieval by register id; **executed originals are not in the vault at
  all**, they live at the retention location the quarterly check tests — by someone who is
  not the founder, because the failure caught is single-point retention.

**Consolidation** — quarterly, alongside the existing L-IE-5 activation check (that
schedule does not yet name a consolidation row; adding it is a one-line edit this artifact
does not make). Read the NF-A slice, **failures first**: a hold later overridden becomes a
fact naming which leg was missing and who overrode it — never "we proceeded"; expire facts
unverified 90 days; propose candidates. One PR. Monthly was rejected for the reason the
team has no weekly cadence: three no-action runs over an empty register get deleted.

## 5. Async contract

Loops ([[instruments-equity-loops]] — per-event, monthly, quarterly close_times), NF-A
events, vault PRs and skill candidates only. Gap rows:

| Gap | Why it is a gap |
|---|---|
| Both topics have no publisher | No register, no state machine, no board record. Until one exists, every trigger is the schedule, and a chain defect surfaces at the monthly ageing sweep at the earliest |
| The cap table has no home | `legal.cap_table_tie_out_divergence` cannot be computed against a table that does not exist. The baseline is **0 of 0, which is an unread score, not a good one** (charter §Evidence) |
| Verbal commitments have no publisher at all, and cannot get one | L-IE-4 reconciles equity promises made in conversation. Nothing emits "the founder promised someone equity" — which is why that loop is a human reconciliation and why the warden's monthly output is a list of *names*, not a diff |
| Requests arrive from a chartered unit, not a running one | [[positioning-fundraise-readiness-charter]] sequences and requests; Legal drafts. Nothing notifies either way — the request is a conversation |
| Holds are addressed to the founder as a doc edit | Acceptable async path (register entry / PR), but nothing pages. A hold on a raise-timeline instrument is the case where that latency costs most — [[instruments-equity-premortem]]'s pressure mechanism |

## 6. Evidence today

- **NEW — the warden, the register, the chain, the cap table, the board record, and all
  four checkers.** No cap table, no equity instrument and no board record exists anywhere
  in the repo (`corporate.md:75-79`); a filename sweep for
  `safe|cap.table|board.consent|term.sheet|stock|equity` returns no legal document.
- **EXISTS — exactly one adjacent fact.** [[0001-mudavym-single-entity]]:38 — *"One brand,
  one legal surface, one doc graph"* — fixing that there is one entity to issue against
  and therefore one cap table. A useful constraint, and the only one.
- **EXISTS elsewhere, and deliberately does not cover this class.** The UCC commitment
  guardrail (canon `apps/api-gateway/src/common/orchestrator/commitment-patterns.ts`,
  generated `services/agent-orchestrator/core/commitment_patterns.py`, three drift guards
  including the blocking CI job `commitment-guardrail-sync` at
  `.github/workflows/ci.yml:58-74`; ADR 0013) stops **outbound message text** from forming
  a commitment. Nothing catches an equity promise made in conversation — precisely the
  hole L-IE-4 exists to reconcile by hand.
- **NEW — everything in §4** except the NF-A tables themselves (ADR 0006/0008/0017).
- **The trim flag applies here specifically** (`corporate.md:116-121`): the split is
  structural, not evidential. If L-LEG-5 fires, this card folds into [[legal-agent-stack]]
  and the six instruments become a class inside one roster row.
