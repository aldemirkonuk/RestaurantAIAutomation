---
type: premortem
division: platform
department: engineering
status: provisional
metrics: [platform.endpoints_protected_by_default_pct, schema.days_since_hand_applied_ddl, identity.false_merge_count]
updated: 2026-08-24
links: ["[[engineering-charter]]", "[[engineering-loops]]", "[[engineering-directive]]", "[[catalogue-identity-premortem]]", "[[inventory-ledger-premortem]]", "[[platform-api-premortem]]", "[[schema-migrations-premortem]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Engineering — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. Engineering has failed. What happened?

### M1 — Eight teams became eight backlogs, and nobody owned the seams

The department was defined as eight *distinct ways the product can be wrong*. Within a
quarter each team had a queue, and the queues were the org. The failures that actually
hurt lived **between** teams: a schema change ([[schema-migrations-charter]]) that broke
a projection ([[inventory-ledger-charter]]); a global guard ([[platform-api-charter]])
that 401'd a webhook ([[integration-engineering-charter]]); a merge
([[catalogue-identity-charter]]) that orphaned a route ([[client-surfaces-charter]]).
Each team's own metric stayed green. The product got worse.

**Earliest observable signal.** Two teams' metrics both green in the same week that a
restaurant reports a problem neither team recognizes as theirs. Concretely: an entry in
`questions.md` that names two Engineering teams and gets answered by neither within one
close-time.

**Counter-pressure.** The seven seams are already written down
(`.planning/foundation/teams/technology.md:857-865`). Make them *addressable*: every seam
gets a loop in [[engineering-loops]] with a named close-time and a single accountable
team — the one on the **left** of the seam table. A seam with two owners has none.
[[engineering-directive]] routes any incident that touches two teams to the department,
not to whichever team saw it first.

---

### M2 — `@Public()` became the default, and 0% protected-by-default never moved

Today **all** protection is opt-in; the protected-by-default share of 448 routes is
**0%** (`apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46`). The obvious fix is a
global guard with a `@Public()` escape hatch. The ≈51 integration routes legitimately
need that hatch. Within two sprints `@Public()` is the copy-paste cure for anything that
401s in local dev, the count of reachable-unauthenticated routes is unchanged, and the
team has declared the problem solved.

**Earliest observable signal.** The first `@Public()` decorator that appears on a
controller outside `toast/`, `simpos/`, `pos-hub/`, `vendor-portal/`, or
`common/orchestrator/inbound-email.controller.ts`. Not the tenth — the **first**.

**Counter-pressure.** Make `@Public()` cost something structural, not social: an allowlist
file that CI diffs, so adding a public route is a reviewed change to a single file rather
than a decorator in a PR of forty. Measure the metric as *unguarded reachable routes*,
never as *routes carrying the global guard* — the second number can go to 100% while the
first is flat. [[security-charter]] classifies; we build the mechanism; the two numbers
are published side by side in [[engineering-agenda-board]].

---

### M3 — Red became normal on the schema-parity gate

`scripts/check_schema_parity.sh:6-11` records the incident verbatim: production once
carried **27 tables, 403 columns and 13 functions created by no migration**. The gate
exists because of it. Then a real 2am incident is fixed with a live `ALTER` — correctly,
because the alternative was downtime — the parity job goes red, the red is "known", and
six weeks later nobody can distinguish the known red from a new one. Engineering is back
to 2026-08-05 with a red badge instead of no badge.

**Earliest observable signal.** The parity job red for **two consecutive runs** with an
explanation in a chat message rather than a migration. Also: the first PR whose
description contains "already applied in prod".

**Counter-pressure.** A red gate must be closed by a *file*, not a sentence: the
reconciliation migration lands within one close-time or the streak counter
(`schema.days_since_hand_applied_ddl`) resets to zero publicly. Author and auditor are
deliberately different units — [[schema-migrations-charter]] authors DDL,
`[[state-integrity-invariants-charter|sre-state-integrity]]` runs the gate (`technology.md:296-298`) — and the auditor is
the one who declares red, so the author cannot normalize it.

---

### M4 — Grep-shaped guards gave false comfort

Three of the department's strongest safety properties are enforced by shell greps:
`scripts/check_no_direct_stock_writes.sh:1-13` (which says so itself at `:10`),
`scripts/check_no_guest_name_matching.sh`, and the parity script. Each is honest about
being a grep. A write path that builds a table name dynamically, or lives in a Postgres
function rather than TypeScript, passes all three. The team believes the invariant is
enforced; it is merely *usually* enforced.

**Earliest observable signal.** A non-zero `inventory.projection_divergence_rows` sample
on a day with a green CI run. That combination — green guard, divergent data — is the
tell, and it is exactly how the receiving-service bug behaved.

**Counter-pressure.** Every grep-guard is paired with a **data-side check that measures
the outcome rather than the syntax**: divergence sampling for stock, a labelled-set
false-merge count for identity. The grep stays (it is cheap and fast); it is just never
the only thing. A guard with no outcome-side twin is logged as a gap in
[[engineering-agenda-full]].

---

### M5 — Burn-down replaced judgement on the surfaces

`.planning/UX_PATHS_CATALOG.md` is a 154KB, 760-path corpus. It is the most *legible*
work in the department: paths close, a number goes up, progress looks real. Meanwhile the
opening baseline — **24 routes with no inbound link and 13 route components untraceable**
([[README]] §0) — is untouched a year later, because orphan routes are not on the list.

**Earliest observable signal.** Three consecutive close-times where the burn-down count
moves and `surfaces.reachable_route_ratio` does not.

**Counter-pressure.** [[client-surfaces-charter]]'s primary metric is the reachable-route
ratio, **not** paths burned down. The catalogue is an input to that metric, never a
substitute for it. Both numbers appear on the board; if only one moves for three
close-times, the department reallocates.

---

## Cross-cutting counter-pressure

- **Advisory is findings-only** ([[ORG_STRUCTURE]] §3). [[red-team-charter]] attacks the
  *decisions* above — especially M2's escape-hatch design and M1's seam ownership — and
  its findings land in `questions.md` and `OPEN-DECISIONS.md`, not in a veto.
- **[[decision-office-charter]] owns close-times.** Every mechanism here names one; a
  premortem whose counter-pressures have no close-time is the same failure at one level up.
- **Anti-sprawl applies to this document.** If nothing here has been revisited in 60 days,
  it is fiction (foundation §3.3, §6).
