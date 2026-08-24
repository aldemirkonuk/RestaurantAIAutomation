---
type: agenda-full
division: intelligence
department: security
team: ai-surface-security
status: provisional
metrics: [nf_a.unauthenticated_inference_spend, sec.injection_corpus_size, sec.corpus_detection_rate, sec.autonomous_send_rate, sec.tenants_with_inference_budget, sec.model_callsites_emitting_cost]
updated: 2026-08-24
links: ["[[ai-surface-security-charter]]", "[[ai-surface-security-premortem]]", "[[ai-surface-security-agenda-board]]", "[[ai-surface-security-directive]]", "[[ai-surface-security-loops]]", "[[ai-surface-security-schedule]]", "[[security-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[evaluation-doneability-charter]]", "[[access-control-tenant-isolation-charter]]", "[[compliance-privacy-charter|compliance-charter]]", "[[red-team-charter]]", "[[OPEN-DECISIONS]]"]
---

# AI Surface Security — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. Every reading below was
> taken from source on 2026-08-24; nothing in "next steps" has been started.

## What

Four deliverables, none of which requires the blocked telemetry dependency to start.
That property is deliberate — a team whose first quarter depends on another team's schema
decision spends its first quarter waiting.

1. **The adversarial corpus** and the CI suite that runs it. `sec.injection_corpus_size`
   0 → a real number.
2. **A per-tenant inference ceiling**, crude and defaulting closed.
3. **A truthful description of the autonomous path** — reconcile the "never auto-send"
   claim with the code that auto-sends.
4. **A prompt-content audit** of the seven model callsites.

## How

**The corpus first, and the corpus is code.** Not a document listing attack categories —
a set of cases, each a real email body, each with an expected verdict, runnable in CI. Four
seed shapes come from the repo's own prompt (`inbound-responder.service.ts:693` and
`:29-31`): instruction-override phrasing, a forged order confirmation, a forged acceptance,
and automated-mail evasion. Each seed becomes a family, not a single case.

**The pass condition is deliberately not RM-2's.** [[evaluation-doneability-charter]]
grades whether output was *good* and wants a high score.
This team grades whether output was *attacker-steered* and **wants a failing case** — a
corpus where everything passes on the first run was written by someone imagining the
attacker rather than being one. That is the exact failure
`scripts/eval_guest_merge_policies.py` names for guest policies: *"a policy self-graded
against probes its own author imagined."* The counter is
[[red-team-charter]], quarterly, on coverage.

**Measure detection rate and size together.** A corpus growing at a flat detection rate is
being padded with cases the model already passes. Both numbers, one table, always.

**The budget is crude on purpose.** A per-tenant daily call ceiling on the two paid
analytics routes is a counter and a 429. It needs no NF schema, no cost events, and no
RM-3. It is wrong in a dozen ways and it bounds the loss —
[[ai-surface-security-premortem]] M2's whole argument is that a bounded wrong number beats
an unbounded right one that has not arrived.

## Why now

**The exposure is live and the description of it is wrong**, which is a worse combination
than either alone.

Live: `POST /analytics/consult/:restaurantId` reaches `claude-opus-4-8` at
`max_tokens: 4096` (`consultants.service.ts:154-176`), and its enabling toggle was equally
open. Fixed on `fix/analytics-endpoint-auth` (`99da5eb`), **unmerged**.

Wrong: `inbound-responder.service.ts:156-157` says the responder *"never sends"*; `:509-513`
schedules a send after a two-minute undo window. The division's own team doc repeated the
docstring as evidence (`intelligence.md:318-320`), which is how a stale comment becomes a
planning input. Every hour that description stands, someone else's threat model inherits it.

## The seven model callsites

The full inventory this team's audits cover. **None emits a cost event**
(`sec.model_callsites_emitting_cost` = 0 of 7).

| Callsite | Untrusted input? | Notes |
|---|---|---|
| `consultants.service.ts:28` | analytics evidence pack | `claude-opus-4-8`, 4096 tokens, adaptive thinking. Paid layer, default OFF |
| `inbound-responder.service.ts:16` | **vendor email — fully attacker-controlled** | `claude-haiku-4-5`; auto-send path at `:509-513` |
| `document-extractor.service.ts:27` | uploaded invoices | Attacker-supplied documents |
| `scan-parser.service.ts:10` | uploaded menus | Only callsite with any retry/backoff |
| `photo-count.service.ts:9` | uploaded photos | |
| `vendor-page-extractor.service.ts:13` | **scraped vendor web pages** | Untrusted third-party HTML into a prompt |
| `ux-optimizer.service.ts:44` | app telemetry | Guarded at `ux-optimizer.controller.ts:55` |

**Two are usually overlooked and should not be.** `vendor-page-extractor` puts arbitrary
scraped HTML into a prompt — the classic indirect-injection channel, with no human reading
the page first. And `document-extractor` accepts uploaded invoices, which are attacker-chosen
files rendered into a model's context.

## Next steps

Ordered. Nothing started.

1. **Reconcile "never auto-send."** Fix the docstring or the code, and **record which was
   wrong** — the two have different owners. One-line fix, disproportionate value: it stops
   the error propagating into further planning documents.
2. **First reading of `sec.autonomous_send_rate`.** How many replies were sent with no
   human in the path? If the answer is zero because the autonomy switch is off everywhere,
   say so — that is a good answer and it changes the priority order.
3. **Seed the corpus — 20 cases across the four seed families.** Ship the CI suite red if
   any case fails, which is the desired first state.
4. **Per-tenant daily inference ceiling** on `POST /analytics/consult` and
   `PUT /analytics/consultants/:id/toggle`, defaulting closed.
5. **Merge `fix/analytics-endpoint-auth`** — jointly with
   [[access-control-tenant-isolation-charter]]. Closes anonymous access; step 4 closes the
   rest.
6. **File the RM-3 ask with a date.** The eight NF-A fields for seven callsites. Named
   contract at `intelligence.md:488`; L-AIS-3 counts the days.
7. **Prompt-content audit — `inbound-responder` and `consultants` first.** One page each:
   what enters the prompt, what is logged, what is guest data. Answers §12C item 10, which
   is currently `unmeasured`.
8. **Extend the corpus to indirect injection** — `vendor-page-extractor` (scraped HTML) and
   `document-extractor` (uploaded invoices). Different channel, same attack.
9. **Specify allowlist enforcement** for `ask → propose → confirm → execute`
   (`foundation README:258-260`). Specified since founding, enforced by no test.

## Questions for the founder

1. **Is the per-restaurant autonomy switch on for anyone today?** Sets the real value of
   `sec.autonomous_send_rate` and reorders steps 1–4.
2. **The two-minute undo window — is that the intended product behaviour?** If yes, the
   docstring is what is wrong, and this team designs *around* an autonomous path rather than
   arguing against it. If no, the code is wrong. We should not guess which.
3. **What is an acceptable per-tenant daily inference spend?** Any number lets us ship the
   ceiling. No number means we pick one, and we would rather you did.
4. **Does the analytics evidence pack contain guest-level data today?** Determines whether
   step 7 is a hygiene audit or a disclosure question for [[compliance-privacy-charter|compliance-charter]].
5. **Is `vendor-page-extractor` pointed at arbitrary URLs or an allowlist of vendor
   domains?** Changes the indirect-injection surface by an order of magnitude.
