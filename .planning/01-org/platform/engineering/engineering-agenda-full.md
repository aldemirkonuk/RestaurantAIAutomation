---
type: agenda-full
division: platform
department: engineering
status: provisional
metrics: [platform.endpoints_protected_by_default_pct, surfaces.reachable_route_ratio, integration.verified_signature_coverage]
updated: 2026-08-24
links: ["[[engineering-charter]]", "[[engineering-premortem]]", "[[engineering-agenda-board]]", "[[engineering-directive]]", "[[engineering-loops]]", "[[engineering-schedule]]", "[[technology]]", "[[ORG_STRUCTURE]]"]
---

# Engineering — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Stand up eight teams that each own one **distinct way the product can be wrong**, and get
each of the eight metrics from *unmeasured* to *measured* before trying to move any of
them. Four of the eight metrics do not have a first reading yet:

| Metric | State today |
|---|---|
| `integration.verified_signature_coverage` | Unmeasured — measuring it is the team's first task (`technology.md:264-266`) |
| `identity.false_merge_count` | No labelled identity set exists yet |
| `inventory.projection_divergence_rows` | No daily sampling job yet |
| `messaging.duplicate_delivery_rate` | No `notification_id`-keyed measurement yet |
| `platform.endpoints_protected_by_default_pct` | **Measured: 0%** |
| `surfaces.reachable_route_ratio` | Baseline known: 24 orphan routes, 13 untraceable components |
| `procurement.order_to_delivery_reconciliation_rate` | Unmeasured |
| `schema.days_since_hand_applied_ddl` | Measurable today from the parity job |

## How

**Sequence: measure → guard → move.** The department's own premortem (M4) says the
existing guards are greps that can pass while the invariant is broken. So the first
artifact each team produces is a **number**, not a fix — because a fix with no number
cannot be shown to have worked, and a green grep is not a number.

Order of operations, department level:

1. **Baseline week.** Each of the eight teams publishes a first reading of its primary
   metric, or a written statement of why it cannot yet be read and what it would take.
2. **Seam loops before team loops.** The seven cross-department seams
   (`technology.md:857-865`) get their close-times set first, because M1 says the seams
   are where the real failures live and the team backlogs will crowd them out.
3. **Then the two zero-baselines.** `platform.endpoints_protected_by_default_pct` at 0%
   and `integration.verified_signature_coverage` at unknown are the department's two
   largest exposures, and they are coupled: the ≈51 legitimately-public routes are exactly
   the population that will demand the escape hatch M2 warns about. They are designed
   together or not at all.

## Why now

- **The team layer is the last undecided layer.** Divisions and departments are LOCKED
  ([[ORG_STRUCTURE]] §2); Engineering's 8 teams are PROPOSED
  (`technology.md:14-16`). Writing the charters is how the proposal gets tested.
- **The evidence is unusually strong and unusually specific.** Every one of the eight
  teams cites running code, a migration, or a CI guard. This is not an aspirational org
  chart; it is a naming of owners for work already happening without owners.
- **Two exposures are open right now.** 137 unguarded endpoints, and a `recurring-orders`
  controller with 6 unguarded routes that can place real orders against real vendors
  ([[ENDPOINTS]]:428). Neither has a named owner until these charters exist.

## Next steps

- [ ] Publish first readings for all eight primary metrics — [[engineering-loops]]
- [ ] Set close-times on the seven cross-department seams before any team backlog opens
- [ ] Design the global-guard mechanism and the public-route allowlist **as one change**
      — [[platform-api-charter]] + [[integration-engineering-charter]]
- [ ] Build the labelled identity set that `identity.false_merge_count` requires —
      [[catalogue-identity-charter]]; without it the metric is rhetoric
- [ ] Stand up daily projection-divergence sampling — [[inventory-ledger-charter]]
- [ ] Correct CLAUDE.md §1's "Next.js" claim to "Vite SPA + react-router-dom"
      (`apps/web/package.json:8,55,94`) — [[client-surfaces-charter]]
- [ ] Log every grep-shaped guard that has no outcome-side twin (premortem M4)
- [ ] Push TECH-F1, TECH-F2, TECH-F5 into `OPEN-DECISIONS.md` — [[decision-office-charter]]

## Questions for the founder

1. **TECH-F2 — is Engineering 8 teams or 6?** [[schema-migrations-charter]] and
   [[messaging-delivery-charter]] each have independent evidence *and* are each a
   plausible function inside [[platform-api-charter]]. This vault is written at 8; the
   fork is open (`technology.md:844`).
2. **TECH-F5 — 7 artifacts per team, or 3?** Teams here got all 7. At 8 teams that is 56
   documents to keep alive. The 60-day staleness rule is the enforcement; is it accepted?
3. **The `@Public()` escape hatch.** Premortem M2 says the obvious design fails. Is a
   CI-diffed allowlist an acceptable cost on the ≈51 legitimately-public routes, or is
   there appetite for a harder mechanism (signature verification as the gate, so "public"
   never means "unauthenticated")?
4. **Sequencing the two zero-baselines.** Protected-by-default and signature coverage are
   coupled. Both at once is more risk in one change; separately risks M2. Which?
5. **Is `identity.false_merge_count` allowed to block?** `scripts/eval_merge_policies.py:5-13`
   says false merges and false splits "must never be summed into one score". If a change
   improves splits and costs one merge, the charter says reject. Confirm.
