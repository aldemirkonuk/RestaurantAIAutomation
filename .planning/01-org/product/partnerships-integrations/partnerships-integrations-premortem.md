---
type: premortem
division: product
department: partnerships-integrations
status: partial
metrics: [pi.merchant_backed_providers, pi.verified_ingress_ratio, pi.live_counterparties]
updated: 2026-08-24
links:
  - "[[partnerships-integrations-charter]]"
  - "[[pos-bridge-premortem]]"
  - "[[partner-alliance-development-premortem]]"
  - "[[supplier-distributor-network-premortem]]"
  - "[[connector-platform-trust-premortem]]"
  - "[[perimeter-ingress-integrity-charter]]"
  - "[[red-team-charter]]"
---

# Partnerships & Integrations — Premortem

> Written at founding, before success is assumed.

It is August 2027. The bridge strategy did not work. Here is how, most likely first.

---

## M1 — We built 27 adapters and nobody plugged anything in

**The mechanism.** The registry is a good map and a seductive one. Twenty-two providers sit
at `status: "planned"` (`pos-provider.registry.ts`), each one a satisfying, well-scoped,
independently completable piece of work with a public API doc. So the team works the ladder:
Square gets its merchant OAuth, Clover its API token, SpotOn and Lightspeed get normalizers,
and `registrySummary()` (`:328`) returns a beautiful histogram. Twelve months later
`pos_checks` still holds the **0 real rows** it holds today
(`.planning/decisions/AGENT_NATIVE_UI_DECISION.md:56`) — the 47 rows in there are simulator output
from one 43-minute window — because no merchant ever authorized a single connection. This is
the exact failure the agent-native review already named against this codebase:
*"combinatorially impressive systems built without a paying customer pulling on them."*

**Earliest observable signal.** `pi.merchant_backed_providers` stays at **0** while the
`scaffolded` count rises. Concretely: the first time a weekly loop reports "3 scaffolded, 0
merchant-backed" and the response is to discuss provider #4. That is the signal, and it is
visible in month one — not month twelve.

**Counter-pressure.** The department's headline metric is defined so `scaffolded` cannot
score: `pi.merchant_backed_providers` counts only providers with a **real merchant behind
them**. Enforced by two hard rules in [[partnerships-integrations-directive]]:
(a) **no new adapter may begin while `pi.merchant_backed_providers == 0`** — the only
permitted POS work in that state is finishing an adapter a *named venue* is waiting on, or
hardening the two `available` paths; and (b) the two universal providers
(`generic_webhook`, `csv_import`, `:29-51`) are the **default offer**, not the fallback.
A CSV from a real restaurant beats a scaffolded adapter for a POS nobody here has a login
to, and the registry's own header already says so (`:13-15`).

---

## M2 — Signature verification is added per-connector as each integration ships, instead of once as a guard

**The mechanism.** This is not hypothetical; it is the trajectory the code is already on.
`pos-hub` verifies correctly (`pos-hub.service.ts:96-121` — HMAC-SHA256, `timingSafeEqual`,
fails closed). `toast` verifies **only if a signature is present**
(`toast.service.ts:189`) — so an unsigned POST skips verification entirely, inverting the
helper's own fail-closed intent at `:111-119`. Two connectors, two different postures,
already. Adapter three copies whichever file the author opened first. By adapter eight
there is no shared answer to "is this verified?", so nobody can answer it, so nobody asks.
Then a forged canonical check is POSTed to `pos-hub`'s generic webhook — the one path every
bridge depends on — and writes a restaurant's sales history. The analytics engine, the
insight generator, and every recommendation built on top consume it as truth.

**Earliest observable signal.** Two connectors disagreeing about failure posture, which is
**true today**. The next signal after that is a third connector merged without a line in the
per-connector trust contract. Both are visible in code review, not in an incident.

**Counter-pressure.** One mechanism, not one review: a **CI check that fails the build when
a route in a module classified as ingress lacks a verification call**, owned jointly with
[[perimeter-ingress-integrity-charter]] and implemented by Engineering. The recurrence guard
matters more than the fix — this defect class has now been documented three times in this
repo without a guard being added. And the specific correction that starts it: the toast call
site must be made unconditional, so that *absent signature* is a rejection rather than a
bypass.

---

## M3 — OD-07 stays open by default rather than by decision

**The mechanism.** Nobody ever says "we are building the guest app independently." Instead
the guest work is nearer, more legible and more fun than an outreach email, so it advances
one slice at a time. Six months later a Beli conversation is opened from a materially weaker
position: the build is sunk, the differentiating surface is already half-shipped, and the
only thing left to negotiate is distribution on someone else's terms. The decision was made
— by drift, in the direction nobody argued for.

**Earliest observable signal.** OD-07's status line in `OPEN-DECISIONS.md:33` is unchanged
for two consecutive months **while** guest-experience commits continue landing. The
conjunction is the signal; either alone is fine.

**Counter-pressure.** OD-07 gets a **staleness alarm with a named owner and an escalation
path**, not a status field: if it is untouched for 60 days, [[partnerships-integrations-directive]]
escalates it to [[decision-office-charter]] as a *decision-by-drift* finding, naming the
guest-experience commits that accumulated while it sat. The department cannot make the call
— it is the founder's — but it can make the drift impossible to not notice. And the
department's own gate: **the Beli exploration ships a written option memo before the guest
build passes its next milestone**, so the call is at least answerable when it is asked.

---

## M4 — The distributor team runs a metric it does not control, because two boundaries cross it

**The mechanism.** [[supplier-distributor-network-charter]] is cut by two open forks at once:
**PROD-F2** (does supply discovery belong to Product & Vision or here?) and **CM-F3** (is
distributor connectivity Sales' or ours? — `commercial.md:631`, citing
`YC_WEDGE_PLAN.md:41`'s *"the connectivity is a commercial problem, not a technical one"*).
Neither resolves, because an unowned thing generates no pressure to resolve it. So the team
is measured on `pi.live_counterparties` — distributors with a refreshing feed or an active
portal login — while the *ask* that produces a willing distributor sits in Sales and the
*discovery* that produces the candidate list sits in Product & Vision. It builds a portal for
distributors who never log in, because a distributor's existing workflow is a PDF emailed to
a rep and nothing in the product was ever worth changing that for. `procurement_orders`
stays at **1** (`AGENT_NATIVE_UI_DECISION.md:59`).

**Earliest observable signal.** The first status report where this team's blockers are
entirely other units' actions. Or, more cheaply: **90 days with PROD-F2 and CM-F3 both open
and `pi.live_counterparties` still 0.**

**Counter-pressure.** Two, together. First, the charter **states the proposed seam rather
than silently claiming the territory** — signed intent to send data is the line; before it,
Sales; after it, us — so the fork is arguable instead of ambient. Second, a **90-day
dissolution clause**: if both forks are still open at day 90 with the metric at zero, this
department proposes merging the team into [[pos-bridge-charter]] (same connector failure
mode, same substrate) and hands the relationship half to Sales. A team that cannot state
what it controls should be merged, not staffed. This is the single most likely place this
department is one team too many.

---

## M5 — We become Toast-locked by accident, while believing we are not

**The mechanism.** Toast is the only provider at `status: "partial"` (`:58`) and the only one
with an existing module, a menu cache, a metrics endpoint and 10 shipped routes. The first
design partner runs Toast. Every ambiguity in the canonical shape therefore gets resolved
*the way Toast resolves it* — check lifecycle, void semantics, discount placement, employee
attribution, the meaning of a "closed" check. `CanonicalCheck` slowly becomes a rename of
Toast's payload. Two years on, the second real provider needs a shape change that touches
the analytics engine, the insight generator and the stock-depletion path, so it does not
happen. We are Toast-locked, having written "do not be Toast-locked" in the charter.

**Earliest observable signal.** A field is added to the canonical types with a justification
that names exactly one provider. Grep-able: any addition to `pos-types.ts` whose comment or
commit message mentions a single vendor. The capability model
(`CAP_FULL` / `CAP_NO_TABLES` / `CAP_PULL`, `:17-25`) exists precisely so provider variation
lives in capabilities rather than in the shape — the signal is variation leaking out of it.

**Counter-pressure.** A **two-provider rule** on the canonical shape: no field enters
`pos-types.ts` unless at least two providers in the registry populate it, or it is explicitly
marked provider-optional and gated behind a capability flag. The cheapest enforcement is the
one already built — every shape change must keep the `generic_webhook` canonical contract
valid, because that path is provider-neutral by construction and breaks loudly when the shape
becomes vendor-specific.

---

## The one that would hurt most

**M2**, because it is the only mechanism here that corrupts data other departments consume as
truth. M1 wastes a year. M2 makes the analytics engine, the insight generator and every
recommendation downstream unfalsifiable — and unlike the others it is already in motion, with
two connectors disagreeing about failure posture today.
