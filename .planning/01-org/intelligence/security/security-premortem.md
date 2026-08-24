---
type: premortem
division: intelligence
department: security
status: provisional
metrics: [sec.unguarded_authenticated_surface, sec.recurrence_guard_present, sec.unverified_public_ingress, nf_a.unauthenticated_inference_spend, sec.fail_open_defaults]
updated: 2026-08-24
links: ["[[security-charter]]", "[[security-loops]]", "[[security-directive]]", "[[security-schedule]]", "[[access-control-tenant-isolation-premortem]]", "[[perimeter-ingress-integrity-premortem]]", "[[ai-surface-security-premortem]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[ENDPOINTS]]"]
---

# Security — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. Security has failed. What happened?

Five mechanisms, most likely first. Each is a *specific* way this department produces
green numbers while the system gets easier to attack — which is the only interesting way
a security function fails. Being breached by a novel technique is bad luck; reporting
zero while the door is open is malpractice.

---

### M1 — The 94 were closed in one heroic pass and the CI guard never landed

The likeliest failure, because it has already happened four times at smaller scale.

The sweep runs. Someone adds `@UseGuards(JwtAuthGuard)` to six controllers over two days,
`sec.unguarded_authenticated_surface` goes 94 → 0, the OD-19 entry closes, and the
department declares its founding campaign complete. The CI assertion is deferred to
"after the fix" because the fix felt like the hard part. Eight weeks later a new
controller ships without a guard — written by someone who never read this charter,
possibly an agent — and the number is 3 again with nobody watching it.

**We know this shape from the repo's own history.** `/ux/*` was closed by hand
(`ux-optimizer.controller.ts:55`). `one-tap-actions` was closed by hand
(`one-tap-actions.controller.ts:64`). `ManualOverrideModal`'s fake `managerId` was closed
by hand (`:114-122`). `analytics` is closed by hand on an unmerged branch
(`fix/analytics-endpoint-auth`, `99da5eb`). Four instances of one class, four bespoke
remediations, **zero recurrence guards**. The department would be the fifth instance of
the pattern it was founded to end.

**Earliest observable signal.** Not the regression — the *ordering*. The first PR that
adds a guard to a controller **without** touching a CI script or an allowlist file. That
PR is the failure, three months early. Concretely: `sec.unguarded_authenticated_surface`
falls in any week while `sec.recurrence_guard_present` is still `false`.

**Counter-pressure.** Invert the sequence and make it structural. **The CI check ships
first, red, with an allowlist containing all 94 routes.** Remediation becomes *deleting
lines from the allowlist* — which means the number cannot fall without a reviewed diff to
a single file, and cannot silently rise at all. This is not novel here: the repo already
enforces four invariants exactly this way (`scripts/check_no_direct_stock_writes.sh`,
`check_no_guest_name_matching.sh`, `check_beverage_identity_parity.py`,
`check_schema_parity.sh`). The mechanism is proven, has CI wiring, and simply has not
been pointed at this defect class. [[security-directive]] makes "guard added without
allowlist change" a rejected shape at the team level, not a debate.

---

### M2 — Coverage was measured instead of exposure

The subtler twin of M1, and the one that survives a competent M1 fix.

The metric quietly becomes *"routes carrying a guard decorator"* rather than *"routes
reachable without authentication."* Those two numbers diverge the moment `@Public()`
becomes the cure for anything that 401s in local dev. Coverage climbs to 100% while
`@Public()` count climbs alongside it, and the exposed surface is flat. Today the honest
baseline is protection-by-default of **0%** of 448 routes — every one of the 311 guarded
routes is guarded because someone remembered.

The `simpos` case shows the same illusion from the classification side: eleven routes
labelled *"webhook module — expected public, must verify signatures instead"*
(`ENDPOINTS.md:536`) where the signature is generated **by our own server**
(`simpos.service.ts:498-502`) on behalf of an unauthenticated caller. An auditor reading
the label checks the HMAC, finds it correct and fail-closed, and marks the module green.
A per-module label can make a confused deputy look like a verified integration.

**Earliest observable signal.** The first `@Public()` decorator on a controller outside
the known set — `toast/`, `simpos/`, `pos-hub/`, `vendor-portal/`,
`common/orchestrator/inbound-email.controller.ts`, `communications/test/e2e/*`. **The
first, not the tenth.** Second signal: any status report quoting one number where
[[security-charter]] specifies two.

**Counter-pressure.** Publish the two numbers **side by side, always, in the same table**
(`sec.unguarded_authenticated_surface` and `sec.public_decorator_count`) — a discipline
[[engineering-charter]]'s premortem M2 arrived at independently, which is corroboration
rather than coincidence. Make `@Public()` cost something structural: an allowlist file CI
diffs, so adding a public route is a reviewed one-line change rather than a decorator
buried in a forty-file PR. And classify **per route**: the department's own charter
carries `simpos` as the standing counter-example.

---

### M3 — The AI surface got a policy document instead of a corpus

[[ai-surface-security-charter]] writes a well-reasoned page on prompt injection. It cites
the right threats, proposes the right allowlist, and is read once. No adversarial corpus
is ever built. The first real injection is discovered by a **vendor receiving a strange
email**, and we learn about our own attack surface from the person we attacked.

This one is closer than the division doc assumed, and the doc's own evidence is now
partly wrong. `intelligence.md:318-320` records the mitigation as *"never auto-send;
human approval,"* and the service's class docstring agrees —
`inbound-responder.service.ts:156-157`: *"It never sends; the manager approves with one
tap."* **The code does not.** `inbound-responder.service.ts:509-513` sets
`willAutoSend = autonomyFull && !flags.needs_approval` and schedules a real send after a
two-minute undo window (`AUTO_SEND_UNDO_MS`, `:26`). Attacker-controlled text can become
a genuinely-sent business communication with no human in the path, if the per-restaurant
autonomy switch is on and no guardrail trips.

The guardrails are real and thoughtful — commitment language, price above target,
quantity/budget change, 3+ rounds, unverified sender, commercial-terms inconsistency
(`:283`, `:895-920`) — and one of them is injection quarantine (`:432-456`). But
`injection_suspected` is **set by the same model reading the attacker's text**
(`:693`, `:724`), and the only tests assert the plumbing: given a mocked response with the
flag set, the reply is skipped (`inbound-responder.service.spec.ts:248-263`,
`email-triage.spec.ts:205-212`). **Nothing tests whether the flag ever fires on a real
payload.** A self-reported injection detector with no adversarial corpus is a hypothesis.

**Earliest observable signal.** Two, both cheap to watch. (1) A doc-versus-code
divergence of exactly the kind above — the class comment says "never sends" and the
method schedules a send. (2) The corpus file does not exist ninety days in:
`sec.injection_corpus_size` still **0** while an injection policy doc has an `updated`
date.

**Counter-pressure.** The corpus is the deliverable; the policy is its README. Seed it
from the four attack shapes the prompt itself already names (`:693`) — *"ignore previous
instructions", "confirm the order", "reply saying you accept"* — and require a **failing
test before any injection mitigation is claimed as done**. Second: reconcile the
docstring with the code as instance #1, and add `autonomous_send_rate` to
[[security-agenda-board]] so "almost autonomous" is a number rather than an adjective.

---

### M4 — Denial-of-wallet was declared solved when the guard landed

`/analytics/consult` gets its guard, OD-20 closes, and everyone reasonably concludes the
spend exposure is handled. It is not: the exposure moved from *anonymous* to *any
authenticated user*, and there is still no per-tenant inference budget, no cost ceiling,
and no telemetry. One compromised or merely curious tenant account drives
`claude-opus-4-8` at `max_tokens: 4096` (`consultants.service.ts:154-176`) inside a rate
limit of `ai: 20/60s` (`rate-limit.guard.ts:31`) that is per-process
in-memory (`:65-70`) — so *20 × instance count*, and unbounded in cost per request. The
bill arrives before the alert, because there is no alert.

The department's primary AI metric cannot see any of this:
`nf_a.unauthenticated_inference_spend` is **unmeasurable**, since no NestJS model callsite
emits a cost event. That is [[neural-footprint-instrumentation-charter]]'s work, not ours,
which makes it the failure mode we cannot fix alone.

**Earliest observable signal.** An Anthropic invoice that cannot be decomposed by
restaurant or by route. If the answer to *"which tenant spent this?"* is a shrug, the
control does not exist regardless of what the guard says. Also: OD-20 marked resolved with
no companion entry for a budget.

**Counter-pressure.** Escalate the RM-3 dependency as a **scheduled ask with a date**,
not a hope — it is L-SEC-5 in [[security-loops]] and appears on
[[security-agenda-board]] as a blocked item with an owner, so the block is visible rather
than absorbed. Meanwhile ship the crude thing that needs no telemetry: a hard per-tenant
daily call ceiling on the two paid routes, defaulting closed. A number that is wrong but
present beats a number that is right and absent.

---

### M5 — The department became a second Red Team and stopped shipping controls

The seductive failure. Findings are more fun to write than allowlists. Within two
quarters the department produces excellent commentary on other units' decisions, an
attractive threat model, and no merged code. [[red-team-charter]] — which is *supposed*
to attack decisions and is structurally outside the line to do it — now has a rival
inside the line, and [[platform-api-charter]] receives two streams of advice and one
stream of unbuilt work.

The founder scoped this boundary explicitly ([[ORG_STRUCTURE]] §3: *"Security builds
defenses in the line"*), which is exactly the kind of boundary that erodes without a
metric attached to it.

**Earliest observable signal.** A quarter in which every Security artifact's `updated`
field moved and no `sec.*` metric did. Or: a Security document whose subject is another
unit's *decision* rather than a route, a control, or a corpus.

**Counter-pressure.** Every loop in [[security-loops]] names a `changes:` field that is a
**mechanism**, not a document. [[security-agenda-board]]'s standing counters are numbers
with baselines, so a quarter of pure commentary is visibly a quarter of no movement. And
the escalation path in [[security-directive]] sends decision-level objections **to**
[[red-team-charter]] rather than answering them here.

---

## Signal summary

| # | Mechanism | Earliest signal | Where it is watched |
|---|---|---|---|
| M1 | Heroic pass, no CI guard | A guard added without an allowlist change | L-SEC-1 · weekly |
| M2 | Coverage measured, not exposure | First `@Public()` outside the known set | L-SEC-2 · weekly |
| M3 | Policy doc instead of a corpus | `sec.injection_corpus_size` = 0 at day 90 | L-SEC-4 · monthly |
| M4 | Wallet declared safe at the guard | An invoice nobody can decompose by tenant | L-SEC-5 · monthly |
| M5 | Became a second Red Team | All `updated` moved, no `sec.*` moved | L-SEC-3 · quarterly |

**The one-sentence version.** This department fails by producing a zero it did not earn —
so every metric it publishes carries its measurement method next to it, and a metric with
no reading is written **unmeasured**, never omitted. An omitted metric reads as green.
