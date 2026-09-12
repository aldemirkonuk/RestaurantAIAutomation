---
type: agenda-board
division: product
department: partnerships-integrations
status: active
metrics: [pi.merchant_backed_providers, pi.verified_ingress_ratio, pi.live_counterparties, pi.unblocking_agreements, pi.doc_corrections_carried, pi.canonical_shape_drift]
updated: 2026-08-28
links:
  - "[[partnerships-integrations-charter]]"
  - "[[partnerships-integrations-agenda-full]]"
  - "[[partnerships-integrations-loops]]"
  - "[[partnerships-integrations-agent-stack]]"
  - "[[partnerships-integrations-questions]]"
  - "[[0039-activation-plan-of-record]]"
---

# Partnerships & Integrations — Board

**Live as of 2026-08-28.** Tasks and their evidence live in
[[partnerships-integrations-agenda-full]]; this board is the rollup and the queries that keep it
honest. Every number below is either measured or carries the words **not emitted** — the
[[partnerships-integrations-agent-stack]] quality bar, ADR 0020.

## Every unit in this department, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc, type AS Kind, team AS Team, status AS Status, updated AS Updated
FROM "01-org/product/partnerships-integrations"
SORT team ASC, type ASC
```

## Charters only — grade at a glance

```dataview
TABLE WITHOUT ID
  file.link AS Unit, status AS Grade, updated AS Updated
FROM "01-org/product/partnerships-integrations"
WHERE type = "charter"
SORT status ASC
```

## Drift watch — anything unchanged for 60 days is finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc, updated AS "Last touched", (date(today) - date(updated)).days AS "Days cold"
FROM "01-org/product/partnerships-integrations"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Agendas still provisional anywhere in this department

The wave-3 check: after 2026-08-28 a `provisional` agenda in this subtree is a gap, not a state.

```dataview
TABLE WITHOUT ID
  file.link AS Doc, team AS Team, status AS Status, updated AS Updated
FROM "01-org/product/partnerships-integrations"
WHERE (type = "agenda-full" OR type = "agenda-board") AND status != "active"
SORT team ASC
```

## Loops this department owns, and how fast they close

```dataview
TABLE WITHOUT ID
  file.link AS Doc, department AS Dept, team AS Team
FROM "01-org/product/partnerships-integrations"
WHERE type = "loops"
SORT team ASC
```

## Open questions and findings routed to this department

```dataview
TABLE WITHOUT ID
  file.link AS Doc, team AS Team, open_questions AS Open, updated AS Updated
FROM "01-org/product/partnerships-integrations"
WHERE type = "questions"
SORT open_questions DESC, team ASC
```

## Numbers — reported as a set, never averaged

| Metric | Today (2026-08-28) | Target | Moved by | Task |
|---|---|---|---|---|
| `pi.merchant_backed_providers` | **0** | 1 | a merchant | PI-01…PI-04 |
| `pi.verified_ingress_ratio` | **contested** — the hand-kept "1 of 3" is wrong in both directions | a computed number, then 3 of 3 | us | PI-05, PI-05a |
| `pi.live_counterparties` | **0** | 1 | a distributor | PI-09…PI-12 |
| `pi.unblocking_agreements` | **0** of 9 | ≥0 — zero is an acceptable v0 result | a counterparty | PI-13, PI-14 |
| `pi.time_to_first_response` | **not emitted** — no outreach has occurred | reported beside the row above, never alone | a counterparty | PI-14 |
| `pi.doc_corrections_carried` | **0 of 7** | 7 of 7 | us | PI-19 |
| `pi.canonical_shape_drift` | **not emitted** — baseline unmeasured | a baseline | us | PI-22 |
| `nf_a.task_success_rate` | **not emitted** — nothing in this department emits nf_a | emitted, or the hole stated | Track A4 | PI-18 |

**Reading rule:** three of these are moved by counterparties, not by us. A zero on those is
information, not failure — but only when attempts are reported beside outcomes. A zero with no
attempt count is unreadable, which is why PI-14 refuses to publish one alone.

## Open forks — four registered, four not

- [ ] **OD-07** — Beli: build independently vs collaborate. Open; not ours to close. → PI-15
- [ ] **OD-19** — endpoint classification; re-measured 2026-08-26 to 40 routes on 5 controllers,
      8 of them ours. Co-owned with [[perimeter-ingress-integrity-charter]]. → PI-20
- [ ] **PROD-F4** — connector trust boundary. Asserted in charter, not decided. → PI-21
- [ ] **PROD-F2** — Vendor Finder boundary vs [[supply-discovery-charter]]. → PI-12 (clock)
- [ ] **CM-F3** — distributor connectivity: Sales or here? Seam proposed, not claimed. → PI-12
- [ ] **OD-A** ⚠ *drafted, never registered* — POS connection model. Blocks every pull provider,
      token refresh, and per-connection secrets. → PI-23 · **decided 2026-09-03: [ADR 0105](../../../decisions/0105-a-pos-connection-is-a-row-not-an-env-var.md)**
- [ ] **OD-B** ⚠ *drafted, never registered* — webhook secret scope. **The actual blocker on a
      second live provider**: one secret covers 27 providers and every restaurant. → PI-23 · **decided 2026-09-03: [ADR 0105](../../../decisions/0105-a-pos-connection-is-a-row-not-an-env-var.md) (scheme half); secret-scope half was already code-complete**
- [ ] **OD-C** ⚠ *drafted, never registered* — is `capabilities` behavioural or documentation? → PI-23
- [ ] **OD-D** ⚠ *drafted, never registered* — should imported history touch stock? → PI-23

## Clocks running

| Clock | Started | Fires | Consequence |
|---|---|---|---|
| Supplier-distributor dissolution clause | 2026-08-24 | **2026-11-22** (day 90) | If CM-F3 **and** PROD-F2 are both open with `pi.live_counterparties` = 0, this department files its own team-dissolution proposal (premortem M4) |
| OD-07 decay | 2026-08-24 | 60 days untouched **while** guest-experience commits land | *Decision-by-drift* finding to [[decision-office-charter]], naming the commits (premortem M3) |
| Counterparty-review anti-sprawl exemption | 2026-09-25 (first read) | 6 consecutive zeros | The monthly loop is deleted and [[partner-alliance-development-charter]] is reconsidered as a team |
| POS-Q4 age-out | 2026-08-24 | 2026-10-05 | Must resolve to a binary: fix, or accept in writing with a named owner |

## Rules in force

- [ ] **No new provider adapter while `pi.merchant_backed_providers == 0`.** Square and Clover need
      none — their normalizers exist; the door does not.
- [ ] **Two-provider rule** — no field enters `pos-types.ts` for one vendor alone.
- [ ] **`scaffolded` does not score.** Only merchant-backed counts.
- [ ] **No outbound contact without a human sending it.** Drafts are drafted, never sent. No first
      target is named — founder-deferred.
- [ ] **No second signature-verification implementation.** We ship contracts and evidence;
      [[perimeter-ingress-integrity-charter]] owns the control.
- [ ] **A correction is carried back to source in the same week it is found** — including when the
      source is one of our own artifacts. Four of the seven now outstanding are.
