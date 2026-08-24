---
type: loops
division: intelligence
department: security
team: ai-surface-security
status: provisional
metrics: [sec.injection_corpus_size, sec.corpus_detection_rate, sec.autonomous_send_rate, sec.tenants_with_inference_budget, nf_a.unauthenticated_inference_spend, sec.model_callsites_emitting_cost]
updated: 2026-08-24
links: ["[[ai-surface-security-charter]]", "[[ai-surface-security-premortem]]", "[[ai-surface-security-directive]]", "[[ai-surface-security-agenda-board]]", "[[security-loops]]", "[[neural-footprint-instrumentation-charter]]", "[[evaluation-doneability-charter]]", "[[access-control-tenant-isolation-loops]]", "[[compliance-privacy-charter|compliance-charter]]", "[[red-team-charter]]", "[[LOOP-MAP]]"]
loop_count: 4
loop_count: 4
loop_count: 4
loop_ids: ["ais-corpus-growth", "ais-bounded-spend-and-autonomy", "ais-cost-telemetry-dependency", "ais-prompt-content-audit"]
loop_close_times: ["monthly", "monthly", "monthly", "quarterly"]
loop_statuses: ["proposed", "proposed", "blocked", "proposed"]
---

# AI Surface Security — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Four loops. Three monthly — model behaviour does not change week to week, and a weekly
corpus review would generate motion rather than signal. One quarterly, for content audit.

---

## L-AIS-1 — Corpus growth and detection rate

```yaml
type: loop
id: ais-corpus-growth
owner: ai-surface-security
measures: [sec.injection_corpus_size, sec.corpus_detection_rate, sec.corpus_families_covered, sec.callsites_with_corpus_coverage]
changes: [orchestrator.injection_policy, orchestrator.guardrail_set, ci.injection_suite]
inputs_from: [red-team, evaluation-doneability, perimeter-ingress-integrity]
outputs_to: [security, engineering, ai-orchestration, decision-office]
close_time: monthly
status: proposed
```

Counters **M1**. Baselines: size **0**, detection rate **undefined**, callsites covered
**0 of 7**.

**The two numbers are read together or not at all.** A corpus growing at a flat detection
rate is being padded with cases the model already passes; a detection rate rising while
size is flat means the corpus is being tuned to the model rather than to the attacker —
[[ai-surface-security-directive]] makes the second an escalation.

`sec.callsites_with_corpus_coverage` prevents the natural drift toward the interesting
channel. `inbound-responder` will attract all the attention; `vendor-page-extractor`
(scraped HTML into a prompt) and `document-extractor` (attacker-supplied files) are the
indirect-injection channels where no human reads the input at all.

Inputs from [[red-team-charter]] quarterly on coverage: *what attack is not in here?*

---

## L-AIS-2 — Bounded spend and the human-in-the-loop claim

```yaml
type: loop
id: ais-bounded-spend-and-autonomy
owner: ai-surface-security
measures: [sec.tenants_with_inference_budget, sec.autonomous_send_rate, sec.effective_ai_tier_limit, sec.doc_code_divergences_open]
changes: [security.inference_budget_policy, orchestrator.autonomy_switch_policy, docs.responder_claims]
inputs_from: [perimeter-ingress-integrity, access-control-tenant-isolation, insight-narrative-generation]
outputs_to: [security, engineering, decision-office, strategy]
close_time: monthly
status: proposed
```

Counters **M2** and **M4** — two mechanisms in one loop because they share a failure shape:
**a control someone else owns is mistaken for our mitigation.**

`sec.tenants_with_inference_budget` (today **0**) is the honest answer to "is
denial-of-wallet closed?" — not the guard's merge status.
`sec.effective_ai_tier_limit` arrives from
[[perimeter-ingress-integrity-loops]]'s L-PII-3 as `20/60s × instances`, and is cited that
way or not at all.

`sec.doc_code_divergences_open` is **1** today: `inbound-responder.service.ts:156-157` says
the service never sends, `:509-513` schedules a send after a two-minute undo window
(`:26`). That divergence propagated into a division planning document as evidence
(`intelligence.md:318-320`), which is why it is tracked as a security measure rather than a
documentation chore.

---

## L-AIS-3 — The blocked dependency, counted in days

```yaml
type: loop
id: ais-cost-telemetry-dependency
owner: ai-surface-security
measures: [sec.days_dependency_open, sec.model_callsites_emitting_cost, nf_a.unauthenticated_inference_spend]
changes: [security.escalation_queue, security.inference_budget_policy]
inputs_from: [neural-footprint-instrumentation, harness-model-routing]
outputs_to: [research-math, security, decision-office]
close_time: monthly
status: blocked
```

Counters **M3**. `status: blocked` is set in the frontmatter deliberately, and
`sec.days_dependency_open` is a **measure** rather than a note — the entire purpose of this
loop is that a blocked dependency accrues a visible integer instead of becoming prose in a
status update.

`sec.model_callsites_emitting_cost` is **0 of 7**. The contract is named at
`intelligence.md:488`: *"SEC-3's primary metric is unmeasurable until NestJS model calls
emit cost events. **Hard dependency, not a nice-to-have.**"*

**The loop still closes monthly while blocked**, and what it reports is the day count plus
the crude substitute from L-AIS-2. A blocked loop with a close-time is a functioning
escalation; a blocked loop quietly marked `proposed` is a lie with a cadence.

---

## L-AIS-4 — Prompt and log content audit

```yaml
type: loop
id: ais-prompt-content-audit
owner: ai-surface-security
measures: [sec.callsites_with_prompt_audit, sec.pii_fields_in_prompts, sec.request_body_log_sites]
changes: [security.prompt_hygiene_policy, orchestrator.log_redaction]
inputs_from: [compliance, neural-footprint-instrumentation, insight-narrative-generation]
outputs_to: [security, compliance, engineering, decision-office]
close_time: quarterly
status: proposed
```

Counters **M5**. Baseline **0 of 7** callsites audited; §12C item 10 (careful request-body
logging) is `unmeasured`.

Quarterly because a prompt-content audit is a deep read of seven services, not a check.
Start with `consultants.service.ts` and `inbound-responder.service.ts` — widest inputs, and
the analytics evidence pack increasingly includes check-level data.

The severity precedent is already set in this repo:
`eval_guest_merge_policies.py:28-30` prices a false guest merge as *"a DISCLOSURE — one
person's dining history, spend"*, and the identity substrate takes real care at the storage
layer (peppered channel hashes, an erasure column in
`20260819000000_guest_identity_minimal_slice.sql`). **None of that care currently extends
to what goes into a prompt.**

Outputs to [[compliance-privacy-charter|compliance-charter]] because lawful basis is theirs; the leak path stays ours.

---

## Close-time summary

| Loop | Close-time | Counters | Status |
|---|---|---|---|
| L-AIS-1 corpus growth and detection rate | monthly | M1 | proposed |
| L-AIS-2 bounded spend + autonomy claim | monthly | M2, M4 | proposed |
| L-AIS-3 cost-telemetry dependency | monthly | M3 | **blocked**, counting days |
| L-AIS-4 prompt and log content audit | quarterly | M5 | proposed |

**Three of four need nothing from anyone else to start.** That is deliberate: a team whose
first quarter depends on another team's schema decision spends its first quarter waiting,
and [[ai-surface-security-premortem]] M3 is what waiting turns into.
