---
type: agenda-full
division: product
department: product-vision
status: provisional
metrics: [surface.unowned_surface_count, askai.refusal_correctness, inbound.false_accept_count, floor.misroute_rate, supply.sku_dual_price_coverage_pct]
updated: 2026-08-24
links: ["[[product-vision-charter]]", "[[product-vision-premortem]]", "[[product-vision-agenda-board]]", "[[product-vision-directive]]", "[[product-vision-loops]]", "[[product-vision-schedule]]", "[[product]]", "[[ORG_STRUCTURE]]", "[[surface-portfolio-charter]]", "[[ask-ai-charter]]", "[[inbound-understanding-charter]]", "[[supply-discovery-charter]]", "[[service-floor-charter]]"]
---

# Product & Vision — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Stand up five teams grouped by **module shape**, and get each team's primary metric from
*unmeasured* to *measured* before trying to move any of them. Only one of the five is
measured today.

| Team | Primary metric | State today |
|---|---|---|
| [[surface-portfolio-charter]] | `surface.unowned_surface_count` | **Measured: 24 + 13** ([[PAGE_MAP]]:104-132, :151-167) |
| [[inbound-understanding-charter]] | `inbound.proposal_accept_without_edit_rate` | Unmeasured — no per-module acceptance instrumentation |
| [[supply-discovery-charter]] | `supply.sku_dual_price_coverage_pct` | Unmeasured — no "needed SKU" denominator exists |
| [[ask-ai-charter]] | `askai.confirm_without_edit_rate` | Unmeasurable — no composer, no server module |
| [[service-floor-charter]] | `floor.kitchen_ready_to_waiter_p95_seconds` | **Unmeasurable — input columns are 0/47 non-null** |

Alongside the metrics, four deliverables that are decisions rather than builds:

1. **The route verdict sheet** — keep / merge / kill / make-reachable / intentionally-cold
   for all 51 routes, starting with the three live duplications.
2. **The guardrail contract** — one confidence/gate standard shared by Email, Order, and
   Invoice, with one approval primitive.
3. **The action schema + refusal policy** — one typed allowlist behind all Ask AI entry
   points, with the audit trail in the same slice.
4. **The Floor Checker input audit** — per POS provider, does a kitchen-ready signal exist,
   and through what mechanism.

## How

**Sequence: measure → decide → commission → build.** This department's output is mostly
decisions, and a decision with no number behind it is a preference. So each team's first
artifact is a reading or a verdict sheet, never a feature.

Activation order, following *lead priority + background parallelism*
(foundation [[README]] §8) and the honest count at `teams/product.md:840-848`:

1. **[[surface-portfolio-charter]] first.** It is the only EXISTS team, its backlog is
   already enumerated, its first three verdicts (`/wine-agent` vs `/wineagent`,
   `/inventory` vs `/inventory-legacy`, `/calendar` vs `/calendar-classic`) need no
   engineering permission, and it is cheap to start.
2. **[[inbound-understanding-charter]] next.** Three modules with running code and no shared
   gate is a live risk (premortem M5), and the guardrail contract is what makes the
   grouping real rather than notional.
3. **[[ask-ai-charter]] as a schema, not a screen.** The deliverable is a typed allowlist
   and a refusal policy, both writable today against [[FUTURES]] §8 and the 25 specified
   paths. It should *not* wait for the composer to be built — the schema is what the
   composer is built against.
4. **[[supply-discovery-charter]] on a real denominator.** It has the most code and the
   least demand (`procurement_orders` = 1). Its entry work is defining "needed SKU" for one
   restaurant, not crawling more distributors.
5. **[[service-floor-charter]] on its named unblocker.** Input audit only until a POS
   provider can supply `table_id` + `server_name`. The notification layer is explicitly
   **not** first (premortem M3).

**The department gate, applied to every proposal:** *name the restaurant this changes.* A
proposal that cannot name one is scoped as research and labelled as research on the board.
That is the counter-pressure to premortem M1, and it is enforced in
[[product-vision-directive]].

## Why now

- **The team layer is the last undecided layer.** Divisions and departments are LOCKED
  ([[ORG_STRUCTURE]] §2); these five teams are **PROPOSED** (`teams/product.md:26-28`).
  Writing the charters is how the proposal gets tested.
- **Two scan findings have been assigned here by name and have no owner yet** — the
  POS-bridge audit (foundation [[README]]:51-54) and the 24 unlinked routes (:65). They have
  been sitting since the scan.
- **The Ask AI contract is written and the entry points are already diverging.** Four
  divergent surfaces exist today (`AICommandPalette.tsx:191`, `Reports.tsx:959`,
  `apps/mobile/src/guidance/WineAgentFab.tsx`, `SommelierAI.tsx`) plus two placeholder
  routes. Every month without one schema is another surface to unify later.
- **`pos_checks` is empty and `procurement_orders` = 1.** That is not a reason to wait; it
  is the reason the metrics are defined the way they are. Definition work done now is what
  makes the first real restaurant's data legible instead of a rewrite.

## Next steps

- [ ] Publish first readings — or a written statement of why the metric cannot yet be read
      and what it would take — for all five primary metrics · [[product-vision-loops]]
- [ ] Route verdict sheet v1: all 51 routes classified; the three duplications decided ·
      [[surface-portfolio-charter]]
- [ ] Write the shared guardrail contract (confidence threshold, gate shape, approval
      primitive, false-accept audit) · [[inbound-understanding-charter]]
- [ ] Write the Ask AI action schema + refusal policy + audit-trail requirement as **one**
      artifact; `NEW-902` ships with the first executing action, not after ·
      [[ask-ai-charter]]
- [ ] Per-provider kitchen-ready input audit against
      `apps/api-gateway/src/pos-hub/pos-provider.registry.ts` · [[service-floor-charter]]
- [ ] Define "needed SKU" for exactly one restaurant so
      `supply.sku_dual_price_coverage_pct` has a denominator · [[supply-discovery-charter]]
- [ ] Correct `teams/product.md:226`'s citation of the Reports AI entry point — it is
      `apps/web/src/components/reports/organisms/AICommandPalette.tsx`, not
      `apps/web/src/components/command/` (which is the deterministic §A palette) ·
      [[ask-ai-charter]]
- [x] File the department's forks with **new IDs** — `teams/product.md` §6 collided with
      live OD-20…OD-23; now **PROD-F1…PROD-F5** ([[FORK-REGISTRY]]) · [[decision-office-charter]]
- [ ] Stand up the daily open-decision digest as a scheduled job, not a team ·
      [[product-vision-schedule]]

## Questions for the founder

1. **Is five teams right, or is the v0 set three?** `teams/product.md:840-848` recommends
   activating [[surface-portfolio-charter]] early and putting everything else on a named
   unblocker. [[service-floor-charter]] has null inputs and [[ask-ai-charter]] has no
   server. Standing all five up at equal weight is how we get five provisional agendas and
   no work.
2. **Vendor Finder boundary.** Does [[supply-discovery-charter]] stay in Product, or merge
   into [[supplier-distributor-network-charter]] under Partnerships? `teams/product.md:828`
   calls this the highest duplication risk in the division. One person will hold both at v0
   regardless.
3. **Floor Checker's honest v0.** Given `server_name`/`table_id` are 0 of 47 rows: is the
   acceptable v0 *check-in timing only*, with the personal food-up alert gated on a POS
   provider that emits a kitchen-ready event — or is the food-up alert the whole point, in
   which case this team waits entirely on [[pos-bridge-charter]]?
4. **Ask AI's blast radius.** [[FUTURES]] §8.2 lists inventory transfers and waste logs in
   the MVP allowlist, and §8.4 defers "full inventory transfers". Which is it for v0? The
   answer sets whether `askai.refusal_correctness` is a gate on money and stock or only on
   billing and permissions.
5. **Does [[surface-portfolio-charter]] have kill authority?** Deleting a route that a
   deferred UX path depends on is a product call that lands on Design's ledger. If the
   answer is "propose only", the unowned-surface count will not move and premortem M4 is the
   forecast.
