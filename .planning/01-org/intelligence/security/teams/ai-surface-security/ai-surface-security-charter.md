---
type: charter
division: intelligence
department: security
team: ai-surface-security
status: new
metrics: [nf_a.unauthenticated_inference_spend, sec.injection_corpus_size, sec.corpus_detection_rate, sec.autonomous_send_rate, sec.tenants_with_inference_budget, sec.model_callsites_emitting_cost]
updated: 2026-08-24
links: ["[[security-charter]]", "[[ai-surface-security-premortem]]", "[[ai-surface-security-agenda-full]]", "[[ai-surface-security-agenda-board]]", "[[ai-surface-security-directive]]", "[[ai-surface-security-loops]]", "[[ai-surface-security-schedule]]", "[[access-control-tenant-isolation-charter]]", "[[perimeter-ingress-integrity-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[evaluation-doneability-charter]]", "[[harness-model-routing-charter]]", "[[insight-narrative-generation-charter]]", "[[compliance-privacy-charter|compliance-charter]]", "[[red-team-charter]]", "[[ENDPOINTS]]", "[[OPEN-DECISIONS]]"]
---

# AI Surface Security — Charter

Division **Intelligence** → Department [[security-charter]] → Team `ai-surface-security`
(SEC-3, `.planning/foundation/teams/intelligence.md:296-340`).

**This team exists from day one**, unmerged, unlike its two siblings. Its tools are
neither guards nor HMACs, its dependency chain is longer, and its exposure is live today.

## Mandate

Own the risks that arrive **through a model** rather than through a route: prompt
injection from untrusted content, action and tool allowlisting, denial-of-wallet on
inference endpoints, and PII or secrets leaking into prompts and logs.

## Distinct from siblings because

**Neither sibling's control touches prompt injection**, because the malicious input
arrives inside a legitimately authenticated, legitimately signed payload.
[[access-control-tenant-isolation-charter]]'s guard admits the request correctly.
[[perimeter-ingress-integrity-charter]]'s HMAC verifies it correctly. The attack is in the
body, and both controls are working as designed while it happens.

The same asymmetry runs the other way on money. Guarding `/analytics/consult` converts
*anonymous* spend into *any authenticated user's* spend. That is a large improvement and
not a fix, because nothing bounds what an authenticated tenant may spend. **A guard is a
door; a budget is a meter, and this team owns the meter.**

Distinct also from two units outside Security, stated because both boundaries will be
tested:

- **[[compliance-privacy-charter|compliance-charter]]** (Corporate) owns lawful basis, DPAs, consent, retention —
  whether we *may*. This team owns whether an attacker *can*.
- **[[evaluation-doneability-charter]]** (R&M) grades whether model output was *good*.
  This team grades whether it was *attacker-steered*. Same corpus format, opposite pass
  condition: RM-2 wants a high score, we want a failing case.

## Boundaries

Owns outright:

- **The adversarial corpus** — cases, detection rate, and the CI suite that runs them.
- **Injection policy** on every path where untrusted text reaches a prompt.
- **Allowlist coverage audit** — verifying every AI surface sits behind the
  `ask → propose → confirm → execute` contract (`foundation README:258-260`) and
  classifying the gaps. *Narrowed 2026-08-27 (founder, ADR 0035): this line
  originally claimed enforcement; **enforcement of the gate is
  [[action-safety-the-human-gate-charter]]'s** — Security classifies, they gate.*
- **Inference budgets** — per-tenant ceilings, and the definition of unauthenticated spend.
- **Prompt and log hygiene** — PII and secrets entering a prompt or leaving in a log line.

## Metrics it moves

**Primary: `nf_a.unauthenticated_inference_spend`** — USD of model cost attributable to
calls whose originating request carried no authenticated subject. Name taken from
`intelligence.md:330`.

**Baseline: unmeasurable, and that is the finding.** `sec.model_callsites_emitting_cost`
is **0 of 7**. Grepping `apps/api-gateway/src` for `api_spend`, `cost_usd` or
`input_tokens` returns nothing (`intelligence.md:165-167`). The seven production model
callsites are `consultants.service.ts:28`, `inbound-responder.service.ts:16`,
`document-extractor.service.ts:27`, `scan-parser.service.ts:10`,
`photo-count.service.ts:9`, `vendor-page-extractor.service.ts:13`,
`ux-optimizer.service.ts:44` — every one a hand-rolled `fetch`, none instrumented.

This makes [[neural-footprint-instrumentation-charter]] a **hard dependency, not a
nice-to-have** (`intelligence.md:488`), and it is this team's first cross-team ask.

Because the primary metric is blocked, three measurable proxies carry the team until it
is not:

| Metric | Baseline | Why it is readable today |
|---|---|---|
| `sec.injection_corpus_size` | **0** cases | Needs no telemetry. Pure deliverable |
| `sec.corpus_detection_rate` | **undefined** — no corpus | Read together with size; a growing corpus at a flat rate is padding |
| `sec.tenants_with_inference_budget` | **0** | A daily per-tenant call ceiling needs no telemetry at all |
| `sec.autonomous_send_rate` | **unmeasured** | Replies sent with no human in the path |

## Evidence today

**NEW — the team, the corpus, the allowlist, and the budgets. EXISTS — the exposure, and
one partial control.** Graded `new` deliberately: the division doc says *"EXISTS (the
exposure), NEW (the team)"* (`intelligence.md:309`), and calling this `partial` would
credit us with a defensive posture we do not have.

### EXISTS — denial-of-wallet, live until a merge lands

`POST /analytics/consult/:restaurantId` reaches `consultants.service.ts:154-176`:
`api.anthropic.com/v1/messages`, `claude-opus-4-8`, `max_tokens: 4096`,
`thinking: { type: "adaptive" }`. The toggle gating it,
`PUT /analytics/consultants/:restaurantId/toggle`, was **also** unguarded, so an anonymous
caller could enable the paid layer and then drive it. The only brake was
`ai: 20/60s` (`rate-limit.guard.ts:31`) backed by an in-memory `Map` (`:65-70`) — so
*20 × instance count*, and unbounded in cost per call.

Fixed on `fix/analytics-endpoint-auth` (`99da5eb`), **unmerged**. Tracked as **OD-20**.
The service itself is well-designed — default OFF, toggle-gated per restaurant, and *"the
prompt forbids inventing numbers"* (`consultants.service.ts:7-24`). **The design was
careful and the door was open**, which is the cleanest possible statement of why this team
is not the same as [[insight-narrative-generation-charter]] reviewing its own work.

### EXISTS — the injection surface, and a partial control

`inbound-responder.service.ts` drafts vendor replies from inbound email: attacker-controlled
text entering a model whose output becomes a business communication.

A real control ships. `analysis.injection_suspected` (`:140`) quarantines the message —
`:432-456` refuses to draft, logs, and surfaces it for manager review — and `:95-96`
records that trust never lifts the quarantine. The guardrail set beyond it is genuinely
thoughtful (`:283`, `:895-920`): commitment language, price above target, quantity/budget
change, 3+ rounds, **sender not DKIM/DMARC-verified**, and commercial-terms inconsistency
(price mismatch, unmet MOQ, ambiguous currency, unknown tax basis).

**Two findings sit on top of it.**

**(1) The flag is set by the model reading the attacker's text.** `:693` instructs the
model to set `injection_suspected=true` when the message tries to instruct *it*; `:832`
parses the answer. A self-reported injection detector is a hypothesis until something
adversarial has been fired at it. The only tests assert **plumbing** — given a mocked
response carrying the flag, the reply is skipped
(`inbound-responder.service.spec.ts:248-263`, `email-triage.spec.ts:205-212`). **Nothing
tests whether the flag ever fires on a real payload.**

**(2) The documented mitigation is out of date, and the division doc inherited the error.**
`intelligence.md:318-320` records the mitigation as *"never auto-send; human approval"*,
and the service's own class docstring agrees — `:156-157`: *"It never sends; the manager
approves with one tap."* **The code does not.** `:509-513` computes
`willAutoSend = autonomyFull && !flags.needs_approval` and schedules a real send after a
two-minute undo window (`AUTO_SEND_UNDO_MS`, `:26`). Where the per-restaurant autonomy
switch is on and no guardrail trips, model output derived from attacker-controlled text is
sent with no human in the path.

That is not an argument against the design — a two-minute undo on a guardrail-clear reply
is a defensible product choice. It is an argument that **the security posture of this
system is currently described by a comment that is wrong**, and correcting the description
is a day-one deliverable.

### EXISTS — the disclosure risk is already priced

`scripts/eval_guest_merge_policies.py:28-30` states that a false guest merge is *"a
DISCLOSURE — one person's dining history, spend"* — not a data-quality error. The identity
substrate is real (`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql`),
so guest data reaching a prompt or a log is a live concern rather than a future one.

### EXISTS — the contract to enforce

`ask → propose → confirm → execute`, typed and allowlisted, never silently mutating
stock/money/email (`foundation README:258-260` §5 item 1; FUTURES §8.1). Specified. Not
enforced anywhere by a test.

### NEW — nothing exists

No adversarial corpus. No CI injection suite. No per-tenant inference budget. No
allowlist enforcement. No prompt/log PII audit. No cost telemetry on any of the seven
callsites.

## Explicit non-goals

| Not ours | Whose it is |
|---|---|
| Whether the request should have been admitted | [[access-control-tenant-isolation-charter]] |
| Whether the payload's origin is provable | [[perimeter-ingress-integrity-charter]] |
| Emitting cost/token events from model callsites | [[neural-footprint-instrumentation-charter]] *(R&M)* — hard dependency |
| Which model, what retry, what it costs | [[harness-model-routing-charter]] *(R&M)* |
| Whether an insight was *worth saying* | [[insight-narrative-generation-charter]] *(A&BI)* |
| Whether model output was *good* | [[evaluation-doneability-charter]] *(R&M)* — we grade attacker-steered, they grade good |
| Lawful basis, consent, retention for data in prompts | [[compliance-privacy-charter|compliance-charter]] *(Corporate)* |
| Attacking our corpus's blind spots | [[red-team-charter]] *(advisory)* — the corpus is ours; its coverage gaps are what an independent attacker is for |
