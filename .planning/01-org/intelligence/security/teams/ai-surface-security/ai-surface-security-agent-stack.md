---
type: agent-stack
division: intelligence
department: security
team: ai-surface-security
status: designed
updated: 2026-08-27
metrics: [nf_a.unauthenticated_inference_spend, sec.injection_corpus_size, sec.corpus_detection_rate, sec.autonomous_send_rate, sec.tenants_with_inference_budget, sec.model_callsites_emitting_cost]
links: ["[[ai-surface-security-charter]]", "[[ai-surface-security-schedule]]", "[[ai-surface-security-loops]]", "[[ai-surface-security-premortem]]", "[[0034-agent-stack-artifact]]", "[[security-agent-stack]]", "[[action-safety-the-human-gate-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[evaluation-doneability-charter]]", "[[skills-charter]]", "[[red-team-charter]]", "[[OPEN-DECISIONS]]"]
---

# AI Surface Security — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team exists from day one, unmerged. Its agent's exposure is live and its primary
> metric is unmeasurable, so the card is built around the three proxies that need no
> telemetry — and around one hard prohibition: **it never sends, never flips an autonomy
> switch, and never edits a prompt.** An agent that could rewrite the prompt it is
> attacking has stopped being a test.

**The seam, stated once.** The mutation gate — `ask → propose → confirm → execute`, and
the confirm step itself — is [[action-safety-the-human-gate-charter]]'s mechanism, not
ours. This stack reads the charter's allowlist boundary as: *they own the gate; we classify
whether hostile content can steer what reaches it, and file the finding.* If that reading
is wrong it is a charter correction, not a card change — recorded in §5, not resolved here.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `ai-surface-sentinel` | Fire the adversarial corpus at the real prompts, keep the two corpus numbers and the three spend/autonomy proxies true across all seven model callsites, and classify what hostile content can reach — never patching the surface it probes | NEW |

One row. The corpus run and the prompt-content audit read the same seven callsites and the
same prompt assembly; and the charter's refusal of an `ai-red-team-agent` applies to any
second agent proposed while `sec.injection_corpus_size` is still 0.

## 2. Agent cards

```yaml
agent: ai-surface-sentinel
unit: ai-surface-security
triggers:
  - topic: pr.prompt_or_callsite_changed   # publisher: NONE (gap — no CI check watches prompt strings or new model fetches)
  - schedule: "monthly — corpus run; spend + autonomy report; dependency escalation"   # mirrored in [[ai-surface-security-schedule]]
  - schedule: "quarterly — prompt/log content audit, two callsites, deepest first"
consumes:
  - the seven production model callsites          # publisher: the repo — consultants, inbound-responder, document-extractor, scan-parser, photo-count, vendor-page-extractor, ux-optimizer
  - "the guardrail set at inbound-responder.service.ts:283,895-920 and the quarantine at :432-456"   # publisher: the repo
  - the adversarial corpus                        # publisher: NONE (gap — size 0; building it is deliverable #1)
  - nf_a cost/token events                        # publisher: NONE (gap — 0 of 7 callsites emit; [[neural-footprint-instrumentation-charter]] is the named future publisher, OD-11 gates the column contract)
emits:
  - "sec.injection_corpus_size + sec.corpus_detection_rate, always as a pair; plus sec.tenants_with_inference_budget, sec.autonomous_send_rate, sec.model_callsites_emitting_cost (0 of 7)"   # consumer: [[ai-surface-security-agenda-board]], rolled up by [[security-agent-stack|sec-orchestrator]]
  - "sec.days_dependency_open, reported as an integer"    # consumer: [[neural-footprint-instrumentation-charter]]
  - "findings where hostile content can steer an action"  # consumer: [[action-safety-the-human-gate-charter]] — they own the gate, we classify what reaches it
  - "what enters a prompt and what leaves in a log; nf_a events (task_type: ai_surface_probe)"   # consumers: this team's memory PRs, [[compliance-privacy-charter|compliance-charter]] on personal-data questions, NF-A tables
routing_class: judgment          # "was this output attacker-steered?" is a call, not a count
quality_bar: "two numbers or the run failed — a detection rate without the corpus size is a failed run; a run where every case passes is reported *suspicious*, not green, because that usually means the corpus was tuned to the model ([[ai-surface-security-schedule]]). Opposite pass condition to [[evaluation-doneability-charter]]: they want a high score, we want a failing case"
autonomy:
  read: autonomous
  propose: autonomous            # corpus cases, findings and budget specs land as PRs
  mutate_stock_money_outbound: confirm   # constant — and here it is load-bearing, not nominal: this surface already sends vendor email
memory: ai-surface-security
escalates_to: "[[security-charter]]"
```

**The card's own hard rule:** the sentinel never sends a reply, never sets or clears
`injection_suspected`, never changes a per-restaurant autonomy switch, and never edits a
prompt string. It fires cases and reports. Owning both the detector and its test is the
grading-your-own-homework failure the charter uses to refuse a
`prompt-injection-classifier`.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `injection-corpus-run` | T2 | Per PR touching a prompt string, a model callsite, or a parser of untrusted input; monthly across the corpus | Corpus size **and** detection rate, plus per-family and per-callsite coverage; an all-pass run is flagged suspicious | `injection_suspected` shipped, quarantines correctly (`inbound-responder.service.ts:432-456`), is never lifted by sender trust (`:95-96`) — and has been tested **only for plumbing**: `inbound-responder.service.spec.ts:248-263` asserts a mocked flag propagates. No hostile text has ever been put in front of the real prompt | NEW |
| `prompt-content-audit` | T2 | Quarterly, two callsites per run; per PR changing what enters a prompt payload or evidence pack | Per callsite: what enters the prompt, what is logged, which fields are personal or guest data, whether a secret can reach the payload. **A prompt assembled dynamically and not enumerable is a FAILED audit**, not a skipped one | `consultants.service.ts:154-176` ships an analytics evidence pack that increasingly includes check- and table-level data, while the repo prices a false guest merge as "a DISCLOSURE — one person's dining history, spend" (`eval_guest_merge_policies.py:28-30`) and takes real care at the storage layer (`20260819000000_guest_identity_minimal_slice.sql`). The care stops at the prompt boundary | NEW |

Consumed, owned elsewhere: the gate contract ([[action-safety-the-human-gate-charter]]);
cost instrumentation ([[neural-footprint-instrumentation-charter]]); output-quality
grading ([[evaluation-doneability-charter]]); registry governance ([[skills-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue,
  §3.3 gate unchanged.
- **Episodic** — nf_a `task_type: ai_surface_probe`, with `context.callsite` and
  `context.attack_family` as jsonb keys so "which family stopped being detected after a
  prompt change" is one filter. The cost fields the primary metric needs are **not emitted
  by any of the seven callsites**, so until they are, this layer is corpus runs and audits.
- **Semantic** — `memory/` beside this file, `ai-surface-security-MEMORY.md` as index.
  Founding facts, already known: the description of this system's posture is wrong — the
  class docstring says *"It never sends; the manager approves with one tap"* (`:156-157`)
  while `:509-513` computes `willAutoSend = autonomyFull && !flags.needs_approval` and
  schedules a real send after a two-minute undo window (`:26`); and the detector is
  self-reported (`:693` instructs the model to set the flag, `:832` parses its answer).
  Provenance per ADR 0034; every write a PR.
- **Working** — the card, the MEMORY index, charter §Mandate and §Metrics. The seven
  callsites and the guardrail block are retrieval targets by `path:line`, never preloaded.

**Consolidation** — monthly, mirrored in [[ai-surface-security-schedule]]: **failures
first** — every case the corpus caught becomes a fact naming the mechanism that let it
through, and a *flat* detection rate against a growing corpus becomes a fact about padding,
not a milestone ([[ai-surface-security-premortem]] M1). A callsite added without cost
instrumentation becomes a fact the month it lands. Expire facts unverified for 90 days;
propose skill candidates. One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction: board rows to the department (vault PR), NF-A events, loops in
[[ai-surface-security-loops]], skill candidates. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `nf_a.unauthenticated_inference_spend` has no publisher | 0 of 7 callsites emit cost events; grepping `apps/api-gateway/src` for `api_spend`, `cost_usd`, `input_tokens` returns nothing. [[neural-footprint-instrumentation-charter]] is a **hard dependency**, escalated monthly as an integer, and OD-11 gates the column contract. **The primary metric stays unmeasurable here** |
| `pr.prompt_or_callsite_changed` has no publisher | Nothing flags a new `api.anthropic.com` fetch; the eighth callsite arrives uninstrumented by default. The monthly run bounds the blind spot at 30 days |
| The corpus itself has no publisher | `sec.injection_corpus_size` = 0. Every number on this card except the callsite count depends on a deliverable that does not exist |
| The allowlist seam is stated, not settled | [[ai-surface-security-charter]] §Boundaries claims allowlist enforcement; [[action-safety-the-human-gate-charter]] owns the gate. This card takes the narrow reading (see header). Reconciling the two charters is a correction for their owners, **left open** |
| Findings reach [[action-safety-the-human-gate-charter]] as a doc edit | No event; their schedule must poll ours |

## 6. Evidence today

- **NEW — the sentinel, both skills, the corpus, the budgets, the allowlist enforcement,
  and everything in §4.** The charter grades the team `new` deliberately; calling any of
  this `partial` would credit a posture we do not have.
- **EXISTS — the exposure.** `POST /analytics/consult/:restaurantId` reaching
  `consultants.service.ts:154-176` on the founder's key, with the toggle gating it
  unguarded too; the only brake was `ai: 20/60s` backed by an in-memory `Map`
  (`rate-limit.guard.ts:31,65-70`). Fixed on `fix/analytics-endpoint-auth` (`99da5eb`);
  `foundation/README.md` §2.3 records it closed in PRs #31/#32 — **OD-20 stays open here**
  until this agent's own reading says so.
- **EXISTS — a real, partial control.** The quarantine (`:432-456`), never lifted by trust
  (`:95-96`), plus a thoughtful guardrail set (`:283`, `:895-920`) including
  DKIM/DMARC-unverified senders and commercial-terms inconsistency. Two findings sit on top
  of it: the detector is self-reported, and the auto-send path contradicts the docstring.
- **PARTIAL — the tests.** `inbound-responder.service.spec.ts:248-263` and
  `email-triage.spec.ts:205-212` assert plumbing only.
- **`sec.model_callsites_emitting_cost` = 0 of 7. That is the finding, not a missing row.**
