---
type: premortem
division: product
department: partnerships-integrations
team: connector-platform-trust
status: partial
metrics: [pi.verified_ingress_ratio]
updated: 2026-08-24
links:
  - "[[connector-platform-trust-charter]]"
  - "[[connector-platform-trust-directive]]"
  - "[[partnerships-integrations-premortem]]"
  - "[[perimeter-ingress-integrity-charter]]"
  - "[[access-control-tenant-isolation-charter]]"
  - "[[pos-bridge-charter]]"
  - "[[engineering-charter]]"
---

# Connector Platform & Trust — Premortem

> Written at founding, before success is assumed.

It is August 2027. Here is how this team failed, most likely first.

---

## M1 — Verification is added per-connector as each integration ships, instead of once as a guard

**The mechanism.** This is not a forecast. It is the trajectory the code is **already on**, and
this team exists to interrupt it.

Two connectors, two postures, today:
- `pos-hub` verifies correctly and fails closed (`pos-hub.service.ts:96-121`).
- `toast` verifies **only if a signature happens to be present** (`toast.service.ts:189`),
  inverting its own helper's fail-closed intent at `:111-119`.

Connector three is written by whoever is nearest, copying whichever file they opened first.
By connector eight there is no shared answer to *"is this verified?"*, so nobody can answer it,
so nobody asks. Then a forged canonical check is POSTed to `pos-hub`'s generic webhook — the
one path every bridge depends on, by design (`pos-provider.registry.ts:12-15`) — and writes a
restaurant's sales history. The analytics engine consumes it as truth, the insight generator
produces confident recommendations from fabricated data, and nothing alarms, because
everything downstream is built to trust this layer.

**Earliest observable signal.** **Two connectors disagreeing about failure posture — which is
true right now.** The next signal after that is a third connector merged with no line in the
per-connector trust contract. Both are code-review-visible; neither requires an incident.

**Counter-pressure.** One mechanism, not one review: a **CI check that fails the build when a
route in an ingress-classified module lacks a verification call**, specified by this team,
implemented by [[engineering-charter]], measured by
[[perimeter-ingress-integrity-charter]]. **The guard is the deliverable — the fix alone is
not.** This defect class has now been written down three times in this repo (foundation §2.3,
`product.md:783`, and this charter) without a guard being added; a fourth description would be
worth nothing. And the specific first repair: make the toast call site unconditional, so an
absent signature is a rejection rather than a bypass.

---

## M2 — We build a parallel security function and both units assume the other set the secret

**The mechanism.** The mandate contains the phrase "webhook signature verification," and
[[perimeter-ingress-integrity-charter]] contains the same phrase. Nobody resolves OD-23, so
both teams act. This team builds a verification helper for connectors; Security builds one for
ingress. They are 90% the same and diverge in the 10% that matters — where the secret comes
from, and what happens when it is missing. Each team's code fails closed *within its own
assumptions*. In staging, the secret is configured in one path and not the other, one of the
two code paths silently accepts, and the "verified" endpoint verifies nothing. This is
**SEC-2's own premortem** — *"signature verification is added but the secret is left unset in
one environment and the code fails open rather than closed"* — arriving by the specific route
of organizational duplication.

**Earliest observable signal.** Two units producing overlapping metrics.
`pi.verified_ingress_ratio` and SEC-2's `unverified_public_ingress` describing the same
surface with different numbers. Visible at the first joint report — month one.

**Counter-pressure.** Written into the charter as a boundary and into the schedule as a
standing bi-weekly coordination slot rather than an escalation path. Plus a **deletion rule
that names which one dies**: if the two metrics measure the same surface, **ours is deleted,
not theirs.** Security owns the control; we own the contract. A boundary where both sides
believe they might be the one to yield is not a boundary.

---

## M3 — The inventory is produced once, heroically, and is stale within a quarter

**The mechanism.** The first deliverable is an ingress inventory — every route classified
ingress / management / simulator, with its verification posture. It is genuinely valuable, it
takes real effort, and it is *correct on the day it ships*. Then it becomes a document. Routes
are added; the inventory is not updated, because updating it is nobody's PR-blocking
obligation. Six months later a planning session cites it, the number is wrong, and someone
spends a day re-deriving it — which is exactly what happened to produce this charter, and
exactly what produced `product.md`'s incorrect *"0 of 32 verify."*

**Earliest observable signal.** A route added to an ingress module with no corresponding
inventory change in the same PR. First occurrence, and it is mechanically detectable.

**Counter-pressure.** **The inventory must be generated, not written.** `ENDPOINTS.md` is
already a regenerated grep target rather than a hand-edited doc (foundation README §0), and the
ingress classification should be the same: derived from source with an explicit
per-route classification annotation, regenerated on every run, with the CI guard from M1
failing when a route has no classification. A hand-maintained inventory *is* M3; the question
is only how long it takes.

---

## M4 — Credentials sprawl because the good pattern is never made mandatory

**The mechanism.** `apps/api-gateway/src/integrations/` is genuinely well built: 5 endpoints,
**all guarded** (`ENDPOINTS.md:226-234`), scopes declared once and shared by the consent screen
(`integrations-oauth.constants.ts:25`), credential encryption in
`token-crypto.service.ts`. But it serves exactly **two** providers — `google` and `microsoft`
(`integrations-oauth.constants.ts:1`). Meanwhile the POS registry has 27 entries, all of which
will eventually need merchant tokens, and Square and Clover are *already* blocked on precisely
that (`pos-provider.registry.ts:76, :88` — *"needs merchant OAuth token"*, *"needs merchant API
token"*). Because the good module was built for a different problem shape, the first POS
merchant token is stored *somewhere else* — an env var, a config row, a service-specific table.
By the fifth provider there are three credential paths, and the encryption service covers one
of them.

**Earliest observable signal.** The first merchant credential stored outside
`integrations/`. Detectable at the PR that stores it, and — importantly — **predictable now**,
because Square and Clover are both waiting on exactly this and neither has a home for it.

**Counter-pressure.** Extend the existing pattern *before* the first merchant token needs
somewhere to live. Concretely: `IntegrationProvider` is a two-member union
(`integrations-oauth.constants.ts:1`) and POS providers are not in it. Widening it, or
deliberately deciding they are a separate class **with a written reason**, is a week of work
now and a migration later. The rule: **one credential path, or a documented exception with a
named owner.**

---

## M5 — The orphaned consent screen stays orphaned, and consent quietly becomes fictional

**The mechanism.** `/authorize/:integrationId` has no inbound in-app link
(`PAGE_MAP.md:110`) and its route component cannot be traced (`PAGE_MAP.md:156`). It is the one
screen where a user grants access to their data, and it is reachable only by URL. Because it is
invisible, it is not maintained. Its scope disclosure drifts from what the integration actually
requests — or worse, a new integration is added by extending the constants without anyone
opening the screen that renders them. The scope declaration is *"shared by the consent screen"*
(`integrations-oauth.constants.ts:25`), which is the right architecture and the reason the
drift will be silent: the screen keeps rendering whatever the constants say, and nobody looks
at the screen.

**Earliest observable signal.** A new integration or scope added to
`integrations-oauth.constants.ts` with no accompanying change to, or view of, the consent
surface. First occurrence.

**Counter-pressure.** Two cheap ones: make the consent surface **reachable and traceable**
(fixing `PAGE_MAP.md:110` and `:156` is a small task with an outsized honesty benefit), and
require that **any scope change is reviewed as rendered**, not as source. A consent screen
nobody can reach is a consent screen nobody has read — which makes it a compliance artifact
that documents a permission the user was never meaningfully shown.

---

## The one that would hurt most

**M1** — it is the only mechanism here that corrupts data other departments consume as truth,
it is already in motion, and it is cheap to stop today. **M2 is the one most likely to be
caused by this team's own existence**, which is why the charter states the Security boundary
before it states anything else.
