---
type: agent-stack
division: corporate
department: compliance-privacy
status: designed
updated: 2026-08-27
metrics: [privacy.erasure_completeness, privacy.pii_definition_count, privacy.consent_call_sites, privacy.consent_gate_denials, compliance.obligation_coverage, compliance.subprocessor_classification, compliance.notice_accuracy, nf_b.research_store_erasability]
links: ["[[compliance-privacy-charter]]", "[[compliance-privacy-schedule]]", "[[compliance-privacy-loops]]", "[[compliance-privacy-agenda-board]]", "[[0034-agent-stack-artifact]]", "[[privacy-engineering-agent-stack]]", "[[regulatory-posture-agent-stack]]", "[[regulated-operations-agent-stack]]", "[[action-safety-the-human-gate-agent-stack]]", "[[skills-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]"]
---

# Compliance & Privacy — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> Department stacks orchestrate the unit, not the teams' work. Two seams are held
> strictly here: this department **says** what belongs on the action allowlist for
> guest PII and [[action-safety-the-human-gate-charter]] **enforces** it — we never
> re-own enforcement; and **nothing legal or regulatory is filed, signed, or sent by
> an agent.** Cards here analyse, classify, and propose.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `cp-orchestrator` | Roll the three team metric sets onto one board **as a set, never an average**, run the quarterly regulated-operations trigger check the dormant team cannot own, and carry allowlist and register deltas as PRs | NEW |

One row. The three teams already own the technical control, the obligation and the
excise track; a department agent doing any of that work is the duplication the
charter's §Team roster test exists to catch.

## 2. Agent cards

```yaml
agent: cp-orchestrator
unit: compliance-privacy
triggers:
  - schedule: "monthly — board rollup, in the agenda-sync window"    # [[compliance-privacy-schedule]]
  - schedule: "quarterly — the regulated-operations trigger check"   # [[compliance-privacy-schedule]]; owned here because a team with no staff cannot own a job
  - topic: instrument.data_clause_received   # publisher: NONE (gap — no intake exists; zero instruments have ever arrived)
consumes:
  - "the three team agenda-boards: [[privacy-engineering-agenda-board]], [[regulatory-posture-agenda-board]], [[regulated-operations-agenda-board]]"
  - "[[compliance-privacy-loops]] and its six close_times (erasure-completeness, pii-definition-convergence, consent-propagation, obligation-register-currency, purpose-widening-review, guest-identity-ci-guards)"
  - CI verdicts from the two guest-identity guards and the merge-policy eval — publisher EXISTS, `.github/workflows/schema-parity.yml:149,152-154`
  - nf_a events sliced by this department's task types (ADR 0006/0008)
emits:
  - "[[compliance-privacy-agenda-board]] rollup — the metric SET. Averaging one strong team, one verified zero and one stub hides the finding (charter §Evidence)"
  - "the guest-PII action-allowlist statement → consumed by [[action-safety-the-human-gate-agent-stack|gate-auditor]], which already records it as 'owned elsewhere'"
  - "regops trigger verdict → regops.trigger_check_freshness → [[regulated-operations-agent-stack]]"
  - "accepted gaps → [[red-team-charter]] quarterly adversarial review (the independence mechanism for premortem M5)"
  - nf_a events (task_type: dept_board_rollup; needs context.team as a jsonb key so a per-team slice is a filter, not a join)
routing_class: extraction     # reading boards, counting, and diffing citations. Whether a newly-found pattern IS personal data is judgement and belongs to [[privacy-engineering-agent-stack|pii-store-classifier]]
quality_bar: "every board row carries a measured value or the words 'not emitted' (ADR 0020). With 0 consent call sites and no erasure function, most rows read 'not emitted' today — that is the correct output, not a failure of the agent"
autonomy:
  read: autonomous
  propose: autonomous          # board edits, allowlist deltas, escalations — all PRs
  mutate_stock_money_outbound: confirm   # constant; this agent has no such surface
memory: compliance-privacy
escalates_to: "[[decision-office-charter]] for CORP-F2, CORP-F4 and the unregistered NF-B erasability question; a suspected disclosure goes to [[security-charter]] as an incident"
```

**The card's own hard rules.** (1) It **files, signs, sends and answers nothing** — no
DPA verdict of record, no questionnaire response, no regulator contact. (2) It
**proposes** the allowlist statement; adopting it is a human act recorded in the
charter. (3) It never widens a purpose: premortem M5 is that this department reviews
its own use of guest data, so a widening proposal routes to [[red-team-charter]] and
the founder, never to self-approval.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|

**Empty — no procedure this department has actually repeated at department level.**
[[compliance-privacy-schedule]] rules three candidates ineligible on §3.3 rule 3
(`privacy-review-pass`, `dpa-annex-check`, `erasure-drill` — none ever run); the one
eligible, `pii-definition-audit`, belongs to a team and is carried in
[[privacy-engineering-agent-stack]] §3. The quarterly trigger check has run never.

Consumed, owned elsewhere: the skill envelope ([[skills-charter]]); the mutation gate
([[action-safety-the-human-gate-charter]]); doc staleness ([[standards-verification-charter]]).

## 4. Memory

- **Procedural** — nothing yet (§3). Candidates reach [[skill-harvesting-charter]]'s
  queue from the teams' consolidation runs, and still face the §3.3 gate.
- **Episodic** — nf_a `task_type: dept_board_rollup`, plus read access to
  `privacy_classification` and `obligation_mapping` (the two team families). **No
  episodic row may carry a PII specimen** — a department that logs a specimen into an
  append-only store it cannot erase has committed its own premortem.
- **Semantic** — `memory/` beside this file, index `compliance-privacy-MEMORY.md`.
  First facts, established and easy to re-mis-state: the schema has zero callers; four
  guards carry three definitions; the register's zero is verified, with the `CCPAE`
  Catalan-agriculture substring recorded as its known false positive. Provenance per
  ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. Team
  charters and the 564-line migration are retrieval targets by `path:line`.

**Consolidation** — quarterly, aligned to the trigger check and mirrored in
[[compliance-privacy-schedule]]: read the department's NF-A slice; one fact per durable
finding, failures first — a loop that missed its close_time gets a fact naming the
mechanism, not "slipped"; expire at 90 days unverified; propose candidates. One PR;
"no delta" is stated, never left silent.

## 5. Async contract

Board rows, memory PRs, NF-A events, skill candidates, and [[compliance-privacy-loops]]
— never a synchronous call. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `instrument.data_clause_received` has no publisher | No intake exists and no instrument has ever arrived. [[design-partner-operations-charter]]'s deal pipeline is the only early warning and it is a conversation, not an event |
| The allowlist statement has a consumer but no channel | `gate-auditor` names it "owned elsewhere"; nothing notifies them when it changes. Their schedule must poll this vault, which bounds the blind spot at their cadence |
| `nf_b.research_store_erasability` — **owner and mechanism both settled** (sweep completed 2026-08-28; this row previously said the fork was open and was missed by ADR 0035's first sweep — audit finding) | Owner: privacy-engineering, founder via ADR 0035 (loop + `loops.json` updated). Mechanism: **crypto-shredding**, founder via [[0037-nfb-erasure-is-crypto-shredding]] — with the team's own 2026-08-28 finding carried: the repo's key precedent (`guest_pepper()` HMAC-derivation) is structurally the opposite of per-guest destroyable keys, so implementation requires *stored* keys (their agenda D1 attacks this with architecture-review) |
| Two headline metrics have no producer | `privacy.consent_call_sites` is 0 and `privacy.erasure_completeness` has no test; the `consent-propagation` and `erasure-completeness` loops (close_time `per-event`) cannot close until something calls the schema |

## 6. Evidence today

- **EXISTS — the only live controls, and not ours by origin.**
  `check_no_guest_name_matching.sh`, `check_no_raw_guest_channels.sh` and
  `eval_guest_merge_policies.py` on push, PR and `cron: "0 6 * * *"`
  (`.github/workflows/schema-parity.yml:19-27,149,152-154`) — authored by the
  guest-identity work, not by this department.
- **EXISTS — the consent and erasure schema**
  (`20260819000000_guest_identity_minimal_slice.sql:54,58-64,79-82,131-145,375`).
  **PARTIAL — the PII substrate:** four guards, three definitions, no shared module.
- **NEW — the orchestrator, every board number, the allowlist statement as a written
  artifact, the obligation register, and all of §4.** The controls are real; the
  exercise of them is not, and this page refuses to let the first stand for the second.
