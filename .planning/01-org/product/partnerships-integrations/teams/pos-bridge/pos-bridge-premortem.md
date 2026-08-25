---
type: premortem
division: product
department: partnerships-integrations
team: pos-bridge
status: exists
metrics: [pi.merchant_backed_providers, pi.canonical_shape_drift, nf_a.task_success_rate]
updated: 2026-08-24
links:
  - "[[pos-bridge-charter]]"
  - "[[pos-bridge-directive]]"
  - "[[partnerships-integrations-premortem]]"
  - "[[connector-platform-trust-premortem]]"
  - "[[analytics-engine-charter]]"
  - "[[AGENT_NATIVE_UI_DECISION]]"
---

# POS Bridge — Premortem

> Written at founding, before success is assumed.

It is August 2027. `pos_checks` still holds no real rows. Here is how, most likely first.

---

## M1 — Twenty-seven adapters built against documentation; the one restaurant that signs exports a CSV

**The mechanism.** The registry is an excellent to-do list, and that is the danger. Twenty-two
providers sit at `status: "planned"`, each with a public API doc, a clear scope, and a
satisfying definition of done. Work proceeds down the ladder — Square's merchant OAuth,
Clover's API token, SpotOn, Lightspeed — and `registrySummary()` (`:328`) returns an
increasingly impressive histogram. This is exactly the failure the agent-native review
already named against this codebase: *"combinatorially impressive systems built without a
paying customer pulling on them."* Then the first venue that actually signs runs a POS that
is not in the registry, or is in it at Tier 2 behind a partner agreement, or — most likely —
runs something whose only export was a nightly CSV all along. The two providers that were
`available` from day one (`:29-51`) were the answer, and twelve months of adapter work was
not.

**Earliest observable signal.** The `scaffolded` count rises while
`pi.merchant_backed_providers` stays at 0. Concretely and cheaply: **the first planning
conversation that chooses provider #4 without naming a venue waiting on providers #1–3.**
That is visible in month one.

**Counter-pressure.** Three, in order of bite:
1. **The gate.** No new adapter may begin while `pi.merchant_backed_providers == 0`
   ([[pos-bridge-directive]]). Permitted instead: an adapter a *named venue* is waiting on,
   or hardening the two universal paths.
2. **`csv_import` and `generic_webhook` are the default offer, not the fallback.** The
   registry already says so in its own header (`:12-15`). Sales conversations should start
   there, because they are the only two paths that work today for any venue at all.
3. **`scaffolded` cannot score.** The metric counts merchants, not adapters, by definition.

---

## M2 — The canonical shape becomes a rename of Toast's payload

**The mechanism.** Toast is the only `partial` provider (`:58`), the only one with an
existing module, a menu cache, and 10 shipped routes. The first design partner will very
likely run Toast, because Toast is what US SMB restaurants run. Every ambiguity in
`CanonicalCheck` therefore gets resolved *the way Toast resolves it*: what a voided line
means, whether a discount attaches to the check or the item, when a check counts as closed,
how an employee is attributed. Each individual decision is reasonable. The aggregate is
vendor lock-in written by a team whose charter forbids it. Two years on, the second real
provider needs a shape change that touches the analytics engine, the insight generator and
the stock-depletion path — so it does not happen, and the second provider is normalized into
a lossy approximation of the first.

**Earliest observable signal.** A field added to `pos-types.ts` whose justification names
exactly one provider. Grep-able at review time; invisible six months later. The capability
model (`CAP_FULL` / `CAP_NO_TABLES` / `CAP_PULL`, `:17-25`) exists precisely so provider
variation lives in capabilities — the signal is variation leaking *out* of it into the shape.

**Counter-pressure.** The **two-provider rule**, enforced at the diff, not at a retro: no
field enters `pos-types.ts` unless ≥2 registry providers populate it, or it is explicitly
provider-optional behind a capability flag. Plus a free structural check that already exists:
**every shape change must keep the `generic_webhook` canonical contract valid.** That path is
provider-neutral by construction, so it breaks loudly the moment the shape becomes
vendor-specific. Use it as the test, not as documentation.

---

## M3 — A forged check writes a restaurant's sales history, and every number downstream inherits it

**The mechanism.** The pos-hub webhook verifies correctly today — HMAC-SHA256,
`timingSafeEqual`, fails closed (`pos-hub.service.ts:96-121`). But the *other nine* pos-hub
routes are unauthenticated and unverified, and two of them are
`POST /pos-hub/catalog-match/:restaurantId/proposals/:proposalId/approve|reject`
(`ENDPOINTS.md:361-362`) — the human approval gate over catalogue mapping. An anonymous caller
approves a mapping proposal that points a POS item at the wrong catalogue entry. Or, worse in
a quieter way: `POST /pos-hub/import/:restaurantId` and `POST /pos-hub/mappings/:restaurantId`
accept whatever they are given. The corrupted mapping then depletes the wrong stock via
`apply_stock_movement`, the analytics engine consumes it as truth, and the insight generator
produces confident recommendations from fabricated history. Nothing alarms, because
everything downstream is designed to trust this layer.

**Earliest observable signal.** Not an incident — incidents come late. The signal is
**structural and present now**: a route that mutates catalogue mappings, sitting in a module
labelled "webhook — expected public", with no guard and no verification. It is visible in
`ENDPOINTS.md` today and needs no attacker to observe.

**Counter-pressure.** Split the module's routes by *kind*, not by module label:
the one ingress route keeps signature verification; the nine management routes get
`JwtAuthGuard` like any other authenticated surface. Then the CI guard from
[[connector-platform-trust-premortem]] M1 keeps it true. The specific first action:
**guard `approve`/`reject` before anything else in this team's backlog**, because it is the
only route here where an anonymous caller changes what the system believes about a
restaurant's inventory.

---

## M4 — The catalogue matcher's proposals are never measured, so nobody knows if the bridge is lying

**The mechanism.** `catalog-matcher.service.ts` proposes POS-item → catalogue mappings for a
human to approve. It has a spec file and a gate — good. What it does not have is a measured
accuracy, because the gate has never run on real data. So when real checks finally arrive,
the match rate is whatever it is, and the human approving 200 proposals in a sitting does
what every human does at proposal 40: approves the batch. A 70%-accurate matcher with a
rubber-stamped gate is strictly worse than no matcher, because it launders guesses into
records. `nf_a.task_success_rate` for this surface has no baseline, and by the time anyone
wants one, the approval history is already contaminated by fatigue.

**Earliest observable signal.** The first real batch, if anyone looks: approval rate near
100% with time-per-proposal falling through the batch. Both are recordable from the first
session — but only if the instrumentation exists *before* the first session, which is the
whole point.

**Counter-pressure.** Instrument the gate **before** the first real merchant connects, not
after: emit an `nf_a` event per proposal with the matcher's confidence, the human's verdict,
and the dwell time. Then two rules: proposals below a confidence threshold are presented
separately rather than in the batch, and **a batch approved faster than a floor rate is
flagged, not blocked**. The point is to keep the gate honest, and a gate whose behaviour is
unrecorded cannot be.

---

## M5 — SimPOS quietly becomes the product

**The mechanism.** SimPOS is a genuinely useful simulator — 11 routes, catalog seeding, check
lifecycle, table state. It is also the only POS in this system that fully works, and it is
the only one whose data reaches `pos_checks` today (47 rows, one 43-minute window). A venue
with no POS asks whether they could just use it. It is *right there*, it does what they need,
and saying yes unblocks a deal. Six months later there are three venues on SimPOS, it needs
receipt printing and a tip flow and offline mode, and this team is maintaining a
point-of-sale system while every provider in the registry is now a competitor rather than a
counterparty. The charter said "we do not build a POS"; nobody ever decided to.

**Earliest observable signal.** The first request to run SimPOS against real service — or,
earlier, the first SimPOS feature request that has no simulator justification (printing, tips,
offline). Feature requests reveal intent before deployments do.

**Counter-pressure.** A hard boundary written into the team's non-goals and enforced by
scope: **SimPOS accepts no feature whose only justification is real-service use.** A venue
with no POS is served by `csv_import` — which is `available` today and is a supported product
path. If the founder wants to reverse this, it is a supersede-ADR and a change to the bridge
thesis, not a scope decision this team can make in a sprint.

---

## The one that would hurt most

**M3.** M1 wastes a year and is recoverable. M2 is expensive and slow. M3 corrupts the record
that [[analytics-engine-charter]] and every recommendation surface treat as ground truth — and
unlike a bug, fabricated history does not announce itself. It is also the cheapest to prevent,
today, with a guard on two routes.
