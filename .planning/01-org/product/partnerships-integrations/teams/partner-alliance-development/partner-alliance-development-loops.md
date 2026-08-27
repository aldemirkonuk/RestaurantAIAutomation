---
type: loops
division: product
department: partnerships-integrations
team: partner-alliance-development
status: new
metrics: [pi.unblocking_agreements, pi.time_to_first_response]
updated: 2026-08-24
links:
  - "[[partner-alliance-development-charter]]"
  - "[[partner-alliance-development-directive]]"
  - "[[partnerships-integrations-loops]]"
  - "[[pos-bridge-loops]]"
  - "[[decision-office-charter]]"
  - "[[consumer-app-points-economy-charter]]"
  - "[[LOOP-MAP]]"
loop_count: 4
loop_ids: ["pad-counterparty-ledger", "pad-od07-decay", "pad-reachability-triage", "pad-guest-firewall"]
loop_close_times: ["monthly", "monthly", "per-event", "per-event"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed"]
---

# Partner & Alliance Development — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

`pi.*` metrics are defined canonically in [[partnerships-integrations-loops]].

---

## L1 — Counterparty ledger

The loop that makes a zero readable.

```yaml
type: loop
id: pad-counterparty-ledger
owner: partner-alliance-development
measures: [pi.unblocking_agreements, pi.time_to_first_response, ledger.attempts, ledger.state_distribution]
changes: [pos_provider_registry.status, partnerships.outreach_ledger]
inputs_from: [pos-bridge, sales, product-vision]
outputs_to: [pos-bridge, partnerships-integrations, strategy-fundraising]
close_time: monthly
status: proposed
```

**Why monthly.** A counterparty's clock is not ours. A weekly loop over signatures would emit
51 "no change" readings a year and be ignored by week six.

**What makes it non-trivial.** It reports **four things together, never one**: agreements,
median first-response time, raw attempts, and the distribution of ledger states across the
nine blocked providers. That combination is what distinguishes *nobody replied* from *nobody
was contacted* from *they replied and the terms were bad* — three worlds that a bare
`agreements: 0` collapses into one ([[partner-alliance-development-premortem]] M2).

**What it changes.** Registry status, when an agreement lands. And the team's own shape: nine
rows still reading *never contacted* at six months triggers a staffing finding rather than
another month of the same report.

**Today's reading:** 0 agreements · 0 attempts · no response data · 9 of 9 *never contacted*.

---

## L2 — OD-07 decay watch

The loop that exists because the failure is *nothing happening*.

```yaml
type: loop
id: pad-od07-decay
owner: partner-alliance-development
measures: [od_07.days_since_touched, guest_experience.commits_since_od07_touched]
changes: [decision_office.escalation_queue, partnerships.beli_stream]
inputs_from: [guest-experience, decision-office]
outputs_to: [decision-office, product-vision]
close_time: monthly
status: proposed
```

**The measured thing is a conjunction, and that is the design.** Days-since-touched alone is
just patience — an untouched decision on a dormant area is fine. Guest commits alone are just
progress. **Together they are a decision being taken without a decision.**

**What it changes — concretely, not rhetorically.** At 60 days untouched *with* continuing
guest commits, this loop files a **decision-by-drift finding** with
[[decision-office-charter]], naming the specific commits that accumulated while OD-07 sat.
That is the whole mechanism. A staleness loop with no consequence is the thing it exists to
prevent.

**What this loop does not do:** decide OD-07. That is the founder's
(`OD-07, OPEN-DECISIONS.md:28`).

---

## L3 — Reachability triage

Small, fast, and it runs before the slow loops.

```yaml
type: loop
id: pad-reachability-triage
owner: partner-alliance-development
measures: [triage.partnership_vs_bridge_split]
changes: [partnerships.outreach_ledger, pos_bridge.backlog]
inputs_from: [pos-bridge]
outputs_to: [pos-bridge]
close_time: per-event
close_time_note: "per candidate"
status: proposed
```

**Close-time is per-candidate**, because triage is a decision taken once per counterparty and
never revisited unless the counterparty changes. Batching it monthly would let candidates
enter an outreach process before anyone asked whether a CSV would do.

**The question it closes:** can this counterparty be reached through `generic_webhook` or
`csv_import` (`pos-provider.registry.ts:29-51`) instead of a signature? If yes it leaves this
team entirely and goes to [[pos-bridge-charter]]. The registry already reached this answer for
AKINSOFT Wolvox — *"start with file export → csv_import bridge"* — and this loop generalizes
that instinct instead of losing it ([[partner-alliance-development-premortem]] M5).

---

## L4 — Guest firewall integrity

```yaml
type: loop
id: pad-guest-firewall
owner: partner-alliance-development
measures: [firewall.breach_count]
changes: [guest_experience.scope_assumptions]
inputs_from: [guest-experience]
outputs_to: [guest-experience, partnerships-integrations]
close_time: per-event
close_time_note: "per artifact"
status: proposed
```

**The rule it enforces:** while OD-07 is open, no guest-experience artifact may take the
partnership as a premise. [[consumer-app-points-economy-charter]] builds as though the answer
is "independently," because that default is reversible and the opposite is not
([[partner-alliance-development-premortem]] M4).

**Close-time is per-artifact** — a spec, schema field, or scope decision either assumes the
partner or it does not, and that is checkable at review. A monthly sweep would find breaches
after they had been built on.

**Honest note on this loop.** It measures a count that should always be zero, which is a weak
loop by construction — nothing changes while it reads zero. It is kept because the cost of
running it is one question at artifact review, and the cost of missing it is a year of guest
design taken to fit a partnership that never existed. If it reads zero for **two quarters
after OD-07 closes**, it should be deleted; it is a fork-specific guard, not a permanent one.

---

## Not owned here

| Loop | Owner | Why |
|---|---|---|
| Adapter work after a signature | [[pos-bridge-charter]] | We hand off at the signature |
| Restaurant/design-partner pipeline | [[design-partner-operations-charter]] | Different counterparty class entirely |
| Distributor relationships | [[supplier-distributor-network-charter]] | Different deal shape; and its own boundary is contested (CM-F3) |
| The OD-07 decision itself | founder | We measure decay, not direction |
