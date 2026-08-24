---
type: charter
division: platform
department: engineering
status: exists
metrics: [identity.false_merge_count, inventory.projection_divergence_rows, procurement.order_to_delivery_reconciliation_rate, messaging.duplicate_delivery_rate, surfaces.reachable_route_ratio, platform.endpoints_protected_by_default_pct, integration.verified_signature_coverage, schema.days_since_hand_applied_ddl]
updated: 2026-08-24
links: ["[[engineering-premortem]]", "[[engineering-agenda-full]]", "[[engineering-agenda-board]]", "[[engineering-directive]]", "[[engineering-loops]]", "[[engineering-schedule]]", "[[ORG_STRUCTURE]]", "[[technology]]", "[[catalogue-identity-charter]]", "[[inventory-ledger-charter]]", "[[procurement-vendor-network-charter]]", "[[messaging-delivery-charter]]", "[[client-surfaces-charter]]", "[[platform-api-charter]]", "[[integration-engineering-charter]]", "[[schema-migrations-charter]]"]
---

# Engineering — Charter

Parent division: **Platform** ([[ORG_STRUCTURE]] §2). Siblings in-division: Data,
Reliability/SRE.

## Mandate

Engineering is accountable for the **product being right**: the L1 domain core, the L2
module softwares, the L6 surfaces a human touches, and the shared database schema all
three depend on. It owns the code that decides what a product *is*, how much of it there
*is*, what it *cost*, whether the message about it *arrived*, whether the screen showing
it *renders*, whether the third-party contract behind it still *holds*, whether the
request asking for it was *allowed*, and whether the database still has the *shape the
repo says it has*. It does not own the models that reason over that core, the substrate
that feeds it, or the machinery that keeps it running in production.

## Boundaries

Owns outright:

- **L1 domain core and L2 module softwares** — `apps/api-gateway/src/**` (44 controllers,
  448 routes) and the domain services under `services/agent-orchestrator/services/`.
- **L6 surfaces** — `apps/web` (Vite SPA, 51 routes), `apps/mobile` (Expo Router),
  `packages/ui`.
- **The shared schema** — `supabase/migrations/` (62 files) and the generated types in
  `packages/database`.
- **The request path** — tenancy, authn/authz, idempotency, rate limiting, caching, crypto.
- **The wire** — every code path that speaks a third party's protocol.

Structured as **eight teams, which are eight distinct ways the product can be wrong**
(`.planning/foundation/teams/technology.md:66-69`) — not a grid, not symmetry:

| Team | The wrongness it owns |
|---|---|
| [[catalogue-identity-charter]] | Wrong product identity |
| [[inventory-ledger-charter]] | Wrong stock number |
| [[procurement-vendor-network-charter]] | Wrong money |
| [[messaging-delivery-charter]] | Undelivered (or duplicated) message |
| [[client-surfaces-charter]] | Unusable screen |
| [[integration-engineering-charter]] | Broken third-party contract |
| [[platform-api-charter]] | Unauthenticated request |
| [[schema-migrations-charter]] | Drifted database |

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| L3 agent harness, routing, evaluation | [[ai-orchestration-charter]] | We build what the agent acts on; they build the agent |
| L0 substrate, corpora, enrichment, telemetry ingest | [[data-charter]] | Data makes rows fit to use; we consume them |
| Running it — observability, release, resilience, drift gates | [[reliability-charter]] | We author; they operate and audit |
| Finding and classifying security gaps | [[security-charter]] *(Intelligence)* | Security finds the class; [[platform-api-charter]] builds the mechanism |
| What a screen *should* be | [[design-charter]] *(Product)* | Design decides intent; [[client-surfaces-charter]] owns what shipped |
| The decision to integrate with a partner | [[partnerships-charter]] *(Product)* | Partnerships owns the relationship; [[integration-engineering-charter]] owns the wire |
| Grading agent task outcomes | [[agent-evaluation-gates-charter]] | Task outcome ≠ product correctness |

Seven of these seams are enumerated at `.planning/foundation/teams/technology.md:857-865`
precisely so they are not rediscovered in an argument later.

## Metrics it moves

Engineering does not roll its eight team metrics into one number, and this is deliberate:
the failure modes are not commensurable. A false merge and a stale bundle do not sum.
The department metric is the **set** — eight numbers, each with a named owner, on one
board ([[engineering-agenda-board]]).

- `identity.false_merge_count` — target zero, never traded against false splits
- `inventory.projection_divergence_rows` — target zero, sampled daily
- `procurement.order_to_delivery_reconciliation_rate`
- `messaging.duplicate_delivery_rate` / `messaging.drop_rate`
- `surfaces.reachable_route_ratio` — baseline: 24 routes with no inbound link
- `platform.endpoints_protected_by_default_pct` — **baseline 0%**
- `integration.verified_signature_coverage` — currently unmeasured
- `schema.days_since_hand_applied_ddl` — the parity job's green streak

Neural-footprint tie: identity errors corrupt `nf_b.*` guest signal at the root
(a wine merged wrongly attributes months of guest preference to the wrong bottle), and
the surfaces/API layer is where `nf_a.*` agent actions become visible or invisible to a
human.

## Evidence today

**EXISTS — the largest evidence base of any department in the org.**

- **Scale** — 448 endpoints across 44 controllers, 51 web routes, 62 migrations
  (`.planning/foundation/teams/technology.md:51`). The team count was justified by that
  span, not chosen to match a sibling department.
- **Gateway** — `apps/api-gateway/src/` with `common/{tenant,idempotency,rate-limit,cache,crypto,error-tracking}/`
- **Surfaces** — `apps/web/src/pages/` (40 page components + 11 sub-route directories),
  `apps/mobile/app/`, `packages/ui/src/components/{charts,layout,notifications,primitives}`
- **Schema** — `supabase/migrations/` (62 files), baseline
  `supabase/migrations/20260805000000_baseline_from_production.sql`
- **Guards already in CI** — `scripts/check_no_direct_stock_writes.sh:1-13`,
  `scripts/check_schema_parity.sh:6-11`, `scripts/check_no_guest_name_matching.sh`
- **Known open wounds, in the repo's own words** — 137 unguarded endpoints
  (`apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46` returns `true` with no
  authenticated user, by design); 24 web routes with no inbound link ([[README]] §0);
  ≈51 legitimately-public integration routes with unmeasured signature coverage.

**Two corrections carried forward** from the evidence pass
(`.planning/foundation/teams/technology.md:37-43`): `apps/web` is a **Vite SPA with
`react-router-dom`** (`apps/web/package.json:8,55,94`), not Next.js as CLAUDE.md §1
states — [[client-surfaces-charter]] owns fixing that claim.

## Open forks touching this department

- **OD-20** — Are [[schema-migrations-charter]] and [[messaging-delivery-charter]] teams,
  or functions inside [[platform-api-charter]]? Each has independent evidence; each is
  also a plausible merge (`technology.md:844`).
- **OD-23** — Does the team layer get all 7 artifacts, or 3 (charter · premortem · loops)?
  This vault currently answers "7"; the fork is not closed (`technology.md:847`).
- **OD-19** — 25 teams for one division at all (`technology.md:843`).
