---
type: loops
division: advisory
department: architecture-review
status: new
metrics: [arch.layer_violations_open, arch.finding_age_days_max, arch.findings_closed_by_decision_ratio, arch.duplicated_invariants, arch.diverged_invariant_count, arch.direct_provider_callsites, arch.layer_bypass_callsites, arch.handmade_ddl_objects]
updated: 2026-08-24
links: ["[[architecture-review-charter]]", "[[architecture-review-directive]]", "[[architecture-review-premortem]]", "[[architecture-review-schedule]]", "[[architecture-review-agenda-board]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[security-charter]]", "[[engineering-charter]]", "[[schema-migrations-charter]]", "[[client-surfaces-charter]]", "[[platform-api-charter]]", "[[messaging-delivery-charter]]", "[[research-math-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[model-routing-inference-economics-charter]]", "[[LOOP-MAP]]", "[[ORG_STRUCTURE]]", "[[README]]"]
loop_count: 5
loop_count: 5
loop_ids: ["loop-layer-sweep", "loop-finding-age", "loop-invariant-census", "loop-callsite-convergence", "loop-layer-stack-review"]
loop_close_times: ["fortnightly — sweep on the 1st and the 15th; a signal seen in a sweep becomes a written finding inside that same sweep or is dropped", "fortnightly to re-report; 42 days (three sweeps) to force a binary", "fortnightly for the census itself (one invariant per sweep); per-commit for any invariant that earns a CI check", "monthly", "quarterly — on the calendar whether or not anything has gone wrong"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Architecture Review — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a diagram,
not a loop ([[ORG_STRUCTURE]] §5).

> **Honesty note on `status`.** All five loops below are `proposed`. **None closes today**,
> because this function is graded NEW without qualification
> ([[architecture-review-charter]] §Evidence) — there is no finding log to age, no layer
> map to check against, and no destination for a finding to land in (AR-0). A loop is not
> made real by being written down.
>
> The one mechanism in this repo that *does* close a layer-boundary loop by itself belongs
> to [[schema-migrations-charter]], not to us. It is listed under §Loops we read, and it is
> the shape every loop here should be built in.

---

## 1. The layer sweep — the cadence itself

```yaml
type: loop
id: loop-layer-sweep
owner: architecture-review
measures: [arch.layer_violations_open, arch.layer_bypass_callsites, arch.duplicated_invariants]
changes: [findings.log, open_decisions.queue]
inputs_from: [engineering, data, reliability-sre, ai-orchestration, skills, product-vision, design, partnerships-integrations]
outputs_to: [engineering, ai-orchestration, product-vision, decision-office]
close_time: fortnightly — sweep on the 1st and the 15th; a signal seen in a sweep becomes a written finding inside that same sweep or is dropped
status: proposed
blocked_by: "AR-0 — a finding has no defined destination (ORG_STRUCTURE §3 names questions.md; no such file exists in any of the 99 units)"
rotation: "Sweep N reviews one division on a published rotation — Platform, Applied AI, Product — plus any cross-cutting finding. A skipped rotation is reported as skipped, never absorbed (premortem #5)."
budget: "A small number of findings per sweep, deliberately. A sweep producing a dozen findings has stopped ranking and started listing, and a list is what people mute (premortem #3)."
note: "The close-time is the honest one: fortnightly is how fast a SIGNAL BECOMES A FINDING. It is emphatically not how fast a violation gets fixed — this function cannot close that loop, and pretending otherwise is the theatre premortem #1 describes."
```

## 2. Finding age — the anti-theatre loop

```yaml
type: loop
id: loop-finding-age
owner: architecture-review
measures: [arch.finding_age_days_max, arch.findings_closed_by_decision_ratio, arch.findings_closed_by_silence]
changes: [findings.escalation_state, open_decisions.queue]
inputs_from: [architecture-review, decision-office]
outputs_to: [decision-office, founder]
close_time: fortnightly to re-report; 42 days (three sweeps) to force a binary
status: proposed
rule: >
  Age escalates; severity does not. A Sev-1 and a Sev-3 raised the same day escalate the
  same day. At 42 days a finding stops being a finding and becomes an OPEN-DECISIONS item
  phrased as a binary: FIX IT, or ACCEPT IT IN WRITING with a named owner and a revisit
  date. Acceptance closes the finding and counts as a success.
premortem_link: >
  This is premortem #1 made mechanical, and premortem #1 is the risk ADR 0007 named in
  writing when it locked findings-only: "under deadline, findings can be acknowledged and
  deferred indefinitely. The Decision Office's close-time tracking is the counter-pressure."
  This loop is that sentence with a number in it.
earliest_signal: "arch.findings_closed_by_decision_ratio having a denominator and a zero numerator — available at sweep two, roughly day 14. Not 'findings are old'; by then the habit is set."
merge_trigger: "2026-11-24 — if fewer than half of raised findings have closed by decision (either way), this function merges into decision-office rather than continuing. Proposed as binding; symmetric with OD-24 and relevant to OD-26."
```

## 3. Invariant divergence — the loop a linter cannot run

```yaml
type: loop
id: loop-invariant-census
owner: architecture-review
measures: [arch.duplicated_invariants, arch.diverged_invariant_count]
changes: [findings.log, ci.checks]
inputs_from: [engineering, ai-orchestration, security, legal]
outputs_to: [messaging-delivery, platform-api, agent-fleet, security, legal]
close_time: fortnightly for the census itself (one invariant per sweep); per-commit for any invariant that earns a CI check
status: proposed
seed_case: >
  AR-2. COMMITMENT_PATTERNS — the "never auto-send a binding purchase commitment"
  guardrail — is 19 patterns at
  apps/api-gateway/src/common/orchestrator/inbound-responder.service.ts:49-70 and 8 at
  services/agent-orchestrator/agents/provider_conversation_agent.py:120-129, under a
  comment at :44-48 asserting it was "ported verbatim". The TS copy has the entire
  FR/IT/ES/DE multilingual set; the Python copy has none of it.
method: >
  Pick ONE rule that must hold everywhere. Enumerate every place it is enforced. Compare
  the enforcements to each other. That is the whole method, it takes a session, and it
  found a live legal exposure the first time it was run.
rule: "arch.diverged_invariant_count is reported as a COUNT WITH NAMES, never as a percentage. One diverged legal guardrail is not 'we are 96% consistent'."
note: "No import scan finds AR-2 — there is no import. This loop exists because the violations that matter most are behavioural, and premortem #2 is the function drifting into reviewing only what greps."
```

## 4. Callsite convergence — the L3/L4 coupling meter

```yaml
type: loop
id: loop-callsite-convergence
owner: architecture-review
measures: [arch.direct_provider_callsites, arch.layer_bypass_callsites]
changes: [findings.log]
inputs_from: [platform-api, model-routing-inference-economics, client-surfaces]
outputs_to: [model-routing-inference-economics, platform-api, client-surfaces, neural-footprint-instrumentation]
close_time: monthly
status: proposed
baseline_verified_2026_08_24:
  arch.direct_provider_callsites: "7 — consultants.service.ts:28, inbound-responder.service.ts:16, photo-count.service.ts:9, scan-parser.service.ts:10, document-extractor.service.ts:27, ux-optimizer.service.ts:44, vendor-page-extractor.service.ts:13. Each declares its own https://api.anthropic.com/v1/messages constant."
  retry_coverage: "1 of 7 — only scan-parser.service.ts:135-142 recovers from a failure."
  timeout_coverage: "4 of 7 — consultants, document-extractor and ux-optimizer have none. The four that do disagree: 8s/20s/120s, 30s, 60s, 180s."
  arch.layer_bypass_callsites: "2 files, 5 statements — useSommelierQueries.ts:25-26,42-43,56 and useReportQueries.ts:25-26,36-37 reach Postgres from the browser via lib/supabase.ts:16-18."
rule: >
  This loop measures ONLY. It does not design the convergence — that is
  model-routing-inference-economics' work for the provider callsites and platform-api's for
  the L6 bypass. A monthly number going the wrong way is the finding; the fix is theirs.
watch: "The number rising is worse than the number being high. 7 is a backlog; 8 means nobody is looking."
```

## 5. Is the rule still right? — the loop that reviews the reviewer

```yaml
type: loop
id: loop-layer-stack-review
owner: architecture-review
measures: [arch.findings_argued_down_per_seam, arch.rebuttals_by_kind]
changes: [readme.layer_stack, architecture-review.severity_ladder]
inputs_from: [engineering, ai-orchestration, product-vision, red-team]
outputs_to: [decision-office, founder]
close_time: quarterly — on the calendar whether or not anything has gone wrong
status: proposed
trigger: >
  Also fires early on: three findings against the same seam, all argued down on DESIGN
  grounds ("the indirection buys nothing here") rather than PRIORITY grounds ("true, not
  now"). Priority rebuttals mean the rule holds and the work is queued. Design rebuttals
  are evidence about the rule.
escalation: "The output of a defeated seam is a proposed amendment to README §1 — NOT a fourth finding. Premortem #4."
note: >
  A decision, not a feedback loop, and deliberately the odd one out — the same way OD-03 is
  in ai-orchestration-loops. It is here because L0–L6 is a CLAIM written in one sitting
  before L2 and L6 were built out, this function is chartered to propose changing it
  (charter §Boundaries), and a function that cannot revise its own premise is enforcing a
  wall poster.
```

---

## Loops we read but do not own

| Loop | Owner | What we take from it |
|---|---|---|
| **Schema parity, per CI run** — `scripts/check_schema_parity.sh` rebuilds a database from migrations alone and diffs it against remote | [[schema-migrations-charter]] | `arch.handmade_ddl_objects`, target 0. **The only running layer-boundary loop in the repo**, and the template for every check proposed here: rebuild from the source of truth, diff against reality, exit non-zero. Its header (`:6-11`) records the precedent — 27 tables, 403 columns, 13 functions once existed only because DDL had been applied by hand |
| Endpoint auth classification (OD-19) and the live spend exposure (OD-20) | [[security-charter]] | The incident half of AR-5. Ours is the invariant half: that tenant isolation is a per-controller convention (`tenant.guard.ts:38-46`), so endpoint 449 is unguarded by default |
| NF-A definition and doneability methodology | [[research-math-charter]] | Whether L4 has become joinable. AR-4 closes when one query can answer *"what did this agent's reasoning cost?"* — today `decision_log` has the reasoning and `api_spend` has the cost and no column connects them |
| Merge-policy eval gate, per commit | [[agent-evaluation-gates-charter]] | Proof that a hard verdict on a short close-time changes behaviour. Cited as precedent, not consumed |
| Decision close-times and the ADR log | [[decision-office-charter]] | Where every 42-day escalation lands. **This function's escalations are that unit's inbound volume**, which is the mechanical reason the merge trigger in loop #2 points there |

**The dependency stated plainly.** Four of these five loops measure things that already
exist in the repo and could be counted this week. Only `loop-finding-age` — the one that
determines whether this function is real — measures something that does not exist yet and
cannot exist until AR-0 is answered. **The function's own most important loop is blocked on
a question about where its output goes**, which is a fitting way for a review function to
begin and an unacceptable way for it to continue.
