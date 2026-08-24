---
type: premortem
division: intelligence
department: security
team: ai-surface-security
status: provisional
metrics: [nf_a.unauthenticated_inference_spend, sec.injection_corpus_size, sec.corpus_detection_rate, sec.autonomous_send_rate, sec.tenants_with_inference_budget]
updated: 2026-08-24
links: ["[[ai-surface-security-charter]]", "[[ai-surface-security-loops]]", "[[ai-surface-security-directive]]", "[[security-premortem]]", "[[neural-footprint-instrumentation-charter]]", "[[evaluation-doneability-charter]]", "[[access-control-tenant-isolation-charter]]", "[[red-team-charter]]", "[[compliance-charter]]"]
---

# AI Surface Security — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

Five mechanisms. The first two are the division doc's own premortem line
(`intelligence.md:336-340`), split apart because they fail independently and need different
counter-pressures.

---

### M1 — A policy document was written and a corpus never was

The team produces an injection policy. It is well-reasoned, cites the right literature,
names the right threats, and is read once. The corpus — the actual adversarial cases —
is always next quarter's work, because a document can be finished in an afternoon and a
corpus cannot.

The first real injection is discovered by a **vendor receiving a strange email**. We learn
the shape of our own attack surface from the person we attacked.

This is closer than it looks. The detection path already ships and is *entirely*
self-reported: `inbound-responder.service.ts:693` asks the model to set
`injection_suspected=true` when a message tries to instruct it, `:832` parses the answer,
and `:432-456` quarantines on it. **The model deciding whether it has been manipulated is
the model that was manipulated.** The existing tests confirm the plumbing and nothing else
— `inbound-responder.service.spec.ts:248-263` proves that *given* a mocked response with
the flag set, the reply is skipped. No test has ever put hostile text in front of the real
prompt.

**Earliest observable signal.** `sec.injection_corpus_size` = **0** at day 90 while an
injection policy document has a recent `updated` date. That pairing — a moving document
and a zero corpus — is the failure, visible three quarters early.

**Counter-pressure.** **The corpus is the deliverable; the policy is its README.** Seed it
in week one from the four shapes the repo's own prompt already names (`:693`) —
instruction-override phrasing, forged order confirmation, forged acceptance, and the
automated-mail evasion at `:29-31` — then grow it. And enforce
[[security-directive]] rule 4: **no injection mitigation is claimed done without a case
that fails without it.** A mitigation with no failing case is a hypothesis with good
intentions.

---

### M2 — Denial-of-wallet was declared solved when the guard merged

`fix/analytics-endpoint-auth` merges. OD-20 closes. Everyone concludes the spend exposure
is handled — reasonably, because the exploit that existed no longer does.

The exposure moved rather than closed. It is now *any authenticated user* instead of *any
anonymous caller*, and nothing bounds what an authenticated tenant can spend:
`claude-opus-4-8` at `max_tokens: 4096` with adaptive thinking
(`consultants.service.ts:154-176`), inside a limit of `ai: 20/60s`
(`rate-limit.guard.ts:31`) that is per-process in-memory (`:65-70`) and therefore
*20 × instance count*. One compromised or merely enthusiastic tenant account produces a
bill that arrives before any alert, because there is no alert — no callsite emits cost.

**Earliest observable signal.** An Anthropic invoice that cannot be decomposed by tenant or
by route. If the answer to *"which restaurant spent this?"* is a shrug, the control does
not exist regardless of what the guard says. Second signal, in the decision log: OD-20
marked resolved with no companion entry for a budget.

**Counter-pressure.** Ship the crude thing that needs no telemetry: a **hard per-tenant
daily call ceiling on the two paid analytics routes, defaulting closed**. It is a counter
in a table and a 429. It is wrong in a dozen ways and it bounds the loss, which the correct
solution does not do until RM-3 lands. `sec.tenants_with_inference_budget` (today **0**) is
the number that keeps this honest, and [[ai-surface-security-directive]] makes "a guard is
not a budget" a standing rule.

---

### M3 — The blocked dependency was absorbed instead of escalated

The primary metric is unmeasurable: `sec.model_callsites_emitting_cost` is **0 of 7**, and
fixing that belongs to [[neural-footprint-instrumentation-charter]]. Month one, the team
notes the block. Month three, the team works around it. Month six, nobody mentions it,
because a dependency that is always blocked stops being news — and the team's primary
metric quietly becomes one of its proxies, which are all easier and none of which measure
money.

The org has priced this dependency already: `intelligence.md:488` calls it a *"Hard
dependency, not a nice-to-have."* Hard dependencies with no date and no counter are how
two teams both believe the other is handling it.

**Earliest observable signal.** `sec.days_dependency_open` stops being reported, or is
reported without a number. The moment a blocked item appears in a status update as prose
("still waiting on RM-3") rather than as an integer, it has been absorbed.

**Counter-pressure.** L-SEC-5 in [[security-loops]] carries `status: blocked` **in its
frontmatter** and `sec.days_dependency_open` **as a measure**, so the block accrues a
visible number instead of a feeling. It still closes monthly while blocked; what it reports
is the day count and the crude substitute. A blocked loop with a close-time is a
functioning escalation — a blocked loop quietly marked `proposed` is a lie with a cadence.

---

### M4 — The docstring was believed and the auto-send path was never reviewed

The team reads `inbound-responder.service.ts:156-157` — *"It never sends; the manager
approves with one tap"* — and scopes its injection work to a human-in-the-loop system.
Every mitigation is designed on the assumption that a person reads the draft. The
threat model has a person in it who is, in the autonomous path, not there.

The code disagrees with its own docstring at `:509-513`:
`willAutoSend = autonomyFull && !flags.needs_approval`, with a two-minute undo window
(`:26`). The division doc inherited the error verbatim (`intelligence.md:318-320`,
*"never auto-send; human approval"*), which is the tell for how a stale comment propagates
— it entered a planning document as evidence.

**Earliest observable signal.** Any security artifact citing "human approval" as a
mitigation without also naming `sec.autonomous_send_rate`. If the mitigation is a person,
the metric must be *how often there is no person*.

**Counter-pressure.** Reconcile the claim with the code in week one and record **which was
wrong** — the two have different owners and different remedies. Then make
`sec.autonomous_send_rate` a standing counter, so "almost autonomous" is a number rather
than an adjective. And treat the auto-send path as the **primary** injection target rather
than the edge case: it is the only path where a successful injection reaches a vendor
without a human ever seeing it.

---

### M5 — Guest data reached a prompt and nobody was looking at prompts

The team's attention goes where the drama is — injection and wallet — and prompt *content*
is never audited. Somewhere in the seven callsites, an evidence pack or an email thread
carries guest identifiers, and they go out in a request body and come back in a log line.

The org has already priced this severity: `eval_guest_merge_policies.py:28-30` states that
a false guest merge is *"a DISCLOSURE — one person's dining history, spend"*, not a
data-quality error. The identity substrate exists
(`20260819000000_guest_identity_minimal_slice.sql`) with peppered channel hashes and an
erasure column — real care taken at the storage layer. **None of that care currently
extends to what goes into a prompt**, and `consultants.service.ts` builds an evidence pack
from analytics that increasingly includes check-level data.

**Earliest observable signal.** No one can answer *"what personal data appears in the
evidence pack sent to `claude-opus-4-8`?"* from a document. Second signal: a
request-body log line in any of the seven callsites — §12C item 10 is currently
**unmeasured**.

**Counter-pressure.** A prompt-content audit is deliverable, not a stance: for each of the
seven callsites, one page naming what enters the prompt and what is logged. Do
`consultants.service.ts` and `inbound-responder.service.ts` first — the two with the widest
input. Findings about *lawful basis* hand to [[compliance-charter]]; findings about *what
leaks where* stay here.

---

## Signal summary

| # | Mechanism | Earliest signal | Watched by |
|---|---|---|---|
| M1 | Policy, no corpus | `sec.injection_corpus_size` = 0 at day 90 | L-AIS-1 · monthly |
| M2 | Wallet declared safe at the guard | An invoice nobody can decompose by tenant | L-AIS-2 · monthly |
| M3 | Blocked dependency absorbed | Block reported as prose, not an integer | L-AIS-3 · monthly |
| M4 | Docstring believed over code | "Human approval" cited without the autonomous rate | L-AIS-2 · monthly |
| M5 | Prompt content never audited | Nobody can say what PII enters the evidence pack | L-AIS-4 · quarterly |

**The one-sentence version.** Four of these five fail because something *else* was fixed —
a guard merged, a policy written, a docstring trusted — so this team's rule is that
**a control owned by another team is never this team's mitigation**.
